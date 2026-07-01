export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid or missing videoId' });
  }
  const debug = req.query?.debug === '1';
  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
    });
    const html = await pageRes.text();
    const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');

    const captionStart = html.indexOf('"captionTracks":');
    if (captionStart === -1) return res.status(404).json({ error: 'No captions found' });
    const arrStart = html.indexOf('[', captionStart);
    if (arrStart === -1) return res.status(404).json({ error: 'Malformed caption data' });

    let depth = 0, pos = arrStart;
    while (pos < html.length) {
      const ch = html[pos];
      if (ch === '"') { pos++; while (pos < html.length) { if (html[pos] === '"' && html[pos-1] !== '\\') break; pos++; } }
      else if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) { pos++; break; } }
      pos++;
    }
    const tracks = JSON.parse(html.slice(arrStart, pos));
    if (!tracks.length) return res.status(404).json({ error: 'No caption tracks found' });

    const track = tracks.find(t => t.languageCode === 'en' && !t.kind) ?? tracks.find(t => t.languageCode === 'en') ?? tracks[0];
    const hdrs = { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', 'Referer': `https://www.youtube.com/watch?v=${videoId}` };
    if (cookieHeader) hdrs['Cookie'] = cookieHeader;

    // In debug mode: return the FULL baseUrl so client can test fetching it directly
    if (debug) {
      const captionUrl = track.baseUrl + '&fmt=json3';
      const captionRes = await fetch(captionUrl, { headers: hdrs });
      const captionBody = await captionRes.text();
      return res.status(200).json({
        trackCount: tracks.length, lang: track.languageCode, kind: track.kind,
        baseUrl: track.baseUrl,
        cookieCount: rawCookies.length,
        captionStatus: captionRes.status, captionLen: captionBody.length,
        captionPreview: captionBody.slice(0, 200)
      });
    }

    // Normal mode: try json3 format
    const captionUrl = track.baseUrl + '&fmt=json3';
    const captionRes = await fetch(captionUrl, { headers: hdrs });
    const captionBody = await captionRes.text();

    if (!captionBody || captionBody.trim().length === 0) {
      return res.status(500).json({ error: 'Caption URL returned empty content' });
    }

    let parsed;
    try { parsed = JSON.parse(captionBody); } catch(e) {
      return res.status(500).json({ error: 'Non-JSON: ' + captionBody.slice(0,100) });
    }

    const fmt = (ms) => {
      const s = ms / 1000;
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = (s % 60).toFixed(3);
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(6,'0')}`;
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
    if (!vtt || vtt.trim() === 'WEBVTT') return res.status(500).json({ error: 'json3 parsed to 0 segments' });

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(vtt);
  } catch (err) {
    console.error('[yt-transcript]', err);
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
