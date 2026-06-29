import { chatComplete, type ChatMessage } from './llm.js';

// Episode summary generation (CLAUDE.md §6A.4). 200–250 words from the FULL
// transcript (not chunks, so nothing is missed at a boundary). Enforced with a
// post-generation word-count check + regenerate. Static once inserted.

export const SUMMARY_MIN_WORDS = 200;
export const SUMMARY_MAX_WORDS = 250;
const MAX_ATTEMPTS = 3;

// Above this, summarise in parts then synthesise. Kept low so the single-shot
// path never sends more than the LLM's tokens-per-minute budget (Groq free 8b =
// 6k TPM): ~3000 words ≈ ~4k input tokens + 500 output stays under it. Longer
// transcripts go through the map-reduce path below.
const LONG_TRANSCRIPT_WORDS = 3000;
const PART_WORDS = 2500;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

const SYSTEM = 'You are RAGcast. You write clear, engaging summaries of podcast episodes.';

function distanceToRange(words: number): number {
  if (words < SUMMARY_MIN_WORDS) return SUMMARY_MIN_WORDS - words;
  if (words > SUMMARY_MAX_WORDS) return words - SUMMARY_MAX_WORDS;
  return 0;
}

// One summarization pass over `source`, optionally nudging length on retries.
async function summarizeOnce(source: string, previousWords?: number): Promise<string> {
  const nudge =
    previousWords !== undefined
      ? ` Your previous attempt was ${previousWords} words — adjust to land between ` +
        `${SUMMARY_MIN_WORDS} and ${SUMMARY_MAX_WORDS} words.`
      : '';
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    {
      role: 'user',
      content:
        `Summarize the following podcast transcript in ${SUMMARY_MIN_WORDS}–${SUMMARY_MAX_WORDS} ` +
        `words. Capture the main topics, key arguments, and notable moments in flowing prose ` +
        `(no bullet points, no headings).${nudge}\n\nTRANSCRIPT:\n${source}`,
    },
  ];
  return chatComplete(messages, { temperature: 0.4, maxTokens: 500, tier: 'quality' });
}

// Condense a very long transcript into section summaries, then join them.
async function mapReduceCondense(fullText: string): Promise<string> {
  const words = fullText.split(/\s+/);
  const parts: string[] = [];
  for (let i = 0; i < words.length; i += PART_WORDS) {
    parts.push(words.slice(i, i + PART_WORDS).join(' '));
  }

  const partSummaries: string[] = [];
  for (const part of parts) {
    const messages: ChatMessage[] = [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content:
          `Summarize this section of a podcast transcript in about 100 words, capturing its key ` +
          `points.\n\nSECTION:\n${part}`,
      },
    ];
    partSummaries.push(await chatComplete(messages, { temperature: 0.3, maxTokens: 250 }));
  }
  return partSummaries.join('\n\n');
}

// Generate a 200–250 word summary, enforcing the range across a few attempts.
export async function generateSummary(fullText: string): Promise<string> {
  const text = fullText.trim();
  if (!text) throw new Error('Cannot summarize an empty transcript.');

  // For very long transcripts, condense first so the final pass fits comfortably.
  const source = countWords(text) > LONG_TRANSCRIPT_WORDS ? await mapReduceCondense(text) : text;

  let best = '';
  let bestDistance = Infinity;
  let prevWords: number | undefined;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const summary = await summarizeOnce(source, prevWords);
    const words = countWords(summary);
    const distance = distanceToRange(words);
    if (distance < bestDistance) {
      best = summary;
      bestDistance = distance;
    }
    if (distance === 0) return summary; // within range
    prevWords = words;
  }

  // Best effort: return the closest attempt to the target range.
  return best;
}
