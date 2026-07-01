import crypto from 'node:crypto';

// Computes SAPISIDHASH auth header from SAPISID cookie value
// Standard Google API authentication for first-party web calls
function sapisidhash(sapisid, origin = 'https://www.youtube.com') {
  const ts = Math.floor(Date.now() / 1000);
  const hash = crypto.createHash('sha1').update(`${ts} ${sapisid} ${origin}`).digest('hex');
  return `SAPISIDHASH ${ts}_${hash}`;
}

const fmt = ms => { const s=ms/1000,h=Math.floor(s/3600),m=Math.floor((s%3600)/60); return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${(s%60).toFixed(3).padStart(6,'0')}`; };

export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error: 'bad videoId' });
  const debug = req.query?.debug === '1';

  // Read stored YouTube session from env (user's own cookies — set once in Vercel dashboard)
  const ytCookies = process.env.YT_COOKIES ?? '';
  const ytSapisid = process.env.YT_SAPISID ?? '';
  const hasAuth = !!(ytCookies && ytSapisid);

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,*/*;q=0.8', 'Cookie': 'CONSENT=YES+cb; SOCS=CAI' },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await pageRes.text();
    const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
    const freshCookies = rawCookies.map(c => c.split(';')[0]).join('; ');

    const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? '2.20260630.03.00';
    const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
    const visitorData = html.match(/"visitorData":"([^"]+)"/)?.[1];
    const params = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"/)?.[1];

    if (debug) return res.status(200).json({ hasAuth, hasParams: !!params, hasVisitorData: !!visitorData, clientVersion });
    if (!params) return res.status(404).json({ error: 'No captions found for this video' });
    // Build cookie header: env session cookies take priority over fresh page cookies
    const cookieHeader = hasAuth ? ytCookies : freshCookies;

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': ua,
      'Origin': 'https://www.youtube.com',
      'Referer': `https://www.youtube.com/watch?v=${videoId}`,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
      // SAPISIDHASH auth — required when using stored session cookies
      ...(hasAuth ? { Authorization: sapisidhash(ytSapisid), 'X-Origin': 'https://www.youtube.com' } : {}),
    };

    const gtRes = await fetch(`https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US', visitorData } },
        params,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const raw = await gtRes.text();
    const gtData = JSON.parse(raw);
    const segments = gtData?.actions?.[0]?.updateEngagementPanelAction?.content
      ?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body
      ?.transcriptSegmentListRenderer?.initialSegments;

    if (!segments?.length) {
      const gtStatus = gtRes.status;
      if (!hasAuth && gtStatus === 400) {
        return res.status(503).json({
          error: 'YouTube transcript access requires authentication. Please set YT_COOKIES and YT_SAPISID in your Vercel environment variables. See the README for instructions.',
          gtStatus,
        });
      }
      return res.status(500).json({ error: 'No segments returned', gtStatus, preview: raw.slice(0,200) });
    }

    const lines = ['WEBVTT', ''];
    for (const seg of segments) {
      const r = seg?.transcriptSegmentRenderer; if (!r) continue;
      const text = r.snippet?.runs?.map(x => x.text ?? '').join('').trim(); if (!text) continue;
      const sMs = parseInt(r.startMs ?? '0', 10), eMs = parseInt(r.endMs ?? String(sMs+5000), 10);
      lines.push(`${fmt(sMs)} --> ${fmt(eMs)}`); lines.push(text); lines.push('');
    }
    if (lines.length <= 2) return res.status(500).json({ error: 'Parsed 0 segments' });
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(lines.join('\n'));
  } catch(err) {
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
