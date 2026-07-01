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

    if (!html.includes('"captionTracks":')) {
      return res.status(404).json({ error: 'No captions available for this video' });
    }

    const captionsSection = html.split('"captionTracks":')[1];
    const tracksJson = '[' + captionsSection.split(']')[0] + ']';
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
