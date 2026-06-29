// Web search fallback for low-confidence questions (CLAUDE.md §2, §6B).
// Tavily free tier. Fails gracefully (returns []) so a question still gets an
// answer path rather than crashing.

export interface WebResult {
  title: string;
  url: string;
  content: string;
}

export function isSearchConfigured(): boolean {
  return Boolean(process.env.TAVILY_API_KEY);
}

export async function webSearch(query: string, maxResults = 5): Promise<WebResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) return [];

  try {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: 'basic',
        max_results: maxResults,
      }),
    });
    if (!res.ok) {
      console.warn('[search] Tavily error', res.status);
      return [];
    }
    const json = (await res.json()) as {
      results?: { title?: string; url?: string; content?: string }[];
    };
    return (json.results ?? []).map((r) => ({
      title: r.title ?? '',
      url: r.url ?? '',
      content: r.content ?? '',
    }));
  } catch (err) {
    console.warn('[search] Tavily request failed:', (err as Error).message);
    return [];
  }
}
