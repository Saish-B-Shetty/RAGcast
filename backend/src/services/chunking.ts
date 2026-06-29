import type { TimedSegment } from './timestamps.js';
import { embed } from './embeddings.js';

// Hybrid semantic chunking with size guardrails (CLAUDE.md §7):
//   * semantic boundaries — embed sentences, cut where consecutive similarity drops
//   * max ~600 tokens (splits long monologues), min ~150 tokens (merges fragments)
//   * attach start_ts/end_ts to every chunk (powers "Mentioned at 34:12")
// All thresholds are TUNABLE — calibrate in alpha.
export const MAX_TOKENS = 600;
export const MIN_TOKENS = 150;
// Cut at a semantic boundary when the distance (1 - cosine) between adjacent
// sentences is in the top (100 - PERCENTILE)% of distances.
export const BREAKPOINT_PERCENTILE = 90;

export interface Chunk {
  text: string;
  start_ts: number | null;
  end_ts: number | null;
  chunk_index: number;
}

// Rough token estimate (~0.75 words/token for English). Good enough for guardrails.
export function estimateTokens(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / 0.75);
}

interface Sentence {
  text: string;
  start: number | null;
  end: number | null;
}

// Flatten timed segments → sentences, carrying timing from the covering segments.
function buildSentences(segments: TimedSegment[]): Sentence[] {
  // Concatenate, tracking each segment's char range in the joined string.
  const ranges: { lo: number; hi: number; start: number | null; end: number | null }[] = [];
  let joined = '';
  for (const seg of segments) {
    const text = seg.text.trim();
    if (!text) continue;
    joined += (joined ? ' ' : '') + text;
    ranges.push({ lo: joined.length - text.length, hi: joined.length, start: seg.start, end: seg.end });
  }
  if (!joined) return [];

  // Sentence spans via end punctuation; fall back to the whole string.
  const spans: { lo: number; hi: number }[] = [];
  const re = /[^.!?]+[.!?]+(?:["')\]]+)?|\S[^.!?]*$/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(joined)) !== null) {
    const lo = m.index;
    const hi = m.index + m[0].length;
    if (joined.slice(lo, hi).trim()) spans.push({ lo, hi });
  }
  if (spans.length === 0) spans.push({ lo: 0, hi: joined.length });

  // Map each sentence span to the timing of the segments it overlaps.
  const sentences: Sentence[] = [];
  for (const span of spans) {
    let start: number | null = null;
    let end: number | null = null;
    for (const r of ranges) {
      if (r.hi <= span.lo || r.lo >= span.hi) continue; // no overlap
      if (r.start != null && (start == null || r.start < start)) start = r.start;
      if (r.end != null && (end == null || r.end > end)) end = r.end;
    }
    sentences.push({ text: joined.slice(span.lo, span.hi).trim(), start, end });
  }
  return sentences;
}

// Split any sentence that alone exceeds MAX_TOKENS into word-windows (keeps timing).
function splitHugeSentences(sentences: Sentence[]): Sentence[] {
  const out: Sentence[] = [];
  for (const s of sentences) {
    if (estimateTokens(s.text) <= MAX_TOKENS) {
      out.push(s);
      continue;
    }
    const words = s.text.split(/\s+/);
    const wordsPerChunk = Math.floor(MAX_TOKENS * 0.75);
    for (let i = 0; i < words.length; i += wordsPerChunk) {
      out.push({ text: words.slice(i, i + wordsPerChunk).join(' '), start: s.start, end: s.end });
    }
  }
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * (sorted.length - 1)));
  return sorted[idx];
}

function finalizeChunk(sentences: Sentence[], index: number): Chunk {
  let start: number | null = null;
  let end: number | null = null;
  for (const s of sentences) {
    if (s.start != null && (start == null || s.start < start)) start = s.start;
    if (s.end != null && (end == null || s.end > end)) end = s.end;
  }
  return {
    text: sentences.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim(),
    start_ts: start,
    end_ts: end,
    chunk_index: index,
  };
}

// Main entry. Pass TimedSegments (YouTube/manual-timed) or a single null-timed
// segment for plain text. Returns chunks with embeddings attached separately by
// the caller; here we only produce text + timings + index.
export async function chunkTranscript(segments: TimedSegment[]): Promise<Chunk[]> {
  let sentences = buildSentences(segments);
  if (sentences.length === 0) return [];
  sentences = splitHugeSentences(sentences);

  // Single sentence → single chunk.
  if (sentences.length === 1) return [finalizeChunk(sentences, 0)];

  // Embed sentences (batched) and compute adjacent distances (1 - cosine).
  // Vectors are L2-normalized, so cosine = dot product.
  const vecs = await embed(sentences.map((s) => s.text));
  const distances: number[] = [];
  for (let i = 0; i < vecs.length - 1; i++) {
    let dot = 0;
    const a = vecs[i];
    const b = vecs[i + 1];
    for (let d = 0; d < a.length; d++) dot += a[d] * b[d];
    distances.push(1 - dot);
  }
  const breakpoint = percentile([...distances].sort((x, y) => x - y), BREAKPOINT_PERCENTILE);

  // Greedy pass honoring both semantic breakpoints and size guardrails.
  const chunks: Chunk[] = [];
  let current: Sentence[] = [];
  let currentTokens = 0;
  const flush = () => {
    if (current.length) {
      chunks.push(finalizeChunk(current, chunks.length));
      current = [];
      currentTokens = 0;
    }
  };

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    const tks = estimateTokens(s.text);
    if (current.length === 0) {
      current.push(s);
      currentTokens = tks;
      continue;
    }
    const wouldExceedMax = currentTokens + tks > MAX_TOKENS;
    const atBreakpoint = distances[i - 1] >= breakpoint && distances[i - 1] > 0;
    if (wouldExceedMax || (atBreakpoint && currentTokens >= MIN_TOKENS)) {
      flush();
      current.push(s);
      currentTokens = tks;
    } else {
      current.push(s);
      currentTokens += tks;
    }
  }
  flush();

  // Merge a small trailing chunk into the previous one (min-size guardrail).
  if (chunks.length > 1) {
    const last = chunks[chunks.length - 1];
    if (estimateTokens(last.text) < MIN_TOKENS) {
      const prev = chunks[chunks.length - 2];
      prev.text = `${prev.text} ${last.text}`.trim();
      if (last.end_ts != null && (prev.end_ts == null || last.end_ts > prev.end_ts)) {
        prev.end_ts = last.end_ts;
      }
      chunks.pop();
    }
  }

  return chunks;
}
