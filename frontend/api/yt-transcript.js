export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error: 'bad videoId' });
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,*/*;q=0.8',
      'Cookie': 'CONSENT=YES+cb; SOCS=CAI' },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await pageRes.text();

  // Deep search for transcript segments anywhere in an object tree
  function findSegments(obj, depth = 0) {
    if (depth > 10 || !obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
      if (obj.length > 0 && obj[0]?.transcriptSegmentRenderer) return obj;
      for (const item of obj) { const r = findSegments(item, depth+1); if (r) return r; }
      return null;
    }
    if (obj.transcriptSegmentRenderer) return [obj];
    if (obj.initialSegments) return findSegments(obj.initialSegments, depth+1);
    for (const key of Object.keys(obj)) { const r = findSegments(obj[key], depth+1); if (r) return r; }
    return null;
  }

  const fmt = ms => { const s=ms/1000,h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${(s%60).toFixed(3).padStart(6,'0')}`; };

  const initDataMatch = html.match(/ytInitialData\s*=\s*(\{.+?\});/s);
  if (initDataMatch) {
    try {
      const data = JSON.parse(initDataMatch[1]);
      const panels = data?.engagementPanels ?? [];
      for (const panel of panels) {
        const psr = panel?.engagementPanelSectionListRenderer;
        if (psr?.panelIdentifier !== 'engagement-panel-searchable-transcript') continue;
        const panelContent = psr?.content;
        const contentKeys = Object.keys(panelContent ?? {});
        const segments = findSegments(panelContent);
        if (req.query?.debug === '1') {
          return res.status(200).json({ panelFound: true, contentKeys, hasSegments: !!segments, segCount: segments?.length ?? 0, firstText: segments?.[0]?.transcriptSegmentRenderer?.snippet?.runs?.[0]?.text });
        }
        if (segments?.length) {
          const lines = ['WEBVTT', ''];
          for (const seg of segments) {
            const r = seg?.transcriptSegmentRenderer; if (!r) continue;
            const text = r.snippet?.runs?.map(run => run.text ?? '').join('').trim(); if (!text) continue;
            const sMs = parseInt(r.startMs??'0',10), eMs = parseInt(r.endMs??String(sMs+5000),10);
            lines.push(`${fmt(sMs)} --> ${fmt(eMs)}`); lines.push(text); lines.push('');
          }
          if (lines.length > 2) {
            res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
            res.setHeader('Cache-Control', 'public, max-age=3600');
            return res.send(lines.join('\n'));
          }
        }
        if (req.query?.debug === '1') return res.status(200).json({ panelFound: true, contentKeys, noSegments: true });
      }
    } catch(e) { if (req.query?.debug === '1') return res.status(500).json({ parseError: String(e) }); }
  }
  if (req.query?.debug === '1') return res.status(200).json({ noPanelFound: true, htmlLen: html.length });
  return res.status(500).json({ error: 'Transcript not available in page data' });
}
