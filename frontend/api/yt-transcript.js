export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error: 'bad videoId' });
  const debug = req.query?.debug === '1';
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,*/*;q=0.8', 'Cookie': 'CONSENT=YES+cb; SOCS=CAI' },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await pageRes.text();
  const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
  const cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');

  // Extract current client config from page (avoids using stale hardcoded version)
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? '2.20241201.01.00';
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  const visitorData = html.match(/"visitorData":"([^"]+)"/)?.[1];
  const hl = html.match(/"hl":"([^"]+)"/)?.[1] ?? 'en';
  const gl = html.match(/"gl":"([^"]+)"/)?.[1] ?? 'US';

  // Extract params + clickTrackingParams from engagement panel continuation
  let params = null, clickTrackingParams = null;
  const mm = html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
  if (mm) {
    try {
      const d = JSON.parse(mm[1]);
      for (const panel of d?.engagementPanels ?? []) {
        const psr = panel?.engagementPanelSectionListRenderer;
        if (psr?.panelIdentifier !== 'engagement-panel-searchable-transcript') continue;
        const content = psr?.content ?? {};
        // Recursively find getTranscriptEndpoint
        const str = JSON.stringify(content);
        const pm = str.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"/);
        if (pm) params = pm[1];
        const ctm = str.match(/"clickTrackingParams":"([^"]+)"/);
        if (ctm) clickTrackingParams = ctm[1];
        break;
      }
    } catch(_) {}
  }
  // Fallback: extract params from playerResponse
  if (!params) params = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"/)?.[1];
  if (debug) return res.status(200).json({ clientVersion, apiKey: apiKey.slice(0,10)+'...', hasVisitorData: !!visitorData, hasParams: !!params, hasClickTracking: !!clickTrackingParams, hl, gl });

  if (!params) return res.status(404).json({ error: 'No captions found' });

  const sessionHdrs = {
    'Content-Type': 'application/json',
    'User-Agent': ua,
    'X-Origin': 'https://www.youtube.com',
    'X-Goog-Origin': 'https://www.youtube.com',
    'Origin': 'https://www.youtube.com',
    'Referer': `https://www.youtube.com/watch?v=${videoId}`,
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
    ...(clickTrackingParams ? { 'X-Goog-Yt-Click-Tracking-Params': clickTrackingParams } : {}),
  };

  const body = JSON.stringify({
    context: { client: { clientName: 'WEB', clientVersion, hl, gl, visitorData, userAgent: ua } },
    params,
    ...(clickTrackingParams ? { clickTracking: { clickTrackingParams } } : {}),
  });

  const gtRes = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`, {
    method: 'POST', headers: sessionHdrs, body,
    signal: AbortSignal.timeout(15_000),
  });
  const raw = await gtRes.text();
  const gtData = JSON.parse(raw);
  const segments = gtData?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;
  if (!segments?.length) return res.status(500).json({ error: 'No segments', gtStatus: gtRes.status, gtPreview: raw.slice(0,300) });

  const fmt = ms => { const s=ms/1000,h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${(s%60).toFixed(3).padStart(6,'0')}`; };
  const lines = ['WEBVTT', ''];
  for (const seg of segments) {
    const r = seg?.transcriptSegmentRenderer; if (!r) continue;
    const text = r.snippet?.runs?.map(x => x.text ?? '').join('').trim(); if (!text) continue;
    const sMs = parseInt(r.startMs??'0',10), eMs = parseInt(r.endMs??String(sMs+5000),10);
    lines.push(`${fmt(sMs)} --> ${fmt(eMs)}`); lines.push(text); lines.push('');
  }
  if (lines.length <= 2) return res.status(500).json({ error: 'Parsed 0 segments' });
  res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  return res.send(lines.join('\n'));
}
