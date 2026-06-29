import { pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';

// Local embeddings via Transformers.js (CLAUDE.md §3, §7).
// Model: bge-small-en-v1.5 → 384 dims, matching chunks.embedding vector(384).
// Free, no API key, no rate limit. Loaded into memory once.
export const EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
export const EMBEDDING_DIMS = 384;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
  if (!extractorPromise) {
    // First load reads the model from disk (baked into the Docker image in prod, §16).
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL);
  }
  return extractorPromise;
}

// Embed a batch of texts → array of 384-d vectors (mean-pooled + L2-normalized).
// Pass arrays to batch for throughput (§3). Returns [] for empty input.
export async function embed(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await getExtractor();
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  // output.tolist() → number[][] of shape [texts.length, 384]
  return output.tolist() as number[][];
}

// Convenience for a single string.
export async function embedOne(text: string): Promise<number[]> {
  const [vec] = await embed([text]);
  return vec;
}

// Warm the model so the first real request isn't slow (optional).
export async function warmUpEmbeddings(): Promise<void> {
  await embed(['warmup']);
}
