import { formatTimestamp } from './timestamps.js';
import { webSearch } from './search.js';

// Enrichment for extracted books & people (CLAUDE.md §6A.5–6, §11 B4/B5, P4/P5).
// All enrichers degrade gracefully — a network/key failure yields nulls, never
// throws, so ingestion still stores the item with whatever it has.

export interface BookEnrichment {
  description: string | null;
  cover_url: string | null;
  amazon_url: string;
}

export interface PersonEnrichment {
  bio: string | null;
  photo_url: string | null;
}

// Amazon India search URL from title + author (§12 — buy link is an amazon.in search).
export function buildAmazonUrl(title: string, author: string | null): string {
  const q = `${title} ${author ?? ''}`.trim();
  return `https://www.amazon.in/s?k=${encodeURIComponent(q)}`;
}

// Google Books lookup for cover + description (key optional — public search works).
export async function enrichBook(title: string, author: string | null): Promise<BookEnrichment> {
  const amazon_url = buildAmazonUrl(title, author);
  try {
    // Encode each value but keep the `+` separators and `intitle:`/`inauthor:`
    // operators literal — Google Books needs them unescaped.
    const q =
      `intitle:${encodeURIComponent(title)}` +
      (author ? `+inauthor:${encodeURIComponent(author)}` : '');
    const key = process.env.GOOGLE_BOOKS_API_KEY;
    const url =
      `https://www.googleapis.com/books/v1/volumes?q=${q}&maxResults=1` +
      (key ? `&key=${key}` : '');
    const res = await fetch(url);
    if (!res.ok) return { description: null, cover_url: null, amazon_url };
    const json = (await res.json()) as {
      items?: { volumeInfo?: { description?: string; imageLinks?: { thumbnail?: string; smallThumbnail?: string } } }[];
    };
    const info = json.items?.[0]?.volumeInfo;
    const rawCover = info?.imageLinks?.thumbnail ?? info?.imageLinks?.smallThumbnail ?? null;
    return {
      description: info?.description ?? null,
      cover_url: rawCover ? rawCover.replace(/^http:/, 'https:') : null,
      amazon_url,
    };
  } catch (err) {
    console.warn('[enrichment] Google Books failed:', (err as Error).message);
    return { description: null, cover_url: null, amazon_url };
  }
}

// Person bio via web search (§6A.6). Photo left null — no free reliable image
// API; the UI shows a placeholder avatar (matches the prototype).
export async function enrichPerson(name: string): Promise<PersonEnrichment> {
  const results = await webSearch(name, 1);
  const snippet = results[0]?.content?.trim();
  if (!snippet) return { bio: null, photo_url: null };
  // Trim to the first sentence (or ~200 chars) for a one-line bio.
  const firstSentence = snippet.split(/(?<=[.!?])\s/)[0] ?? snippet;
  const bio = firstSentence.length > 200 ? `${firstSentence.slice(0, 197).trim()}…` : firstSentence;
  return { bio, photo_url: null };
}

// Find the first timed chunk that mentions `needle` → "MM:SS" (§11 B6, mentioned_at).
// Returns null if untimed or not found (graceful — the card omits the timestamp).
export function findMentionTimestamp(
  chunks: { text: string; start_ts: number | null }[],
  needle: string,
): string | null {
  const lower = needle.toLowerCase().trim();
  if (!lower) return null;
  for (const c of chunks) {
    if (c.start_ts != null && c.text.toLowerCase().includes(lower)) {
      return formatTimestamp(c.start_ts);
    }
  }
  return null;
}
