import { YoutubeTranscript } from 'youtube-transcript';
import type { TimedSegment } from './timestamps.js';

// YouTube ingestion (CLAUDE.md §6A): transcript via the public timed-text
// endpoint (youtube-transcript lib — NOT the Data API), title via oEmbed.

export class TranscriptUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptUnavailableError';
  }
}

// Extract an 11-char video id from a URL or raw id.
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  // raw id
  if (/^[\w-]{11}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith('youtube.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      // /embed/<id>, /shorts/<id>, /v/<id>
      const m = url.pathname.match(/\/(?:embed|shorts|v)\/([\w-]{11})/);
      if (m) return m[1];
    }
  } catch {
    // not a URL
  }
  return null;
}

// youtube-transcript returns offset/duration in ms (srv3) OR seconds (classic).
// Detect by magnitude: caption durations in seconds are small (<100), in ms huge.
function isMilliseconds(rows: { duration: number }[]): boolean {
  const maxDur = rows.reduce((m, r) => Math.max(m, r.duration || 0), 0);
  return maxDur > 100;
}

export interface FetchedTranscript {
  segments: TimedSegment[];
  fullText: string;
  hasTimestamps: boolean;
}

// Fetch + normalize a transcript to seconds-based TimedSegments.
export async function fetchTranscript(idOrUrl: string): Promise<FetchedTranscript> {
  const videoId = parseVideoId(idOrUrl);
  if (!videoId) throw new TranscriptUnavailableError('Could not parse a YouTube video id from the URL.');

  let rows;
  try {
    rows = await YoutubeTranscript.fetchTranscript(videoId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Transcript fetch failed.';
    throw new TranscriptUnavailableError(msg);
  }

  if (!rows || rows.length === 0) {
    throw new TranscriptUnavailableError('No captions available for this video.');
  }

  const divisor = isMilliseconds(rows) ? 1000 : 1;
  const segments: TimedSegment[] = rows.map((r) => {
    const start = r.offset / divisor;
    return { text: r.text.trim(), start, end: start + r.duration / divisor };
  });

  const fullText = segments.map((s) => s.text).join(' ').replace(/\s+/g, ' ').trim();
  return { segments, fullText, hasTimestamps: true };
}

// Fetch the video title via the keyless oEmbed endpoint (§6A C4). Null on failure.
export async function fetchTitle(idOrUrl: string): Promise<string | null> {
  const videoId = parseVideoId(idOrUrl);
  const watchUrl = videoId ? `https://www.youtube.com/watch?v=${videoId}` : idOrUrl;
  const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`;
  try {
    const res = await fetch(oembed);
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: string };
    return json.title?.trim() || null;
  } catch {
    return null;
  }
}
