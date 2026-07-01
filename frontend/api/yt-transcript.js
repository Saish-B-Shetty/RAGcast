export const config = { runtime: 'edge' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: { 'Content-Type': 'application/json' } });
}

export default async function handler(request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('videoId');
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return json({ error: 'bad videoId' }, 400);

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', 'Accept': 'text/html,*/*;q=0.8' },
  });
  const html = await pageRes.text();
  const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
  const cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');
  const visitorData = html.match(/"visitorData":"([^"]+)"/)?.[1];
  const params = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"\}/)?.[1];

  // Extract first captionTrack baseUrl
  const captionStart = html.indexOf('"captionTracks":');
  let baseUrl = null;
  if (captionStart !== -1) {
    const m = html.slice(captionStart, captionStart + 3000).match(/"baseUrl":"([^"]+)"/);
    if (m) baseUrl = m[1].replace(/\\u0026/g, '&');
  }

  const sessionHdrs = {
    'User-Agent': ua, 'Origin': 'https://www.youtube.com',
    'Referer': `https://www.youtube.com/watch?v=${videoId}`,
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}),
  };
  const results = {};

  // Test A: Old-style timedtext (no sig required)
  try {
    const rA = await fetch(`https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&fmt=vtt`, { headers: sessionHdrs });
    const bA = await rA.text();
    results.A_oldTimedtext = { status: rA.status, len: bA.length, preview: bA.slice(0, 100) };
  } catch(e) { results.A_oldTimedtext = { error: String(e) }; }

  // Test B: baseUrl with json3 format (instead of vtt)
  if (baseUrl) {
    try {
      const rB = await fetch(baseUrl + '&fmt=json3', { headers: sessionHdrs });
      const bB = await rB.text();
      results.B_json3 = { status: rB.status, len: bB.length, preview: bB.slice(0, 150) };
    } catch(e) { results.B_json3 = { error: String(e) }; }
  }

  // Test C: TVHTML5_SIMPLY_EMBEDDED_PLAYER client (type 85)
  if (params) {
    try {
      const rC = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?prettyPrint=false', {
        method: 'POST',
        headers: { ...sessionHdrs, 'Content-Type': 'application/json',
          'X-YouTube-Client-Name': '85', 'X-YouTube-Client-Version': '2.0' },
        body: JSON.stringify({ context: { client: { clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', hl: 'en', gl: 'US' } }, params }),
      });
      const bC = await rC.text();
      results.C_tvhtml5 = { status: rC.status, len: bC.length, preview: bC.slice(0, 200) };
    } catch(e) { results.C_tvhtml5 = { error: String(e) }; }
  }

  // Test D: get_transcript with API key in URL (public key)
  if (params) {
    try {
      const rD = await fetch('https://www.youtube.com/youtubei/v1/get_transcript?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8&prettyPrint=false', {
        method: 'POST',
        headers: { ...sessionHdrs, 'Content-Type': 'application/json' },
        body: JSON.stringify({ context: { client: { clientName: 'WEB', clientVersion: '2.20200525.01.00', hl: 'en', gl: 'US', visitorData } }, params }),
      });
      const bD = await rD.text();
      results.D_withApiKey = { status: rD.status, len: bD.length, preview: bD.slice(0, 200) };
    } catch(e) { results.D_withApiKey = { error: String(e) }; }
  }

  // Test E: baseUrl raw XML (no fmt param)
  if (baseUrl) {
    try {
      const rE = await fetch(baseUrl, { headers: sessionHdrs });
      const bE = await rE.text();
      results.E_rawXml = { status: rE.status, len: bE.length, preview: bE.slice(0, 150) };
    } catch(e) { results.E_rawXml = { error: String(e) }; }
  }

  return json({ hasParams: !!params, hasBaseUrl: !!baseUrl, hasVisitorData: !!visitorData, results });
}
