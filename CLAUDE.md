# CLAUDE.md — RAGcast

> Instructions and context for Claude Code working on the RAGcast codebase.
> Read this fully before making changes. It reflects locked product and architecture decisions.

---

## 1. What RAGcast Is

RAGcast is an AI-powered podcast notetaker. A user signs in, creates an **episode** from a YouTube
URL or a pasted transcript, and then asks questions answered by **Retrieval-Augmented Generation
(RAG)** against that episode's transcript — falling back to web search when the transcript doesn't
cover the question. Every answer is tagged with its source. On ingestion, RAGcast also generates an
episode summary and auto-extracts the books and people mentioned.

**Tagline:** "Ask anything from every podcast you've heard."

**Core value:** retrieval quality. The whole product lives or dies on grounded, well-sourced
answers. Treat retrieval accuracy as the top priority in any tradeoff.

---

## 2. Tech Stack (LOCKED — do not swap without explicit instruction)

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Vite |
| Styling | Tailwind CSS (design tokens below) |
| Backend | Node.js + TypeScript |
| Database | PostgreSQL + pgvector (via Supabase) |
| Auth | Google OAuth via Supabase Auth |
| LLM | **Groq** (free tier, no credit card — `llama-3.1-8b-instant`) — summary, extraction, answer synthesis. Provider chain: Groq → OpenAI → Gemini (whichever keys are set). See note below. |
| Embeddings | **Local** via Transformers.js (`@huggingface/transformers`) — model `bge-small-en-v1.5` or `all-MiniLM-L6-v2` (**384 dims**). Free, no API key, no rate limit |
| Web search fallback | Tavily (free tier) — fallback: DuckDuckGo |
| Book metadata | Google Books API |
| Realtime | Supabase Realtime (ingestion status) |
| YouTube transcript | `youtube-transcript` library (reads timed-text endpoint — NOT the official Data API) |
| YouTube video title | YouTube oEmbed endpoint (no API key, no quota) |

> **LLM note (deviation from the original lock):** the stack originally specified OpenAI-primary /
> Gemini-fallback, but the OpenAI account had no credit and the Gemini free tier is only ~20
> requests/day — too low to run ingestion. RAGcast now uses **Groq** as the primary free provider
> (no credit card, ~14.4k req/day). `backend/src/services/llm.ts` tries **Groq → OpenAI → Gemini**
> based on which `*_API_KEY` is set. This switch is intentional — do **not** revert it to match the
> old wording. Keys live in `backend/.env` (`GROQ_API_KEY`, optional `GROQ_MODEL`).

**Single-language preference:** keep backend and frontend both in TypeScript. Share types between
them where possible (define `Episode`, `Message`, `Book`, `Person` once).

---

## 3. Cost & Free-Tier Constraints (IMPORTANT)

This project must run **fully free**. That shapes the architecture:

- **Embeddings run locally** (Transformers.js) — no API, no key, no rate limit, no per-token cost.
  This is the deliberate reason embeddings are not on a paid API. The model loads into memory once
  and embeds in-process.
  - Still **batch** sentence embeddings during ingestion for throughput (pass arrays), but there is
    no rate-limit failure mode to fear anymore.
  - First load reads the model from disk — see Deployment (§16): the model is baked into the Docker
    image so it never downloads at runtime.
- **LLM calls (Groq / OpenAI / Gemini) DO have free-tier limits** — add retry with exponential
  backoff on these (honoring the provider's `retry-after`), and handle a rate-limit response
  gracefully (the summary/extraction must degrade, not crash ingestion).
  - **Groq** free tier is request-generous (~14.4k/day on 8b) but **tokens-per-minute limited**
    (8b = 6k TPM). So summary/extraction inputs are chunked small (`summary.ts` map-reduce threshold
    ~3000 words; `extraction.ts` `PART_WORDS` ~2500) to keep any single call under TPM. Long (1–3h)
    podcasts therefore ingest slowly but complete (async, so the user is never blocked).
  - **Gemini** free tier is only ~20 requests/day per model — too low to be primary; it's a
    last-resort fallback. Gemini 2.5 models also need `thinkingConfig.thinkingBudget: 0` or the
    hidden "thinking" tokens truncate the visible output.
- Keep an eye on the **Supabase 500MB database cap** (§16) — it is the first ceiling you'll hit.

---

## 4. Project Structure

```
ragcast/
├── frontend/                 # React + Vite + TS
│   ├── src/
│   │   ├── components/       # UI components (match design tokens)
│   │   ├── pages/            # SignIn, App (main), NewEpisode
│   │   ├── lib/              # supabase client, api client, types
│   │   └── hooks/
│   └── ...
├── backend/                  # Node + TS
│   ├── src/
│   │   ├── routes/           # episodes, ask
│   │   ├── services/         # ingestion, rag, chunking, extraction, enrichment
│   │   ├── lib/              # openai, tavily, googleBooks, supabase, youtube
│   │   └── types/            # shared domain types
│   └── ...
└── shared/                   # types shared across FE/BE (optional)
```

Keep AI/secret-key logic in `backend/src/services`. Never expose API keys to the frontend.

---

## 5. Database Schema

Postgres + pgvector. Full DDL lives in `backend/db/schema.sql`. Summary of tables:

- **profiles** — 1:1 with `auth.users`. User profile.
- **episodes** — one per transcript. Fields: `name` (editable), `source_type`
  (`youtube_url`|`manual_paste`), `source_url`, `podcast_name`, `has_timestamps`,
  `status` (`processing`|`ready`|`failed`), `created_at`, `updated_at`.
- **transcripts** — 1:1 with episode, holds the full raw transcript (kept separate so the episodes
  list query stays light).
- **chunks** — semantic chunks + embeddings. Fields: `text`, `embedding vector(384)`, `start_ts`,
  `end_ts`, `chunk_index`, `speaker`. (384 dims = local `bge-small-en-v1.5` / `all-MiniLM-L6-v2`.
  If you change the embedding model, this dimension MUST match it.)
- **messages** — chat history. Fields: `role` (`user`|`assistant`), `content`,
  `source` (`transcript`|`web`|`hybrid`|`summary`), `timestamps_cited` (jsonb), `created_at`.
- **books** — extracted per episode: `title`, `author`, `description`, `cover_url`, `amazon_url`,
  `mentioned_at`.
- **people** — extracted per episode: `name`, `bio`, `photo_url`, `context_snippet`,
  `mentioned_at`.

### Relationships
```
profiles 1─N episodes 1─N { chunks, messages, books, people }, 1─1 transcripts
```

### Security — Row-Level Security is mandatory
Every table has RLS enabled. A user may only access rows tied to their own `profiles.id` (directly
or via the parent episode). This enforces the privacy requirement that no transcript or chat data is
ever shared between accounts. Never write a query path that bypasses RLS.

### Key indexes
- `chunks` HNSW vector index (`vector_cosine_ops`) — powers retrieval.
- `messages (episode_id, created_at)` — thread loading.
- `episodes (user_id, updated_at desc)` — sidebar "Recent Episodes".

---

## 6. The Two Core Pipelines

### A. Ingestion — `POST /api/episodes` (async)
Returns `202` immediately, then processes in the background. Frontend tracks completion via Supabase
Realtime on the episode's `status`.

```
1. Validate input → create episode (status='processing') + transcript row → return 202
2. If YouTube: fetch transcript (transcript library) + video title (oEmbed); detect timestamps
3. Semantic chunk → batch-embed → insert chunks
4. Generate 200–250 word summary → insert as FIRST message (source='summary')
5. Extract books → enrich via Google Books → insert
6. Extract people → enrich via web → insert
7. Set status='ready'
```
If summary generation fails, episode must still become usable for Q&A (graceful degradation).
Enforce the 200–250 word range with a post-generation word-count check; regenerate if outside it.
For very long transcripts (3h+), summarise in parts then synthesise into one 200–250 word summary.

**YouTube fetching — read carefully:**
- The transcript does **NOT** come from the official YouTube Data API. Its captions endpoint
  requires OAuth and video ownership, so it can't fetch transcripts for arbitrary podcasts. Use a
  transcript library (`youtube-transcript`) that reads the public timed-text endpoint.
- The video **title** (for auto-naming the episode, C4) comes from the YouTube **oEmbed** endpoint:
  `https://www.youtube.com/oembed?url=<videoUrl>&format=json` → returns `title`. No API key, no quota.
- Do **not** add or reach for the official YouTube Data API — it's not needed and hits an
  ownership wall for transcripts.
- If the Node transcript library proves unreliable, isolate **only** transcript fetching as a small
  Python serverless function using `youtube-transcript-api`, and call it from the Node backend.
  Everything else stays in Node. Manual paste (C2) remains the always-available fallback.

### B. RAG Query — `POST /api/episodes/:id/ask`
```
1. Embed question
2. Vector similarity search → top 4–6 chunks
3. Confidence check (similarity threshold — TUNABLE, calibrate in alpha):
     high    → answer from chunks  → source='transcript', cite timestamps
     low     → Tavily web search   → source='web'
     partial → both, stitched      → source='hybrid'
4. Persist user + assistant messages
5. Return assistant message { content, source, timestamps_cited }
```

---

## 7. Chunking Strategy (LOCKED)

**Hybrid semantic chunking with size guardrails:**

- Detect boundaries semantically: embed sentences, cut where consecutive similarity drops.
- Enforce **max ~600 tokens** (splits long monologues) and **min ~150 tokens** (merges fragments).
- Attach `start_ts` / `end_ts` to every chunk — this powers the "Mentioned at 34:12" citations.
- Embeddings: **local** Transformers.js (`bge-small-en-v1.5` / `all-MiniLM-L6-v2`, 384 dims),
  batched for throughput. No API, no rate limit.
- Summary and book/people extraction run on the **full transcript**, NOT chunks, so nothing is
  missed at a boundary.

---

## 8. API Endpoints

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/episodes` | Create + start ingestion (async, returns 202) |
| GET | `/api/episodes` | List episodes for sidebar |
| GET | `/api/episodes/:id` | Full episode: messages + books + people |
| GET | `/api/episodes/:id/status` | Poll ingestion status |
| PATCH | `/api/episodes/:id` | Rename episode |
| DELETE | `/api/episodes/:id` | Delete episode |
| POST | `/api/episodes/:id/ask` | RAG question → answer |

- **Auth:** every request carries `Authorization: Bearer <supabase_jwt>`; backend verifies it.
- **Backend-only (use secret keys):** `POST /api/episodes`, `POST /ask`.
- **May go Supabase-direct (RLS-protected):** list, get, rename, delete.
- **Error shape:** `{ "error": { "code": "...", "message": "..." } }`.

---

## 9. Source Badges (UI contract)

Every assistant message renders a badge based on `source`:

| `source` | Badge label | Color |
|---|---|---|
| `transcript` | From Transcript | green (`#00C48C`) |
| `web` | From Web | blue (`#0066FF`) |
| `hybrid` | From Transcript + Web | split green/blue |
| `summary` | Episode Summary | purple |

---

## 10. Design System (Tailwind tokens)

Dark theme, Jio-inspired, bold and premium. Map these to the Tailwind config:

| Token | Value | Usage |
|---|---|---|
| bg | `#0A0A0A` | App background, chat area |
| panel | `#111111` | Sidebar, context panel |
| card | `#1A1A1A` | Cards, input bar |
| border | `#222222` | Hairline borders |
| blue | `#0066FF` | Primary accent, CTAs, active states |
| blue-bright | `#2D82FF` | Timestamps, links, hovers |
| green | `#00C48C` | "From Transcript" badge |
| amazon | `#FF9900` | Amazon buy link |
| text | `#F4F6FA` | Primary text |
| muted | `#8A8F98` | Secondary text |

- **Fonts:** Inter (body/UI, 400–900); Space Grotesk (wordmark, headings, section titles, 500–700).
- **Radius:** cards 13–16px; chat bubbles & input 18px; sign-in card 24px.
- **Layout (main app):** Sidebar (280px) | Chat (flex) | Context Panel (344px default, resizable
  264–560px, width persists to localStorage).

### Screens
1. **Sign In** — centered card, RAGcast wordmark + tagline, single "Continue with Google" button.
2. **Main App** — three-column layout above. Sidebar has the New Episode button, the Recent
   Episodes list (rename on hover), and an account footer with Log Out. Chat shows the episode
   summary first, then Q&A with source badges; a typing indicator shows while an answer loads.
   Context panel shows collapsible "Books Mentioned" and "People Mentioned" card sections, each
   with a count pill and an empty state ("No books/people detected in this transcript yet").
3. **New Episode** — replaces chat area; two cards (YouTube URL / paste transcript) split by an "or"
   divider.

---

## 11. Feature Reference (PRD IDs)

P0 = MVP must-have, P1 = within 4 weeks, P2 = later (post-MVP).

> Note: the People feature IDs (P1–P5) are NOT priority tiers. Priority is the value in parentheses
> at the end of each line (P0 / P1 / P2). e.g. "P3 cards ... (P1)" = People-feature-3, priority-1.

- **Core:** C1 YouTube ingest, C2 manual paste, C3 timestamp detect, C4 episode naming,
  C5 chunk+index, C6 persistence (all P0).
- **Q&A:** Q1 retrieval, Q2 confidence, Q3 web fallback, Q4 source labels, Q5 chat history,
  Q7 episode summary (P0); Q6 hybrid answer (P1).
- **Books:** B1 detect, B2 display (P0); B3 cards, B4 enrich, B5 Amazon India link, B6 timestamp
  (P1); B7 master library (P2).
- **People:** P1 detect, P2 display (P0); P3 cards, P4 enrich, P5 context snippet (P1).
- **Timestamps:** T1 preserve, T2 cite in answers, T4 graceful degradation (P0); T3 multiple
  references (P1).

---

## 12. Conventions & Guardrails

- TypeScript everywhere; prefer shared types between FE and BE.
- Keep secret keys (Groq/OpenAI/Gemini, Tavily, Google Books, Supabase service role) server-side
  only. Embeddings are local, so there is no embedding API key.
- LLM calls (Groq/OpenAI/Gemini): retry with backoff for free-tier limits. Embeddings are local —
  batch for speed, but no rate-limit handling needed.
- Respect RLS — never bypass it; never query across users.
- Episode summary is inserted once at ingestion and is **static** — do not regenerate on revisit.
- Book "buy" link is an **Amazon India** (`amazon.in`) search URL built from the book title + author.
- Timestamps degrade gracefully: if a transcript has none, skip citations silently (no broken UI).
- v1.0 is **web-only**, responsive down to 1280px. Mobile below that is out of scope.
- Streaming answers (SSE) are a future enhancement — start non-streaming; the typing indicator
  covers latency.

### Out of scope for v1.0 (do not build unless asked)
Cross-episode search, highlights/export, jargon glossary, follow-up question suggestions, mobile app.

---

## 13. Environment Variables

```
# Frontend (.env)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Backend (.env)
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=     # server-side only, never expose
GROQ_API_KEY=                  # LLM — primary (free, no card). GROQ_MODEL optional (default llama-3.1-8b-instant)
OPENAI_API_KEY=                # LLM — fallback (optional)
GEMINI_API_KEY=                # LLM — last-resort fallback (optional; only ~20 req/day free)
TAVILY_API_KEY=
GOOGLE_BOOKS_API_KEY=
# No embedding API key — embeddings run locally via Transformers.js.
# No YouTube API key needed — transcript via library, title via oEmbed (both keyless).
```

Never commit `.env`. Never ship the service role key or any API key to the client bundle.

---

## 14. Performance Targets (guide, not hard limits)

- YouTube transcript fetch: ~5s. Episode summary: ~8s after ingestion. Books/people extraction:
  ~10s. RAG answer: ~4s on broadband.
- Ingestion is async, so the user is never blocked waiting — show a "processing" state and let the
  summary, books, and people populate as they complete (via Supabase Realtime).
- Support transcripts up to ~3 hours (~50,000 words).

---

## 15. Analytics Events (instrument as built)

Fire these to the analytics layer (e.g. Mixpanel/Amplitude) as each feature is built:

- `sign_in` (method: google), `sign_out`
- `episode_created` (source: youtube_url | manual_paste)
- `summary_viewed` (episode_id, word_count)
- `question_asked` (episode_id, answer_source: transcript | web | hybrid)
- `web_fallback_triggered` (query_text, episode_id)
- `book_card_clicked`, `amazon_link_clicked` (book_title, episode_id)
- `people_card_viewed` (person_name, episode_id)
- `episode_renamed` (episode_id)
- `session_resumed` (episode_id, messages_in_history)

---

## 16. Deployment & Hosting (fully free)

The entire stack runs free for an MVP. Topology:

| Piece | Host | Notes |
|---|---|---|
| Frontend (React/Vite) | Vercel or Netlify | Static SPA, git-push deploy. Hobby tier = personal use |
| Backend (Node + local embeddings) | **Hugging Face Spaces (Docker)** | Free tier: 16GB RAM, 2 vCPU, 50GB non-persistent disk |
| Database / Auth / Realtime | Supabase free tier | 500MB DB, 50k MAU, 2 projects |
| LLM | **Groq free tier** (primary) — OpenAI / Gemini as fallbacks | Cloud API call from the backend; just set `GROQ_API_KEY` as a Space secret |
| Web search | Tavily free / DuckDuckGo | — |

### Backend on Hugging Face Spaces — critical deployment rules
- Deploy as a **Docker** Space (Node API server binding the Space's port, default 7860).
- **Bake the embedding model into the Docker image at build time** (download during `docker build`).
  The Space's disk is **not persistent**, so a runtime download would repeat on every restart. Baking
  it in means it loads from disk instantly and never re-downloads.
- Enable CORS for the frontend origin.

### "Sleep / pause when idle" — plan for it
- A free HF Space **sleeps** after inactivity; a Supabase free project **pauses after 7 days** of no
  database activity (~30s to wake). Both wake on the next request.
- **Fix:** a free uptime-monitor ping (e.g. every few minutes) that hits a lightweight backend
  endpoint which in turn touches the DB. This resets both idle timers. No upgrade needed.
- Frontend should show a graceful loading state for the first request after idle (cold start).

### Database ceiling to watch
- Supabase free DB cap is **500MB**. Each episode (transcript + ~hundreds–1000 embedding rows at 384
  dims) is roughly **1–3MB**, so expect ~**150–300 episodes** before hitting the cap. Fine for MVP;
  it's the first wall if usage grows.

### Cost summary
No paid service is required for the MVP. The only "costs" are free-tier limits (DB size, idle
pauses, LLM/search quotas) — all manageable with the notes above.
