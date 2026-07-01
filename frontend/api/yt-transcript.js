export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid or missing videoId' });
  }
  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

    // Step 1: Fetch the YouTube watch page to get cookies + transcript params
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await pageRes.text();
    const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');
    const sessionHdrs = { 'User-Agent': ua, 'Origin': 'https://www.youtube.com', 'Referer': `https://www.youtube.com/watch?v=${videoId}`, ...(cookieHeader ? { Cookie: cookieHeader } : {}) };

    // Step 2: Try get_transcript API with params extracted from page HTML
    // The page embeds "getTranscriptEndpoint":{"params":"..."} for videos that support it
    const transcriptParamsMatch = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"\}/);
    if (transcriptParamsMatch) {
      const params = transcriptParamsMatch[1];
      const gtRes = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...sessionHdrs },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20200525.01.00', hl: 'en', gl: 'US' } },
          params,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const gtData = await gtRes.json().catch(() => null);
      const segments = gtData?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;
      if (segments && segments.length > 0) {
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
        if (lines.length > 2) {
          res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
          res.setHeader('Cache-Control', 'public, max-age=3600');
          return res.send(lines.join('\n'));
        }
      }
    }

    // Step 3: Fall back to captionTracks + timedtext
    const idx = html.indexOf('"captionTracks":');
    if (idx === -1) return res.status(404).json({ error: 'No captions found for this video', hasTranscriptEndpoint: !!transcriptParamsMatch });
    const arr = html.indexOf('[', idx);
    let d = 0, p = arr;
    while (p < html.length) {
      const c = html[p];
      if (c === '"') { p++; while (p < html.length) { if (html[p] === '"' && html[p-1] !== '\\') break; p++; } }
      else if (c === '[') d++; else if (c === ']') { d--; if (d === 0) { p++; break; } }
      p++;
    }
    const tracks = JSON.parse(html.slice(arr, p));
    if (!tracks.length) return res.status(404).json({ error: 'No caption tracks found' });
    const track = tracks.find(t => t.languageCode === 'en' && !t.kind) ?? tracks.find(t => t.languageCode === 'en') ?? tracks[0];

    const captionRes = await fetch(track.baseUrl + '&fmt=json3', {
      headers: sessionHdrs,
      signal: AbortSignal.timeout(15_000),
    });
    const body = await captionRes.text();
    if (!body || body.trim().length === 0) {
      return res.status(500).json({
        error: 'All transcript methods failed',
        hasTranscriptEndpoint: !!transcriptParamsMatch,
        timedtextStatus: captionRes.status,
        hint: 'YouTube blocks timedtext from datacenter IPs without poToken'
      });
    }
    const parsed = JSON.parse(body);
    const fmt2 = (ms) => { const s=ms/1000,h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${(s%60).toFixed(3).padStart(6,'0')}`; };
    const lines2 = ['WEBVTT', ''];
    for (const ev of (parsed.events ?? [])) {
      if (!ev.segs) continue;
      const text = ev.segs.map(s => s.utf8 ?? '').join('').replace(/\n/g, ' ').trim();
      if (!text) continue;
      lines2.push(fmt2(ev.tStartMs) + ' --> ' + fmt2(ev.tStartMs + (ev.dDurationMs ?? 5000)));
      lines2.push(text); lines2.push('');
    }
    const vtt2 = lines2.join('\n');
    if (vtt2.trim() === 'WEBVTT') return res.status(500).json({ error: 'Parsed 0 segments' });
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(vtt2);
  } catch (err) {
    console.error('[yt-transcript]', err);
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
