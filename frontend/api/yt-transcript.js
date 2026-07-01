// api/yt-transcript.js
// Vercel serverless function: proxy YouTube transcripts for the HF Space backend,
// which cannot reach YouTube directly (datacenter IP ban at TLS level).
// Vercel Lambda IPs are not blocked by YouTube.

export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid or missing videoId' });
  }

  try {
    const html = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    }).then(r => r.text());

    // Extract captionTracks array using bracket-depth counting to handle nested JSON
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
        // Skip over string to avoid treating brackets inside strings as delimiters
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

    // Prefer English manual captions, then auto-generated, then first available
    const track =
      tracks.find(t => t.languageCode === 'en' && !t.kind) ??
      tracks.find(t => t.languageCode === 'en') ??
      tracks[0];

    const vtt = await fetch(track.baseUrl + '&fmt=vtt').then(r => r.text());

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(vtt);
  } catch (err) {
    console.error('[yt-transcript]', err);
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
