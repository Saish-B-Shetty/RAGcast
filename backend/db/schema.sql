-- ============================================================================
-- RAGcast — Database schema (Postgres + pgvector, via Supabase)
-- CLAUDE.md §5. Apply in the Supabase SQL editor (or `supabase db push`).
--
-- Conventions:
--   * Every table has Row-Level Security ENABLED with owner-only policies.
--   * Child tables (transcripts, chunks, messages, books, people) are scoped
--     to the owning user THROUGH their parent episode — never query across users.
--   * Embeddings are vector(384) — local bge-small-en-v1.5 / all-MiniLM-L6-v2.
--     If the embedding model changes, this dimension MUST change with it.
-- ============================================================================

-- Extensions -----------------------------------------------------------------
create extension if not exists vector;      -- pgvector (embeddings + HNSW)
create extension if not exists pgcrypto;    -- gen_random_uuid()

-- ============================================================================
-- profiles — 1:1 with auth.users
-- ============================================================================
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- episodes — one per transcript
-- ============================================================================
create table if not exists public.episodes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles (id) on delete cascade,
  name           text not null,
  source_type    text not null check (source_type in ('youtube_url', 'manual_paste')),
  source_url     text,
  podcast_name   text,
  has_timestamps boolean not null default false,
  status         text not null default 'processing'
                   check (status in ('processing', 'ready', 'failed')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ============================================================================
-- transcripts — 1:1 with episode (kept separate so the list query stays light)
-- ============================================================================
create table if not exists public.transcripts (
  episode_id  uuid primary key references public.episodes (id) on delete cascade,
  content     text not null default '',
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- chunks — semantic chunks + embeddings
-- ============================================================================
create table if not exists public.chunks (
  id           uuid primary key default gen_random_uuid(),
  episode_id   uuid not null references public.episodes (id) on delete cascade,
  text         text not null,
  embedding    vector(384),
  start_ts     double precision,
  end_ts       double precision,
  chunk_index  integer not null,
  speaker      text,
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- messages — chat history
-- ============================================================================
create table if not exists public.messages (
  id               uuid primary key default gen_random_uuid(),
  episode_id       uuid not null references public.episodes (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant')),
  content          text not null,
  source           text check (source in ('transcript', 'web', 'hybrid', 'summary')),
  timestamps_cited jsonb,
  created_at       timestamptz not null default now()
);

-- ============================================================================
-- books — extracted per episode
-- ============================================================================
create table if not exists public.books (
  id           uuid primary key default gen_random_uuid(),
  episode_id   uuid not null references public.episodes (id) on delete cascade,
  title        text not null,
  author       text,
  description  text,
  cover_url    text,
  amazon_url   text,
  mentioned_at text,
  created_at   timestamptz not null default now()
);

-- ============================================================================
-- people — extracted per episode
-- ============================================================================
create table if not exists public.people (
  id              uuid primary key default gen_random_uuid(),
  episode_id      uuid not null references public.episodes (id) on delete cascade,
  name            text not null,
  bio             text,
  photo_url       text,
  context_snippet text,
  mentioned_at    text,
  created_at      timestamptz not null default now()
);

-- ============================================================================
-- Indexes (CLAUDE.md §5)
-- ============================================================================
-- Vector similarity search (powers retrieval)
create index if not exists chunks_embedding_hnsw
  on public.chunks using hnsw (embedding vector_cosine_ops);
create index if not exists chunks_episode_idx
  on public.chunks (episode_id, chunk_index);

-- Thread loading
create index if not exists messages_episode_created_idx
  on public.messages (episode_id, created_at);

-- Sidebar "Recent Episodes"
create index if not exists episodes_user_updated_idx
  on public.episodes (user_id, updated_at desc);

create index if not exists books_episode_idx  on public.books (episode_id);
create index if not exists people_episode_idx on public.people (episode_id);

-- ============================================================================
-- updated_at maintenance for episodes
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists episodes_set_updated_at on public.episodes;
create trigger episodes_set_updated_at
  before update on public.episodes
  for each row execute function public.set_updated_at();

-- ============================================================================
-- Auto-create a profiles row when a new auth user signs up
-- ============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- Row-Level Security — MANDATORY on every table (CLAUDE.md §5, §12)
-- A user may only access rows tied to their own profiles.id, directly or via
-- the parent episode. Never write a query path that bypasses RLS.
-- ============================================================================
alter table public.profiles    enable row level security;
alter table public.episodes    enable row level security;
alter table public.transcripts enable row level security;
alter table public.chunks      enable row level security;
alter table public.messages    enable row level security;
alter table public.books       enable row level security;
alter table public.people      enable row level security;

-- profiles: owner is the row itself ------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert with check (id = auth.uid());

-- episodes: owned directly via user_id ---------------------------------------
drop policy if exists episodes_all on public.episodes;
create policy episodes_all on public.episodes
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Helper: does the current user own the given episode?
create or replace function public.owns_episode(ep_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.episodes e
    where e.id = ep_id and e.user_id = auth.uid()
  );
$$;

-- Child tables: ownership flows through the parent episode --------------------
drop policy if exists transcripts_all on public.transcripts;
create policy transcripts_all on public.transcripts
  for all
  using (public.owns_episode(episode_id))
  with check (public.owns_episode(episode_id));

drop policy if exists chunks_all on public.chunks;
create policy chunks_all on public.chunks
  for all
  using (public.owns_episode(episode_id))
  with check (public.owns_episode(episode_id));

drop policy if exists messages_all on public.messages;
create policy messages_all on public.messages
  for all
  using (public.owns_episode(episode_id))
  with check (public.owns_episode(episode_id));

drop policy if exists books_all on public.books;
create policy books_all on public.books
  for all
  using (public.owns_episode(episode_id))
  with check (public.owns_episode(episode_id));

drop policy if exists people_all on public.people;
create policy people_all on public.people
  for all
  using (public.owns_episode(episode_id))
  with check (public.owns_episode(episode_id));

-- Note: the backend uses the service-role key, which BYPASSES RLS by design.
-- Backend routes must therefore scope every query by user_id explicitly.
-- Frontend (anon key) is fully governed by the policies above.

-- ============================================================================
-- Realtime — let the frontend observe episode.status flip processing → ready
-- (CLAUDE.md §6A.6). Adding a table to supabase_realtime errors if it's already
-- a member, so guard it. Realtime delivery still respects RLS.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'episodes'
  ) then
    alter publication supabase_realtime add table public.episodes;
  end if;
end $$;

-- transcripts + messages: live chat updates and transcript availability (§6A/§6B).
-- books & people populate the context panel live as extraction completes (§6A).
do $$
declare t text;
begin
  foreach t in array array['transcripts', 'messages', 'books', 'people'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- Vector similarity search for RAG retrieval (CLAUDE.md §6B).
-- Cosine distance (<=>) against the HNSW index; returns the top matches with a
-- [0,1] similarity score. `match_threshold` drops weak matches so the RAG layer
-- can do its confidence gate (high → transcript, low → web). `filter_episode_id`
-- is optional but in practice always passed (Q&A is single-episode).
--
-- Ownership/isolation: SECURITY INVOKER means the function runs as the calling
-- role, so the `chunks` RLS policy applies automatically to any anon/authenticated
-- caller (they only ever see their own episodes' chunks). The service-role backend
-- bypasses RLS by design and instead verifies episode ownership in the /ask route
-- before calling, passing filter_episode_id. Do NOT add an auth.uid() check here:
-- under the service role auth.uid() is NULL, which would filter out every row.
--
-- NOTE: the previous signature (p_episode_id, p_query_embedding, p_match_count)
-- differs, so this is a DROP + recreate, not an in-place replace.
-- ============================================================================
drop function if exists public.match_chunks(uuid, vector, int);

create or replace function public.match_chunks(
  query_embedding vector(384),
  match_count int default 6,
  match_threshold float default 0.0,
  filter_episode_id uuid default null
)
returns table (
  id uuid,
  episode_id uuid,
  text text,
  start_ts double precision,
  end_ts double precision,
  similarity float
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    c.id,
    c.episode_id,
    c.text,
    c.start_ts,
    c.end_ts,
    1 - (c.embedding <=> query_embedding) as similarity
  from public.chunks c
  where c.embedding is not null
    and (filter_episode_id is null or c.episode_id = filter_episode_id)
    and (1 - (c.embedding <=> query_embedding)) >= match_threshold
  order by c.embedding <=> query_embedding
  limit greatest(match_count, 1);
$$;
