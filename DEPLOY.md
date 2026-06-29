# Deploying RAGcast (free tier)

Step-by-step for taking RAGcast from local dev to a live, fully-free deployment,
per `CLAUDE.md` §16 (locked topology — do not swap hosts).

| Piece | Host | Notes |
|---|---|---|
| Frontend (React + Vite + TS) | **Vercel** | Static SPA, git-push deploy. Root dir `frontend`. |
| Backend (Node + TS, local embeddings) | **Hugging Face Spaces (Docker)** | Free tier 16GB RAM / 2 vCPU. Binds port **7860**. |
| Database / Auth / Realtime | **Supabase** free tier | Postgres + pgvector. Schema in `backend/db/schema.sql`. |
| LLM | **Groq** (primary) — OpenAI/Gemini fallbacks | `GROQ_API_KEY` as a Space secret. |
| Web search | Tavily (free) → DuckDuckGo | `TAVILY_API_KEY`. |

No paid service is required anywhere in this setup.

---

## 0. A note on the backend's Dockerfile location and the monorepo

`backend/Dockerfile` lives inside `backend/` for discoverability, but it must be
**built with the monorepo root as context**, not `backend/`:

```bash
# from the repo root
docker build -f backend/Dockerfile -t ragcast-backend .
```

This is because `backend/src` imports type-only definitions from `../shared/types.ts`
(`backend/tsconfig.json` has `rootDir: ".."` and a `@shared/*` path alias) — `tsc`
needs that sibling `shared/` folder on disk at build time. This also produces the
intentional nested compile output `backend/dist/backend/src/index.js`, which
`backend/package.json`'s `start` script (`node dist/backend/src/index.js`, run with
cwd `backend/`) expects. **Don't change that path** — it's correct given
`rootDir`/`outDir`.

**Hugging Face Spaces has no concept of building a subdirectory of a monorepo** — it
always builds `./Dockerfile` with the Space's own repo root as the build context.
So the Space gets a *separate*, smaller repo containing only what the backend needs:

```
<space-repo>/
  Dockerfile      ← copy of this repo's backend/Dockerfile, unmodified
  .dockerignore   ← copy of this repo's backend/.dockerignore, unmodified
  backend/        ← copy of this repo's backend/ folder (minus node_modules, dist)
  shared/         ← copy of this repo's shared/ folder
```

That mirrors the exact relative layout (`backend/` + sibling `shared/`) the
Dockerfile and `tsconfig.json` expect — just with `frontend/` and other monorepo
parts dropped, since the backend image doesn't need them.

---

## 1. Backend → Hugging Face Spaces (Docker)

1. Go to https://huggingface.co/new-space.
2. Space name: e.g. `ragcast-backend`. **SDK: Docker.** Visibility: Public or
   Private — either is fine (this Space is an API, not something people browse).
3. Hardware: default free CPU tier (16GB RAM / 2 vCPU — plenty for embeddings +
   a small Express server).
4. **Push the bundle described in §0** to the Space's own git remote:
   ```bash
   # one-time: clone the Space repo HF gave you
   git clone https://huggingface.co/spaces/<your-username>/ragcast-backend space-repo
   cd space-repo

   # copy in the bundle (run from the RAGcast repo root)
   cp /path/to/RAGcast/backend/Dockerfile ./Dockerfile
   cp /path/to/RAGcast/backend/.dockerignore ./.dockerignore
   mkdir -p backend
   rsync -a --exclude node_modules --exclude dist /path/to/RAGcast/backend/ ./backend/
   rsync -a /path/to/RAGcast/shared/ ./shared/

   git add -A
   git commit -m "Deploy backend"
   git push
   ```
   Repeat this push (steps 4 only) every time `backend/` or `shared/` changes.
   Alternative: the HF web UI's "Files" tab supports the same structure via manual
   upload if you'd rather not script it.
5. The Space builds the Dockerfile automatically on push. The build:
   - Installs deps (`npm ci`), compiles TS (`npm run build` → `tsc`), then runs a
     prefetch step that downloads `Xenova/bge-small-en-v1.5` so it's baked into the
     image layer (the Space disk is **not persistent** — without this the model
     would re-download on every cold start/restart).
   - Binds port `7860` and runs `npm start`.
6. **Set Space secrets** (Settings → Variables and secrets → "New secret" for each):

   | Secret | Value |
   |---|---|
   | `SUPABASE_URL` | your Supabase project URL |
   | `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (server-side only) |
   | `GROQ_API_KEY` | your Groq key |
   | `GROQ_MODEL` | `llama-3.1-8b-instant` (optional — this is the default) |
   | `TAVILY_API_KEY` | your Tavily key |
   | `GOOGLE_BOOKS_API_KEY` | optional — public Books search works without one |
   | `FRONTEND_ORIGIN` | the Vercel production URL (from step 2 below) |
   | `PORT` | `7860` |

   Never put real values in `backend/.env.example` or any committed file — secrets
   live only in the Space's secret store and your local, git-ignored `.env`.
7. Once it builds, the Space gives you a public URL like
   `https://<your-username>-ragcast-backend.hf.space`. Confirm it's alive:
   ```bash
   curl -s https://<your-username>-ragcast-backend.hf.space/api/health
   # → {"ok":true,"db":true,"ts":"..."}
   ```

---

## 2. Frontend → Vercel

1. Go to https://vercel.com/new and import the `Saish-B-Shetty/RAGcast` GitHub repo.
2. Project settings:
   - **Root directory:** `frontend`
   - **Framework preset:** Vite
   - **Build command:** `npm run build`
   - **Output directory:** `dist`
3. `frontend/vercel.json` (added here) has the SPA fallback rewrite so any
   client-side path (and the Supabase OAuth redirect) serves `index.html` instead
   of 404ing:
   ```json
   { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
   ```
4. **Environment variables** (Project Settings → Environment Variables — add to both
   **Production** and **Preview**):

   | Variable | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | your Supabase project URL |
   | `VITE_SUPABASE_ANON_KEY` | Supabase **anon** key (public, RLS-protected — never the service-role key) |
   | `VITE_API_BASE_URL` | the HF Space URL from step 1.7 |

   Only `VITE_*` public values go here. Never the service-role key or any LLM/Tavily key.
5. Deploy. Vercel gives you a production URL like `https://ragcast.vercel.app`.

---

## 3. Wire the two together

Once both URLs exist:

1. **Backend → frontend CORS:** set the HF Space secret `FRONTEND_ORIGIN` to the real
   Vercel URL (e.g. `https://ragcast.vercel.app`), then restart the Space (Settings →
   Factory reboot, or push any commit) so it picks up the new secret.
2. **Frontend → backend:** confirm Vercel's `VITE_API_BASE_URL` points at the HF
   Space URL, then redeploy the frontend if you changed it after the first deploy.

---

## 4. Supabase setup

1. **Apply the schema**: Supabase dashboard → SQL Editor → paste and run
   `backend/db/schema.sql`. Confirm afterward:
   - `pgvector` extension enabled (the script runs `create extension if not exists vector`).
   - `chunks_embedding_hnsw` index exists on `public.chunks` (Database → Indexes).
   - Row-Level Security is **ON** for every table (Database → Tables → each table's
     RLS toggle) — the schema enables it and adds owner-only policies for all of
     `profiles`, `episodes`, `transcripts`, `chunks`, `messages`, `books`, `people`.
2. **Auth → URL Configuration** (needed for Google sign-in to work in production):
   - **Site URL:** `https://ragcast.vercel.app`
   - **Redirect URLs:** add `https://ragcast.vercel.app/**` (keep
     `http://localhost:5173/**` too, for local dev)
3. **Google Cloud Console** → APIs & Services → Credentials → your OAuth 2.0 Client ID:
   - **Authorized redirect URIs:** confirm `https://<your-project-ref>.supabase.co/auth/v1/callback`
     is present (should already be there from initial local setup).
   - **Authorized JavaScript origins:** add `https://ragcast.vercel.app`.

Never write a backend query path that bypasses RLS — the service-role key used by
the backend already bypasses RLS by design, so every backend route must scope
queries by `user_id`/`episode_id` explicitly (this is how the existing routes work;
keep it that way in any future changes).

---

## 5. Idle-keepalive (HF Space sleep + Supabase 7-day pause)

Both the free HF Space and the free Supabase project pause after inactivity:

- HF Spaces sleep after a period with no traffic (cold start ~10–30s on next request).
- Supabase free projects pause after **7 days** with no database activity.

`GET /api/health` does a cheap DB read specifically so a single ping resets **both**
timers at once (it fails soft to 200 on a DB blip — the `db` field reports the real
status without making the monitor page on a transient error).

Set up a free uptime monitor (no paid tier needed at this volume):

- **UptimeRobot** (free tier: 50 monitors, 5-minute interval) — recommended.
- **cron-job.org** (free, interval as low as 1 minute).

Configuration for either:
- **URL:** `https://<your-space>.hf.space/api/health`
- **Method:** GET
- **Interval:** every 5 minutes
- **Expected:** HTTP 200, body contains `"ok":true`

No credentials from RAGcast are needed on the monitor side — it's just an outbound GET.

---

## 6. Database ceiling to watch

Supabase's free tier caps the DB at **500MB**. Each episode (transcript + a few
hundred to ~1000 embedding rows at 384 dims) is roughly 1–3MB, so expect roughly
150–300 episodes before hitting the cap — fine for an MVP, but the first wall if
usage grows. Monitor via Supabase dashboard → Database → Database size.

---

## 7. End-to-end verification checklist

After both deploys are wired up:

1. Open the Vercel URL, sign in with Google.
2. Create a new episode from a YouTube URL.
3. Confirm a summary appears (proves: backend reachable, Groq LLM call succeeded,
   Supabase write succeeded).
4. Ask a question in the episode's chat.
5. Confirm the answer returns with the correct source badge — `transcript` (pure
   RAG), `web` (Tavily fallback), `hybrid` (both), or `summary` — depending on the
   question asked.
6. Refresh the page mid-session to confirm the SPA rewrite in `vercel.json` doesn't
   404 on a client-side route.
7. Wait past an idle period (or just trust the uptime monitor) and confirm the first
   request after idle succeeds, just slower (cold start), rather than erroring.

---

## Guardrails (do not violate when iterating on this setup)

- Never commit real secrets — they live only in HF Space secrets / Vercel env vars.
- Keep every piece on its free tier; this topology is locked in `CLAUDE.md` §16.
- Groq stays the primary LLM; OpenAI/Gemini are fallbacks only — don't reorder this.
- Embeddings stay local via Transformers.js; there is no embedding API key to set.
- Never bypass Row-Level Security in any query path — the schema enables RLS on
  every table; backend routes using the service-role key must keep scoping every
  query by user/episode ownership explicitly.
