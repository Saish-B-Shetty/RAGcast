// Edge runtime — runs on Cloudflare network, not AWS Lambda
export const config = { runtime: 'edge' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const fmt = (ms) => {
  const s = ms / 1000, h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${(s % 60).toFixed(3).padStart(6,'0')}`;
};

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('videoId');
  const debug = searchParams.get('debug') === '1';

  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return json({ error: 'bad videoId' }, 400);

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  try {
    const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,*/*;q=0.8' },
    });
    const html = await pageRes.text();
    const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
    const cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');

    const visitorData = html.match(/"visitorData":"([^"]+)"/)?.[1];
    const params = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"\}/)?.[1];

    if (!params) return json({ error: 'No captions found', htmlLen: html.length }, 404);

    const sessionHdrs = {
      'User-Agent': ua,
      'Origin': 'https://www.youtube.com',
      'Referer': `https://www.youtube.com/watch?v=${videoId}`,
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
      ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
    };
    // --- Attempt 1: ANDROID client (client 3, less auth-restricted) ---
    const androidRes = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false', {
      method: 'POST',
      headers: {
        ...sessionHdrs,
        'Content-Type': 'application/json',
        'X-YouTube-Client-Name': '3',
        'X-YouTube-Client-Version': '19.09.37',
      },
      body: JSON.stringify({
        context: {
          client: { clientName: 'ANDROID', clientVersion: '19.09.37', androidSdkVersion: 30, hl: 'en', gl: 'US', visitorData },
        },
        params,
      }),
    });
    const androidRaw = await androidRes.text();

    // --- Attempt 2: WEB client fallback ---
    let raw = androidRaw, status = androidRes.status;
    if (androidRes.status !== 200) {
      const webRes = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false', {
        method: 'POST',
        headers: { ...sessionHdrs, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20200525.01.00', hl: 'en', gl: 'US', visitorData } },
          params,
        }),
      });
      raw = await webRes.text();
      status = webRes.status;
    }

    if (debug) {
      return json({ androidStatus: androidRes.status, finalStatus: status, rawLen: raw.length, rawPreview: raw.slice(0, 800), hasVisitorData: !!visitorData, isEdge: true });
    }

    const gtData = JSON.parse(raw);
    const segments = gtData?.actions?.[0]?.updateEngagementPanelAction?.content?.transcriptRenderer?.content?.transcriptSearchPanelRenderer?.body?.transcriptSegmentListRenderer?.initialSegments;
    if (!segments?.length) return json({ error: 'get_transcript no segments', gtStatus: status, gtKeys: gtData ? Object.keys(gtData).slice(0,5) : null }, 500);

    const lines = ['WEBVTT', ''];
    for (const seg of segments) {
      const r = seg?.transcriptSegmentRenderer;
      if (!r) continue;
      const text = r.snippet?.runs?.map(run => run.text ?? '').join('').trim();
      if (!text) continue;
      const sMs = parseInt(r.startMs ?? '0', 10), eMs = parseInt(r.endMs ?? String(sMs + 5000), 10);
      lines.push(`${fmt(sMs)} --> ${fmt(eMs)}`); lines.push(text); lines.push('');
    }
    if (lines.length <= 2) return json({ error: 'Parsed 0 segments' }, 500);

    return new Response(lines.join('\n'), {
      headers: { 'Content-Type': 'text/vtt; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
    });

  } catch (err) {
    return json({ error: String(err?.message ?? err) }, 500);
  }
}
