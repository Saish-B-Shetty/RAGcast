export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error: 'bad videoId' });
  const debug = req.query?.debug === '1';
  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await pageRes.text();
    const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');
    const sessionHdrs = { 'User-Agent': ua, 'Origin': 'https://www.youtube.com', 'Referer': `https://www.youtube.com/watch?v=${videoId}`, ...(cookieHeader ? { Cookie: cookieHeader } : {}) };

    const transcriptParamsMatch = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"\}/);

    if (debug) {
      if (!transcriptParamsMatch) return res.status(200).json({ hasParams: false, htmlLen: html.length });
      const params = transcriptParamsMatch[1];
      const gtRes = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionHdrs },
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20200525.01.00', hl: 'en', gl: 'US' } }, params }),
        signal: AbortSignal.timeout(15_000),
      });
      const raw = await gtRes.text();
      return res.status(200).json({ gtStatus: gtRes.status, rawLen: raw.length, rawPreview: raw.slice(0, 600), params: params.slice(0, 50) });
    }

    if (!transcriptParamsMatch) return res.status(404).json({ error: 'No captions found' });
    const params = transcriptParamsMatch[1];
    const gtRes = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...sessionHdrs },
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20200525.01.00', hl: 'en', gl: 'US' } }, params }),
      signal: AbortSignal.timeout(15_000),
    });
    const gtData = await gtRes.json().catch(() => null);
    const segments = gtData?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;
    if (!segments || segments.length === 0) {
      return res.status(500).json({ error: 'get_transcript returned no segments', gtStatus: gtRes.status, gtKeys: gtData ? Object.keys(gtData).slice(0,5) : null });
    }
    const fmt = (ms) => { const s=ms/1000,h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${(s%60).toFixed(3).padStart(6,'0')}`; };
    const lines = ['WEBVTT', ''];
    for (const seg of segments) {
      const r = seg?.transcriptSegmentRenderer;
      if (!r) continue;
      const text = r.snippet?.runs?.map(run => run.text ?? '').join('').trim();
      if (!text) continue;
      const sMs = parseInt(r.startMs ?? '0', 10), eMs = parseInt(r.endMs ?? String(sMs+5000), 10);
      lines.push(`${fmt(sMs)} --> ${fmt(eMs)}`); lines.push(text); lines.push('');
    }
    if (lines.length <= 2) return res.status(500).json({ error: 'Parsed 0 segments' });
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(lines.join('\n'));
  } catch (err) {
    console.error('[yt-transcript]', err);
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
