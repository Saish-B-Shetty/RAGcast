export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid or missing videoId' });
  }
  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

    // Strategy 1: YouTube get_transcript inner API (used by "Show transcript" UI feature)
    // Params is protobuf-encoded videoId: field 1, wire type 2, length 11
    const protoBytes = new Uint8Array([0x0a, videoId.length, ...videoId.split('').map(c => c.charCodeAt(0))]);
    const params = Buffer.from(protoBytes).toString('base64');

    const gtRes = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': ua, 'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': '2.20240101.00.00' },
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en', gl: 'US' } },
        params
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (gtRes.ok) {
      const gtData = await gtRes.json().catch(() => null);
      const cueGroups = gtData?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;
      if (cueGroups && cueGroups.length > 0) {
        const lines = ['WEBVTT', ''];
        for (const seg of cueGroups) {
          const r = seg?.transcriptSegmentRenderer;
          if (!r) continue;
          const text = r.snippet?.runs?.map(run => run.text ?? '').join('').trim();
          if (!text) continue;
          const startMs = parseInt(r.startMs ?? '0', 10);
          const endMs = parseInt(r.endMs ?? String(startMs + 5000), 10);
          const fmt = (ms) => {
            const s = ms / 1000;
            const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
            return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${(s % 60).toFixed(3).padStart(6,'0')}`;
          };
          lines.push(`${fmt(startMs)} --> ${fmt(endMs)}`);
          lines.push(text); lines.push('');
        }
        if (lines.length > 2) {
          res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.send(lines.join('\n'));
        }
      }
    }

    // Strategy 2: scrape watch page for captionTracks + fetch via timedtext
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await pageRes.text();
    const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');

    const idx = html.indexOf('"captionTracks":');
    if (idx === -1) return res.status(404).json({ error: 'No captions found for this video' });
    const arr = html.indexOf('[', idx);
    let d = 0, p = arr;
    while (p < html.length) {
      const c = html[p];
      if (c === '"') { p++; while (p < html.length) { if (html[p] === '"' && html[p-1] !== '\\') break; p++; } }
      else if (c === '[') d++;
      else if (c === ']') { d--; if (d === 0) { p++; break; } }
      p++;
    }
    const tracks = JSON.parse(html.slice(arr, p));
    if (!tracks.length) return res.status(404).json({ error: 'No caption tracks found' });

    const track = tracks.find(t => t.languageCode === 'en' && !t.kind)
      ?? tracks.find(t => t.languageCode === 'en') ?? tracks[0];

    const captionRes = await fetch(track.baseUrl + '&fmt=json3', {
      headers: { 'User-Agent': ua, 'Referer': `https://www.youtube.com/watch?v=${videoId}`, ...(cookieHeader ? { Cookie: cookieHeader } : {}) },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await captionRes.text();
    if (!body || body.trim().length === 0) {
      return res.status(500).json({ error: 'Caption URL returned empty content', gtStatus: gtRes.status });
    }
    const parsed = JSON.parse(body);
    const fmt = (ms) => {
      const s = ms / 1000, h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${(s % 60).toFixed(3).padStart(6,'0')}`;
    };
    const lines = ['WEBVTT', ''];
    for (const ev of (parsed.events ?? [])) {
      if (!ev.segs) continue;
      const text = ev.segs.map(s => s.utf8 ?? '').join('').replace(/\n/g, ' ').trim();
      if (!text) continue;
      lines.push(fmt(ev.tStartMs) + ' --> ' + fmt(ev.tStartMs + (ev.dDurationMs ?? 5000)));
      lines.push(text); lines.push('');
    }
    const vtt = lines.join('\n');
    if (vtt.trim() === 'WEBVTT') return res.status(500).json({ error: 'Parsed 0 segments' });
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(vtt);
  } catch (err) {
    console.error('[yt-transcript]', err);
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
