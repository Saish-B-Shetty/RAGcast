// Timestamp helpers (CLAUDE.md §6A C3, §7). A TimedSegment is the common shape
// the chunker consumes — from YouTube (real timings) or manual paste (parsed
// inline timestamps, else null → graceful degradation, no broken UI per §12).
export interface TimedSegment {
  text: string;
  start: number | null; // seconds
  end: number | null; // seconds
}

// Format seconds → "MM:SS" or "H:MM:SS".
export function formatTimestamp(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

// Parse "12:34" or "1:02:03" (and "[00:12:34]") → seconds, or null if not a timestamp.
export function parseTimestampToken(token: string): number | null {
  const cleaned = token.replace(/[[\]()]/g, '').trim();
  const m = cleaned.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = m[3] !== undefined ? Number(m[3]) : null;
  if (b > 59 || (c !== null && c > 59)) return null;
  return c !== null ? a * 3600 + b * 60 + c : a * 60 + b;
}

// Matches a timestamp token anywhere (used for detection + extraction).
const TS_TOKEN = /(\[?\(?\b\d{1,2}:\d{2}(?::\d{2})?\b\)?\]?)/g;

// True if the text contains at least a couple of timestamp tokens.
export function hasTimestamps(text: string): boolean {
  const matches = text.match(TS_TOKEN);
  return !!matches && matches.length >= 2;
}

// Extract distinct timestamp citations from answer text (for messages.timestamps_cited).
export function extractTimestampCitations(text: string): { label: string; seconds: number }[] {
  const out: { label: string; seconds: number }[] = [];
  const seen = new Set<number>();
  const re = new RegExp(TS_TOKEN);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const seconds = parseTimestampToken(m[0]);
    if (seconds !== null && !seen.has(seconds)) {
      seen.add(seconds);
      out.push({ label: formatTimestamp(seconds), seconds });
    }
  }
  return out;
}

// Split manual-paste text into timed segments using inline timestamps.
// Returns null if the text isn't reliably timestamped (→ chunks get null timings).
export function extractTimedSegments(text: string): TimedSegment[] | null {
  if (!hasTimestamps(text)) return null;

  // Collect every timestamp token with its position; text between two tokens
  // belongs to the earlier one.
  const tokens: { seconds: number; index: number; length: number }[] = [];
  const re = new RegExp(TS_TOKEN);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const seconds = parseTimestampToken(match[0]);
    if (seconds !== null) tokens.push({ seconds, index: match.index, length: match[0].length });
  }
  if (tokens.length < 2) return null;

  const segments: TimedSegment[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const next = tokens[i + 1];
    const chunkText = text.slice(tok.index + tok.length, next ? next.index : text.length).trim();
    if (chunkText) {
      segments.push({ text: chunkText, start: tok.seconds, end: next ? next.seconds : null });
    }
  }

  return segments.length ? segments : null;
}
