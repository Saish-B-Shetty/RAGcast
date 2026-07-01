export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid or missing videoId' });
  }
  try {
    const pageHeaders = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };

    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, { headers: pageHeaders });
    const html = await pageRes.text();

    // Forward cookies from the page response when fetching caption URLs.
    // YouTube's caption endpoints validate session context; without these
    // cookies the VTT response comes back silently empty.
    const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');

    const captionStart = html.indexOf('"captionTracks":');
    if (captionStart === -1) {
      return res.status(404).json({ error: 'No captions available for this video' });
    }
    const arrStart = html.indexOf('[', captionStart);
    if (arrStart === -1) {
      return res.status(404).json({ error: 'Malformed caption data' });
    }

    let depth = 0, pos = arrStart;
    while (pos < html.length) {
      const ch = html[pos];
      if (ch === '"') {
        pos++;
        while (pos < html.length) {
          if (html[pos] === '"' && html[pos - 1] !== '\\') break;
          pos++;
        }
      } else if (ch === '[') {
        depth++;
      } else if (ch === ']') {
        depth--;
        if (depth === 0) { pos++; break; }
      }
      pos++;
    }

    const tracksJson = html.slice(arrStart, pos);
    const tracks = JSON.parse(tracksJson);
    if (!tracks.length) {
      return res.status(404).json({ error: 'No caption tracks found' });
    }

    const track =
      tracks.find(t => t.languageCode === 'en' && !t.kind) ??
      tracks.find(t => t.languageCode === 'en') ??
      tracks[0];

    const captionFetchHeaders = {
      'User-Agent': pageHeaders['User-Agent'],
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': `https://www.youtube.com/watch?v=${videoId}`,
    };
    if (cookieHeader) captionFetchHeaders['Cookie'] = cookieHeader;

    const vttRes = await fetch(track.baseUrl + '&fmt=vtt', { headers: captionFetchHeaders });
    const vtt = await vttRes.text();

    if (!vtt || vtt.trim().length === 0) {
      return res.status(500).json({ error: 'Caption URL returned empty content' });
    }

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(vtt);
  } catch (err) {
    console.error('[yt-transcript]', err);
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
