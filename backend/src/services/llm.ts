import OpenAI from 'openai';

// LLM access for summary + answer synthesis (CLAUDE.md §2, §3).
// Provider priority: Groq → OpenAI → Gemini. Groq is the default because its
// free tier (no card) allows ~14.4k requests/day on llama-3.1-8b-instant, vs the
// Gemini free tier's 20 requests/DAY which a single ingestion blows through.
// LLM calls DO have free-tier limits → retry with exponential backoff (§3).

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  // 'quality' routes to a stronger model where accuracy matters (summary,
  // book/people extraction); 'fast' (default) uses the cheap/fast model for
  // chat answers. Each provider maps the tier to its own model.
  tier?: 'fast' | 'quality';
}

const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
// Groq's free tier is generous on requests/day but token-per-minute limited
// (8b: 6k TPM, 70b: 12k TPM), so long-transcript calls are chunked upstream.
// Two models: a fast 8b for chat answers, and a stronger 70b for the accuracy-
// critical tasks (summary + book/people extraction), selected via ChatOptions.tier.
const GROQ_MODEL = process.env.GROQ_MODEL ?? 'llama-3.1-8b-instant';
const GROQ_MODEL_QUALITY = process.env.GROQ_MODEL_QUALITY ?? 'llama-3.3-70b-versatile';
// gemini-1.5-flash was retired from the API. gemini-2.5-flash-lite is the current
// free Gemini model; kept only as a last-resort fallback (its free tier is just
// 20 requests/DAY). Override via GEMINI_MODEL on a paid tier.
const GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash-lite';

let openaiClient: OpenAI | null = null;
function getOpenAI(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!openaiClient) openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return openaiClient;
}

// Groq exposes an OpenAI-compatible API, so reuse the OpenAI SDK with a baseURL.
// maxRetries:0 — our withRetry owns backoff (so the SDK doesn't double-retry).
let groqClient: OpenAI | null = null;
function getGroq(): OpenAI | null {
  if (!process.env.GROQ_API_KEY) return null;
  if (!groqClient)
    groqClient = new OpenAI({
      apiKey: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      maxRetries: 0,
    });
  return groqClient;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function isRetryable(status: number | undefined): boolean {
  return status === 429 || (status !== undefined && status >= 500);
}

// How long the provider asked us to wait, in ms, from whatever it exposes:
//   - err.retryAfterMs  → set by geminiChat from the 429 body's RetryInfo
//   - err.headers['retry-after'] → OpenAI-SDK-style errors (OpenAI, Groq); seconds
function serverRetryMs(err: unknown): number {
  const e = err as { retryAfterMs?: number; headers?: unknown };
  if (typeof e.retryAfterMs === 'number') return e.retryAfterMs;
  const h = e.headers;
  let raw: string | null | undefined;
  if (h && typeof (h as Headers).get === 'function') raw = (h as Headers).get('retry-after');
  else if (h && typeof h === 'object') raw = (h as Record<string, string>)['retry-after'];
  const secs = raw ? parseFloat(raw) : NaN;
  return Number.isNaN(secs) ? 0 : Math.ceil(secs * 1000);
}

// Retry with exponential backoff + jitter on rate-limit / transient errors.
// If the provider tells us how long to wait (429 retryDelay / Retry-After),
// honor it — it's authoritative for per-minute (token) limits and avoids
// hammering. Capped so a pathological header can't stall ingestion forever.
async function withRetry<T>(fn: () => Promise<T>, retries = 5, baseMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (attempt === retries || !isRetryable(status)) throw err;
      const backoff = baseMs * 2 ** attempt + Math.random() * 250;
      await sleep(Math.min(Math.max(backoff, serverRetryMs(err)), 65_000));
    }
  }
  throw lastErr;
}

// Shared path for any OpenAI-compatible endpoint (OpenAI, Groq).
async function openAICompatChat(
  client: OpenAI,
  model: string,
  messages: ChatMessage[],
  opts: ChatOptions,
): Promise<string> {
  const res = await withRetry(() =>
    client.chat.completions.create({
      model,
      messages,
      temperature: opts.temperature ?? 0.3,
      max_tokens: opts.maxTokens ?? 700,
    }),
  );
  return res.choices[0]?.message?.content?.trim() ?? '';
}

async function groqChat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const client = getGroq();
  if (!client) throw new Error('Groq not configured.');
  const model = opts.tier === 'quality' ? GROQ_MODEL_QUALITY : GROQ_MODEL;
  return openAICompatChat(client, model, messages, opts);
}

async function openaiChat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const client = getOpenAI();
  if (!client) throw new Error('OpenAI not configured.');
  return openAICompatChat(client, OPENAI_MODEL, messages, opts);
}

// Minimal Gemini REST fallback (no SDK). Merges any system message into the prompt.
async function geminiChat(messages: ChatMessage[], opts: ChatOptions): Promise<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('Gemini not configured.');

  const system = messages.find((m) => m.role === 'system')?.content;
  const contents = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${key}`;
  const body = {
    contents,
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    generationConfig: {
      temperature: opts.temperature ?? 0.3,
      maxOutputTokens: opts.maxTokens ?? 700,
      // Gemini 2.5 models enable "thinking" by default, which consumes the
      // output-token budget BEFORE any visible text — starving/truncating
      // responses. These tasks (summary, extraction, answer synthesis) don't
      // need it, so disable it so maxOutputTokens applies to real output.
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  const res = await withRetry(async () => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) {
      const e = new Error(`Gemini error ${r.status}`) as Error & {
        status?: number;
        retryAfterMs?: number;
      };
      e.status = r.status;
      // Pull the server's suggested retry delay (e.g. "4.05s") out of the 429
      // body so withRetry can wait exactly that long for per-minute limits.
      try {
        const body = (await r.json()) as {
          error?: { details?: { '@type'?: string; retryDelay?: string }[] };
        };
        const info = body.error?.details?.find((d) =>
          d['@type']?.includes('RetryInfo'),
        );
        const secs = info?.retryDelay ? parseFloat(info.retryDelay) : NaN;
        if (!Number.isNaN(secs)) e.retryAfterMs = Math.ceil(secs * 1000);
      } catch {
        // body wasn't JSON — fall back to plain exponential backoff
      }
      throw e;
    }
    return r.json() as Promise<{
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    }>;
  });

  return res.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
}

// Chat completion with provider fallback, in priority order: Groq → OpenAI →
// Gemini. Tries each configured provider and falls back to the next on error.
// Throws only if no provider is configured or every configured one fails.
export async function chatComplete(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const providers: { name: string; enabled: boolean; run: () => Promise<string> }[] = [
    { name: 'Groq', enabled: Boolean(process.env.GROQ_API_KEY), run: () => groqChat(messages, opts) },
    { name: 'OpenAI', enabled: Boolean(process.env.OPENAI_API_KEY), run: () => openaiChat(messages, opts) },
    { name: 'Gemini', enabled: Boolean(process.env.GEMINI_API_KEY), run: () => geminiChat(messages, opts) },
  ].filter((p) => p.enabled);

  if (providers.length === 0) {
    throw new Error('No LLM provider configured (set GROQ_API_KEY, OPENAI_API_KEY, or GEMINI_API_KEY).');
  }

  let lastErr: unknown;
  for (let i = 0; i < providers.length; i++) {
    try {
      return await providers[i].run();
    } catch (err) {
      lastErr = err;
      const next = providers[i + 1];
      if (next) {
        console.warn(`[llm] ${providers[i].name} failed, falling back to ${next.name}:`, (err as Error).message);
      }
    }
  }
  throw lastErr;
}

export function isLlmConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY);
}
