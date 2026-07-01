export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error: 'bad videoId' });
  const debug = req.query?.debug === '1';
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,*/*;q=0.8',
        'Cookie': 'CONSENT=YES+cb; SOCS=CAI' },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await pageRes.text();

    // --- Strategy 1: Extract transcript from ytInitialData engagement panels ---
    // YouTube embeds transcript text in the engagement-panel-searchable-transcript panel
    const initDataMatch = html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
    if (initDataMatch) {
      try {
        const data = JSON.parse(initDataMatch[1]);
        const panels = data?.engagementPanels ?? [];
        for (const panel of panels) {
          const psr = panel?.engagementPanelSectionListRenderer;
          if (psr?.panelIdentifier !== 'engagement-panel-searchable-transcript') continue;
          const segments = psr?.content?.transcriptRenderer?.content
            ?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;
          if (!segments?.length) continue;

          if (debug) return res.status(200).json({ source: 'ytInitialData', segCount: segments.length, first: segments[0]?.transcriptSegmentRenderer?.snippet?.runs?.[0]?.text });

          const fmt = ms => { const s=ms/1000,h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${(s%60).toFixed(3).padStart(6,'0')}`; };
          const lines = ['WEBVTT', ''];
          for (const seg of segments) {
            const r = seg?.transcriptSegmentRenderer;
            if (!r) continue;
            const text = r.snippet?.runs?.map(run => run.text ?? '').join('').trim();
            if (!text) continue;
            const sMs = parseInt(r.startMs ?? '0', 10), eMs = parseInt(r.endMs ?? String(sMs+5000), 10);
            lines.push(`${fmt(sMs)} --> ${fmt(eMs)}`); lines.push(text); lines.push('');
          }
          if (lines.length > 2) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.send(lines.join('\n'));
          }
        }
      } catch (_) {}
    }
    // --- Strategy 2: get_transcript API with visitorData ---
    const visitorData = html.match(/"visitorData":"([^"]+)"/)?.[1];
    const params = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"\}/)?.[1];
    const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');

    if (debug) {
      const hasInitData = !!initDataMatch;
      const initDataLen = initDataMatch?.[1]?.length ?? 0;
      const htmlLen = html.length;
      // Check if transcript panel exists in ytInitialData
      let panelCheck = 'no-initdata';
      if (initDataMatch) {
        try {
          const d = JSON.parse(initDataMatch[1]);
          const panels = d?.engagementPanels ?? [];
          const tp = panels.find(p => p?.engagementPanelSectionListRenderer?.panelIdentifier === 'engagement-panel-searchable-transcript');
          if (tp) {
            const psr = tp.engagementPanelSectionListRenderer;
            const contentKeys = Object.keys(psr?.content ?? {});
            panelCheck = { found: true, contentKeys };
          } else {
            panelCheck = { found: false, panelIds: panels.map(p => p?.engagementPanelSectionListRenderer?.panelIdentifier) };
          }
        } catch(e) { panelCheck = { parseError: String(e), initDataLen }; }
      }
      return res.status(200).json({ htmlLen, hasInitData, initDataLen, panelCheck, hasParams: !!params, hasVisitorData: !!visitorData });
    }

    if (!params) return res.status(404).json({ error: 'No captions found' });
    const sessionHdrs = { 'Content-Type': 'application/json', 'User-Agent': ua, 'Origin': 'https://www.youtube.com', 'Referer': `https://www.youtube.com/watch?v=${videoId}`, ...(cookieHeader ? { Cookie: cookieHeader } : {}), ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}) };
    const gtRes = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false', {
      method: 'POST', headers: sessionHdrs,
      body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20200525.01.00', hl: 'en', gl: 'US', visitorData } }, params }),
      signal: AbortSignal.timeout(15_000),
    });
    const gtData = await gtRes.json().catch(() => null);
    const segments = gtData?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;
    if (!segments?.length) return res.status(500).json({ error: 'No transcript available', gtStatus: gtRes.status });
    const fmt = ms => { const s=ms/1000,h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${(s%60).toFixed(3).padStart(6,'0')}`; };
    const lines2 = ['WEBVTT', ''];
    for (const seg of segments) {
      const r = seg?.transcriptSegmentRenderer; if (!r) continue;
      const text = r.snippet?.runs?.map(run => run.text ?? '').join('').trim(); if (!text) continue;
      const sMs = parseInt(r.startMs??'0',10), eMs = parseInt(r.endMs??String(sMs+5000),10);
      lines2.push(`${fmt(sMs)} --> ${fmt(eMs)}`); lines2.push(text); lines2.push('');
    }
    if (lines2.length <= 2) return res.status(500).json({ error: 'Parsed 0 segments' });
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(lines2.join('\n'));
  } catch(err) { return res.status(500).json({ error: String(err?.message ?? err) }); }
}
