import { supabaseAdmin } from '../lib/supabase.js';
import { embedOne } from './embeddings.js';
import { chatComplete, type ChatMessage } from './llm.js';
import { webSearch, type WebResult } from './search.js';
import { formatTimestamp, extractTimestampCitations } from './timestamps.js';
import type { MessageSource, TimestampCitation } from '@shared/types';

// RAG retrieval + confidence (CLAUDE.md §6B). Answer synthesis is added in a
// later step; this module owns vector search and the confidence decision.

// Top-K chunks to retrieve (§6B: 4–6).
export const TOP_K = 6;

// Confidence thresholds on the TOP chunk's cosine similarity. TUNABLE —
// calibrate in alpha. bge-small relevant matches sit ~0.55–0.8; off-topic ~0.2–0.4.
export const HIGH_THRESHOLD = 0.55; // >= → answer from transcript
export const LOW_THRESHOLD = 0.35; //  < → fall back to web search
// between the two → partial: stitch transcript + web (hybrid)

export type Confidence = 'high' | 'partial' | 'low';

export interface RetrievedChunk {
  id: string;
  text: string;
  start_ts: number | null;
  end_ts: number | null;
  similarity: number;
}

// Embed the question locally and run vector similarity search for one episode.
export async function retrieveChunks(
  episodeId: string,
  question: string,
  k: number = TOP_K,
): Promise<RetrievedChunk[]> {
  const vec = await embedOne(question);
  // match_threshold stays at 0 here: we retrieve the full top-k (including weak
  // matches) so classifyConfidence() can read the top similarity and decide
  // high / partial / low. Gating happens in app code, not in the query.
  const { data, error } = await supabaseAdmin.rpc('match_chunks', {
    query_embedding: `[${vec.join(',')}]`,
    match_count: k,
    match_threshold: 0,
    filter_episode_id: episodeId,
  });
  if (error) throw new Error(`match_chunks failed: ${error.message}`);
  return (data ?? []) as RetrievedChunk[];
}

// Map the best similarity to a confidence band.
export function classifyConfidence(chunks: RetrievedChunk[]): Confidence {
  const top = chunks[0]?.similarity ?? 0;
  if (top >= HIGH_THRESHOLD) return 'high';
  if (top < LOW_THRESHOLD) return 'low';
  return 'partial';
}

// ---------------------------------------------------------------------------
// Answer synthesis (CLAUDE.md §6B)
// ---------------------------------------------------------------------------

export interface RagAnswer {
  content: string;
  source: MessageSource; // 'transcript' | 'web' | 'hybrid'
  timestamps_cited: TimestampCitation[];
}

const SYSTEM_PROMPT =
  'You are RAGcast, an assistant that answers questions about a specific podcast episode. ' +
  'Be accurate, concise, and conversational. Never invent facts. ' +
  'When transcript context includes a timestamp in [MM:SS] or [H:MM:SS] form, cite it inline ' +
  'in parentheses, e.g. "(38:12)", so the listener can jump to that moment.';

// Render retrieved chunks as timestamped context lines.
function chunksToContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c) => {
      const ts = c.start_ts != null ? `[${formatTimestamp(c.start_ts)}] ` : '';
      return `${ts}${c.text}`;
    })
    .join('\n\n');
}

function webToContext(results: WebResult[]): string {
  return results
    .map((r, i) => `(${i + 1}) ${r.title}\n${r.content}\nSource: ${r.url}`)
    .join('\n\n');
}

// Build timestamps_cited: prefer the ones the model actually cited; if none were
// cited but timed chunks were used, fall back to the top timed chunks' starts.
function buildCitations(answer: string, chunks: RetrievedChunk[]): TimestampCitation[] {
  const cited = extractTimestampCitations(answer);
  if (cited.length) return cited;
  return chunks
    .filter((c) => c.start_ts != null)
    .slice(0, 3)
    .map((c) => ({ label: formatTimestamp(c.start_ts as number), seconds: c.start_ts as number }));
}

// Full RAG pipeline for one question (§6B).
export async function answerQuestion(episodeId: string, question: string): Promise<RagAnswer> {
  const chunks = await retrieveChunks(episodeId, question);
  const confidence = classifyConfidence(chunks);

  if (confidence === 'high') {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `Answer the question using ONLY the transcript excerpts below. ` +
          `If they don't contain the answer, say so briefly.\n\n` +
          `TRANSCRIPT EXCERPTS:\n${chunksToContext(chunks)}\n\nQUESTION: ${question}`,
      },
    ];
    const content = await chatComplete(messages, { temperature: 0.2 });
    return { content, source: 'transcript', timestamps_cited: buildCitations(content, chunks) };
  }

  if (confidence === 'low') {
    const results = await webSearch(question);
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content: results.length
          ? `This episode's transcript doesn't cover the question. Answer using the web results ` +
            `below, and note that this comes from the web rather than the episode.\n\n` +
            `WEB RESULTS:\n${webToContext(results)}\n\nQUESTION: ${question}`
          : `This episode's transcript doesn't cover the question, and no web results are ` +
            `available. Briefly tell the user the episode doesn't discuss this.\n\nQUESTION: ${question}`,
      },
    ];
    const content = await chatComplete(messages, { temperature: 0.3 });
    return { content, source: 'web', timestamps_cited: [] };
  }

  // partial → stitch transcript + web
  const results = await webSearch(question);
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content:
        `The transcript partially covers this question. Combine the transcript excerpts with the ` +
        `web results into one coherent answer. Cite transcript timestamps inline where relevant, ` +
        `and lean on the web only to fill gaps.\n\n` +
        `TRANSCRIPT EXCERPTS:\n${chunksToContext(chunks)}\n\n` +
        `WEB RESULTS:\n${results.length ? webToContext(results) : '(none available)'}\n\n` +
        `QUESTION: ${question}`,
    },
  ];
  const content = await chatComplete(messages, { temperature: 0.3 });
  return { content, source: 'hybrid', timestamps_cited: buildCitations(content, chunks) };
}
