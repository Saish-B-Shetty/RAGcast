import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { supabaseAdmin } from '../lib/supabase.js';
import { processEpisode, DEFAULT_YT_NAME } from '../services/ingestion.js';
import { answerQuestion } from '../services/rag.js';
import type { CreateEpisodeRequest } from '@shared/types';

export const episodesRouter = Router();

// POST /api/episodes — create + start ingestion (async, returns 202).
// Sprint 1: creates the episode (status='processing') + transcript row, then
// STOPS. Transcript fetching, chunking, embedding, summary, and extraction are
// later sprints (the episode stays in 'processing').
episodesRouter.post('/', requireAuth, async (req, res) => {
  const userId = req.userId!;
  const body = req.body as CreateEpisodeRequest;

  const sourceType = body?.source_type;
  if (sourceType !== 'youtube_url' && sourceType !== 'manual_paste') {
    return res.status(400).json({
      error: { code: 'invalid_source_type', message: 'source_type must be youtube_url or manual_paste.' },
    });
  }

  const transcript = (body.transcript ?? '').trim();
  const sourceUrl = (body.source_url ?? '').trim();

  if (sourceType === 'youtube_url' && !sourceUrl) {
    return res
      .status(400)
      .json({ error: { code: 'missing_source_url', message: 'A YouTube URL is required.' } });
  }
  if (sourceType === 'manual_paste' && !transcript) {
    return res
      .status(400)
      .json({ error: { code: 'missing_transcript', message: 'Transcript text is required.' } });
  }

  const name =
    (body.name ?? '').trim() ||
    (sourceType === 'manual_paste' ? 'Untitled Episode' : DEFAULT_YT_NAME);

  // Service-role client bypasses RLS — scope explicitly by user_id (§12).
  const { data: episode, error: epErr } = await supabaseAdmin
    .from('episodes')
    .insert({
      user_id: userId,
      name,
      source_type: sourceType,
      source_url: sourceType === 'youtube_url' ? sourceUrl : null,
      status: 'processing',
      has_timestamps: false,
    })
    .select('id, name, status, created_at, updated_at')
    .single();

  if (epErr || !episode) {
    return res
      .status(500)
      .json({ error: { code: 'create_failed', message: epErr?.message ?? 'Could not create episode.' } });
  }

  const { error: trErr } = await supabaseAdmin
    .from('transcripts')
    .insert({ episode_id: episode.id, content: transcript });

  if (trErr) {
    // Roll back the episode so we don't leave an orphan with no transcript row.
    await supabaseAdmin.from('episodes').delete().eq('id', episode.id);
    return res
      .status(500)
      .json({ error: { code: 'transcript_failed', message: trErr.message } });
  }

  // 202 Accepted — respond immediately, then ingest in the background (§6A).
  res.status(202).json({ episode });
  void processEpisode(episode.id);
});

// POST /api/episodes/:id/ask — RAG question → answer (CLAUDE.md §6B).
episodesRouter.post('/:id/ask', requireAuth, async (req, res) => {
  const userId = req.userId!;
  const episodeId = req.params.id;
  const question = (req.body?.question ?? '').toString().trim();

  if (!question) {
    return res
      .status(400)
      .json({ error: { code: 'missing_question', message: 'A question is required.' } });
  }

  // Verify ownership (service role bypasses RLS, so scope explicitly — §12).
  const { data: episode, error: epErr } = await supabaseAdmin
    .from('episodes')
    .select('id')
    .eq('id', episodeId)
    .eq('user_id', userId)
    .single();
  if (epErr || !episode) {
    return res.status(404).json({ error: { code: 'not_found', message: 'Episode not found.' } });
  }

  // Persist the user's question first so it's in history even if synthesis fails.
  await supabaseAdmin
    .from('messages')
    .insert({ episode_id: episodeId, role: 'user', content: question, source: null });

  try {
    const answer = await answerQuestion(episodeId, question);
    const { data: message, error: msgErr } = await supabaseAdmin
      .from('messages')
      .insert({
        episode_id: episodeId,
        role: 'assistant',
        content: answer.content,
        source: answer.source,
        timestamps_cited: answer.timestamps_cited,
      })
      .select('id, episode_id, role, content, source, timestamps_cited, created_at')
      .single();
    if (msgErr || !message) throw new Error(msgErr?.message ?? 'Failed to persist answer.');
    return res.json({ message });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to answer the question.';
    return res.status(500).json({ error: { code: 'answer_failed', message } });
  }
});
