import { supabaseAdmin } from '../lib/supabase.js';
import { fetchTranscript, fetchTitle, TranscriptUnavailableError } from './youtube.js';
import { extractTimedSegments, type TimedSegment } from './timestamps.js';
import { chunkTranscript } from './chunking.js';
import { embed } from './embeddings.js';
import { generateSummary } from './summary.js';
import { isLlmConfigured } from './llm.js';
import { extractBooks, extractPeople } from './extraction.js';
import { enrichBook, enrichPerson, findMentionTimestamp } from './enrichment.js';
import type { Chunk } from './chunking.js';

// Default name the route assigns to a YouTube episode before the title is known.
export const DEFAULT_YT_NAME = 'New YouTube Episode';

const CHUNK_INSERT_BATCH = 200;

// Background ingestion job behind POST /api/episodes (CLAUDE.md §6A).
// Sprint 2 scope: transcript → timestamps → chunk → embed → insert chunks → ready.
// Summary and books/people extraction are added to this pipeline in later sprints.
// Never throws — failures set status='failed' so the frontend can prompt manual paste.
export async function processEpisode(episodeId: string): Promise<void> {
  try {
    const { data: episode, error: epErr } = await supabaseAdmin
      .from('episodes')
      .select('id, name, source_type, source_url')
      .eq('id', episodeId)
      .single();
    if (epErr || !episode) throw new Error(epErr?.message ?? 'Episode not found.');

    let segments: TimedSegment[];
    let hasTimestamps: boolean;
    let fullText: string;
    const episodePatch: Record<string, unknown> = {};

    if (episode.source_type === 'youtube_url') {
      if (!episode.source_url) throw new TranscriptUnavailableError('Missing YouTube URL.');
      const fetched = await fetchTranscript(episode.source_url);
      segments = fetched.segments;
      hasTimestamps = fetched.hasTimestamps;
      fullText = fetched.fullText;

      // Persist the fetched transcript and auto-name from the oEmbed title (§6A C4).
      await supabaseAdmin.from('transcripts').update({ content: fullText }).eq('episode_id', episodeId);
      const title = await fetchTitle(episode.source_url);
      if (title && episode.name === DEFAULT_YT_NAME) episodePatch.name = title;
    } else {
      // manual_paste — transcript already stored at creation.
      const { data: tr, error: trErr } = await supabaseAdmin
        .from('transcripts')
        .select('content')
        .eq('episode_id', episodeId)
        .single();
      if (trErr || !tr) throw new Error(trErr?.message ?? 'Transcript not found.');
      fullText = tr.content ?? '';
      if (!fullText.trim()) throw new Error('Transcript is empty.');

      const timed = extractTimedSegments(fullText);
      if (timed && timed.length) {
        segments = timed;
        hasTimestamps = true;
      } else {
        segments = [{ text: fullText, start: null, end: null }];
        hasTimestamps = false;
      }
    }

    // Chunk + batch-embed.
    const chunks = await chunkTranscript(segments);
    if (chunks.length === 0) throw new Error('Transcript produced no chunks.');
    const vectors = await embed(chunks.map((c) => c.text));

    // Idempotency: clear any prior chunks for this episode before inserting.
    await supabaseAdmin.from('chunks').delete().eq('episode_id', episodeId);

    const rows = chunks.map((c, i) => ({
      episode_id: episodeId,
      text: c.text,
      // pgvector accepts the bracketed string form '[v1,v2,...]'.
      embedding: `[${vectors[i].join(',')}]`,
      start_ts: c.start_ts,
      end_ts: c.end_ts,
      chunk_index: c.chunk_index,
      speaker: null,
    }));
    for (let i = 0; i < rows.length; i += CHUNK_INSERT_BATCH) {
      const batch = rows.slice(i, i + CHUNK_INSERT_BATCH);
      const { error } = await supabaseAdmin.from('chunks').insert(batch);
      if (error) throw new Error(`Chunk insert failed: ${error.message}`);
    }

    // Episode summary as the FIRST message (§6A.4). Non-fatal: if it fails, the
    // episode is still usable for Q&A. Static — generated once here.
    await generateEpisodeSummary(episodeId, fullText);

    // Books & people extraction (§6A.5–6). Non-fatal; populates the context
    // panel live via Realtime. Uses the chunks for mentioned_at timestamps.
    await extractBooksAndPeople(episodeId, fullText, chunks);

    // Mark ready (this UPDATE is what the frontend listens for via Realtime).
    const { error: readyErr } = await supabaseAdmin
      .from('episodes')
      .update({ ...episodePatch, has_timestamps: hasTimestamps, status: 'ready' })
      .eq('id', episodeId);
    if (readyErr) throw new Error(readyErr.message);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Ingestion failed.';
    console.error(`[ingestion] episode ${episodeId} failed:`, message);
    await supabaseAdmin.from('episodes').update({ status: 'failed' }).eq('id', episodeId);
  }
}

// Generate + insert the episode summary. Swallows its own errors so summary
// failure never blocks the episode from becoming Q&A-ready (§6A, §12).
async function generateEpisodeSummary(episodeId: string, fullText: string): Promise<void> {
  if (!isLlmConfigured()) {
    console.warn(`[ingestion] no LLM configured — skipping summary for ${episodeId}`);
    return;
  }
  try {
    const summary = await generateSummary(fullText);
    if (!summary.trim()) return;
    // Idempotency: replace any prior summary message (keeps Q&A history intact).
    await supabaseAdmin
      .from('messages')
      .delete()
      .eq('episode_id', episodeId)
      .eq('source', 'summary');
    await supabaseAdmin.from('messages').insert({
      episode_id: episodeId,
      role: 'assistant',
      content: summary,
      source: 'summary',
      timestamps_cited: null,
    });
  } catch (err) {
    console.warn(`[ingestion] summary failed for ${episodeId}:`, (err as Error).message);
  }
}

// Extract + enrich books and people, then insert. Books and people are handled
// independently and non-fatally so one failing doesn't block the other or `ready`.
async function extractBooksAndPeople(
  episodeId: string,
  fullText: string,
  chunks: Chunk[],
): Promise<void> {
  if (!isLlmConfigured()) {
    console.warn(`[ingestion] no LLM configured — skipping books/people for ${episodeId}`);
    return;
  }

  // Books
  try {
    const books = await extractBooks(fullText);
    const rows = [];
    for (const b of books) {
      const enriched = await enrichBook(b.title, b.author);
      rows.push({
        episode_id: episodeId,
        title: b.title,
        author: b.author,
        description: enriched.description,
        cover_url: enriched.cover_url,
        amazon_url: enriched.amazon_url,
        mentioned_at: findMentionTimestamp(chunks, b.title),
      });
    }
    await supabaseAdmin.from('books').delete().eq('episode_id', episodeId);
    if (rows.length) {
      const { error } = await supabaseAdmin.from('books').insert(rows);
      if (error) throw new Error(error.message);
    }
  } catch (err) {
    console.warn(`[ingestion] books extraction failed for ${episodeId}:`, (err as Error).message);
  }

  // People
  try {
    const people = await extractPeople(fullText);
    const rows = [];
    for (const p of people) {
      const enriched = await enrichPerson(p.name);
      rows.push({
        episode_id: episodeId,
        name: p.name,
        bio: enriched.bio,
        photo_url: enriched.photo_url,
        context_snippet: p.context_snippet,
        mentioned_at: findMentionTimestamp(chunks, p.name),
      });
    }
    await supabaseAdmin.from('people').delete().eq('episode_id', episodeId);
    if (rows.length) {
      const { error } = await supabaseAdmin.from('people').insert(rows);
      if (error) throw new Error(error.message);
    }
  } catch (err) {
    console.warn(`[ingestion] people extraction failed for ${episodeId}:`, (err as Error).message);
  }
}
