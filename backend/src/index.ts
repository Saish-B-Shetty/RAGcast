import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { episodesRouter } from './routes/episodes.js';
import { warmUpEmbeddings } from './services/embeddings.js';
import { supabaseAdmin } from './lib/supabase.js';

const app = express();
app.use(express.json({ limit: '5mb' }));

// CORS for the frontend origin (CLAUDE.md §16)
const allowedOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
app.use(cors({ origin: allowedOrigin }));

// Lightweight health endpoint — also used by the uptime-monitor ping (§16).
// It performs a cheap DB read so the ping ALSO resets Supabase's 7-day idle
// pause (not just the HF Space sleep timer). Fails soft: DB trouble still
// returns 200 so the monitor doesn't page on a transient blip, but `db` flags it.
app.get('/api/health', async (_req, res) => {
  let db = false;
  try {
    const { error } = await supabaseAdmin
      .from('episodes')
      .select('id', { head: true, count: 'exact' })
      .limit(1);
    db = !error;
  } catch {
    db = false;
  }
  res.json({ ok: true, db, ts: new Date().toISOString() });
});

app.use('/api/episodes', episodesRouter);

const port = Number(process.env.PORT ?? 7860);
app.listen(port, () => {
  console.log(`RAGcast backend listening on :${port}`);
  // Load the embedding model now so the first /ask or ingest isn't slow (§14).
  warmUpEmbeddings()
    .then(() => console.log('Embedding model warmed up.'))
    .catch((e) => console.warn('Embedding warm-up failed:', (e as Error).message));
});
