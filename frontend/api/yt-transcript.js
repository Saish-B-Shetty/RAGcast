export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'Invalid or missing videoId' });
  }
  try {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

    // Use YouTube inner API with TVHTML5_SIMPLY_EMBEDDED_PLAYER client.
    // This client type does NOT require a poToken and works from server-side.
    const playerRes = await fetch('https://www.youtube.com/youtubei/v1/player', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '85',
        'X-YouTube-Client-Version': '2.0',
        'Origin': 'https://www.youtube.com',
        'Referer': `https://www.youtube.com/watch?v=${videoId}`,
        'User-Agent': ua,
      },
      body: JSON.stringify({
        context: {
          client: {
            clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
            clientVersion: '2.0',
            hl: 'en', gl: 'US',
          },
          thirdParty: { embedUrl: 'https://www.youtube.com/' }
        },
        videoId,
        playbackContext: { contentPlaybackContext: { signatureTimestamp: 19683 } }
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const playerData = await playerRes.json();
    const tracks = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

    if (!tracks.length) {
      // Fallback: scrape the watch page
      const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9' }
      });
      const html = await pageRes.text();
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
      const fallbackTracks = JSON.parse(html.slice(arr, p));
      if (!fallbackTracks.length) return res.status(404).json({ error: 'No caption tracks found' });
      tracks.push(...fallbackTracks);
    }

    const track = tracks.find(t => t.languageCode === 'en' && !t.kind)
      ?? tracks.find(t => t.languageCode === 'en')
      ?? tracks[0];

    // Fetch the caption content using json3 format
    const captionRes = await fetch(track.baseUrl + '&fmt=json3', {
      headers: { 'User-Agent': ua, 'Referer': `https://www.youtube.com/watch?v=${videoId}` },
      signal: AbortSignal.timeout(15_000),
    });
    const captionBody = await captionRes.text();

    if (!captionBody || captionBody.trim().length === 0) {
      return res.status(500).json({ error: 'Caption URL returned empty content', captionStatus: captionRes.status, trackLang: track.languageCode });
    }

    let parsed;
    try { parsed = JSON.parse(captionBody); } catch(e) {
      return res.status(500).json({ error: 'Non-JSON caption: ' + captionBody.slice(0,100) });
    }

    const fmt = (ms) => {
      const s = ms / 1000;
      const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
      const sec = (s % 60).toFixed(3).padStart(6, '0');
      return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${sec}`;
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
    if (vtt.trim() === 'WEBVTT') return res.status(500).json({ error: 'Parsed 0 caption segments' });

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(vtt);
  } catch (err) {
    console.error('[yt-transcript]', err);
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
