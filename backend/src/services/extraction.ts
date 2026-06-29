import { chatComplete, type ChatMessage } from './llm.js';

// Books & People extraction (CLAUDE.md §6A.5–6, §11 B1/P1). Runs on the FULL
// transcript (not chunks) so nothing is missed at a boundary. For very long
// transcripts we extract per part and merge, mirroring the summary step.

export interface ExtractedBook {
  title: string;
  author: string | null;
}

export interface ExtractedPerson {
  name: string;
  context_snippet: string | null;
}

// Kept small so a single extraction call stays under the LLM's tokens-per-minute
// budget (Groq free 8b = 6k TPM). ~2500 words ≈ ~3.3k input tokens + 900 output
// fits comfortably; longer transcripts are split into parts and merged below.
const PART_WORDS = 2500;
const SYSTEM = 'You extract structured data from podcast transcripts and reply with JSON only.';

// Tolerant JSON-array parse: strip code fences, take the outermost [ ... ].
function parseJsonArray<T>(raw: string): T[] {
  const cleaned = raw.replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function splitIntoParts(text: string): string[] {
  const words = text.trim().split(/\s+/);
  if (words.length <= PART_WORDS) return [text];
  const parts: string[] = [];
  for (let i = 0; i < words.length; i += PART_WORDS) {
    parts.push(words.slice(i, i + PART_WORDS).join(' '));
  }
  return parts;
}

async function extractPart<T>(instruction: string, part: string): Promise<T[]> {
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `${instruction}\n\nTRANSCRIPT:\n${part}` },
  ];
  const raw = await chatComplete(messages, { temperature: 0, maxTokens: 900, tier: 'quality' });
  return parseJsonArray<T>(raw);
}

const BOOK_INSTRUCTION =
  'List the books that are EXPLICITLY named in this podcast transcript excerpt. A book counts only ' +
  'if its actual title appears in the text (a work the speakers name, recommend, or discuss). ' +
  'Rules: (1) Use the exact title as spoken. (2) Give the author only if the transcript states it ' +
  'or it is unambiguous for that well-known title; otherwise set "author": null. (3) Do NOT include ' +
  'articles, papers, blog posts, podcasts, movies, or companies — books only. (4) Do NOT guess, ' +
  'infer, or invent a title or author that is not supported by the text. (5) No duplicates. ' +
  'Reply with ONLY a JSON array of {"title": string, "author": string|null}, or [] if none.';

const PEOPLE_INSTRUCTION =
  'List the real, specific people referred to BY NAME in this podcast transcript excerpt ' +
  '(e.g. authors, public figures, or guests named in the text). ' +
  'Rules: (1) Include a person only if an actual name appears in the text. (2) Give the name exactly ' +
  'as stated, plus a one-sentence "context_snippet" grounded in what the transcript actually says ' +
  'about them. (3) Do NOT include unnamed speakers ("Host"/"Guest"), generic roles, audiences, or ' +
  'groups. (4) Do NOT guess or invent anyone not named in the text. (5) No duplicates. ' +
  'Reply with ONLY a JSON array of {"name": string, "context_snippet": string|null}, or [] if none.';

export async function extractBooks(fullText: string): Promise<ExtractedBook[]> {
  const parts = splitIntoParts(fullText);
  const seen = new Map<string, ExtractedBook>();
  for (const part of parts) {
    const items = await extractPart<ExtractedBook>(BOOK_INSTRUCTION, part);
    for (const it of items) {
      const title = (it?.title ?? '').toString().trim();
      if (!title) continue;
      const author = (it?.author ?? '')?.toString().trim() || null;
      const key = `${title.toLowerCase()}|${(author ?? '').toLowerCase()}`;
      if (!seen.has(key)) seen.set(key, { title, author });
    }
  }
  return [...seen.values()];
}

export async function extractPeople(fullText: string): Promise<ExtractedPerson[]> {
  const parts = splitIntoParts(fullText);
  const seen = new Map<string, ExtractedPerson>();
  for (const part of parts) {
    const items = await extractPart<ExtractedPerson>(PEOPLE_INSTRUCTION, part);
    for (const it of items) {
      const name = (it?.name ?? '').toString().trim();
      if (!name) continue;
      const snippet = (it?.context_snippet ?? '')?.toString().trim() || null;
      const key = name.toLowerCase();
      if (!seen.has(key)) seen.set(key, { name, context_snippet: snippet });
    }
  }
  return [...seen.values()];
}
