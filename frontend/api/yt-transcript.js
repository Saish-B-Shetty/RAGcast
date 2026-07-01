export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) return res.status(400).json({ error: 'bad videoId' });
  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: { 'User-Agent': ua, 'Accept-Language': 'en-US,en;q=0.9', 'Cookie': 'CONSENT=YES+cb; SOCS=CAI' },
    signal: AbortSignal.timeout(15_000),
  });
  const html = await pageRes.text();
  const rawCookies = pageRes.headers.getSetCookie?.() ?? [];
  const cookieHeader = rawCookies.map(c => c.split(';')[0]).join('; ');
  const clientVersion = html.match(/"INNERTUBE_CLIENT_VERSION":"([^"]+)"/)?.[1] ?? '2.20260630.03.00';
  const apiKey = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)?.[1] ?? 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';
  const visitorData = html.match(/"visitorData":"([^"]+)"/)?.[1];
  const params = html.match(/"getTranscriptEndpoint":\{"params":"([^"]+)"/)?.[1];
  if (!params) return res.status(404).json({ error: 'no params', htmlLen: html.length });

  const base = { 'Content-Type': 'application/json', 'Origin': 'https://www.youtube.com', 'Referer': `https://www.youtube.com/watch?v=${videoId}`, ...(cookieHeader ? { Cookie: cookieHeader } : {}), ...(visitorData ? { 'X-Goog-Visitor-Id': visitorData } : {}) };
  const url = `https://www.youtube.com/youtubei/v1/get_transcript?key=${apiKey}&prettyPrint=false`;
  const clients = [
    { name: 'IOS', clientName: 'IOS', clientVersion: '19.45.4', ua: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)', extra: { 'X-YouTube-Client-Name': '5', 'X-YouTube-Client-Version': '19.45.4' } },
    { name: 'MWEB', clientName: 'MWEB', clientVersion: '2.20260630.03.00', ua, extra: { 'X-YouTube-Client-Name': '2' } },
    { name: 'ANDROID_TESTSUITE', clientName: 'ANDROID_TESTSUITE', clientVersion: '1.9', ua: 'com.google.android.youtube/1.9 (Linux; U; Android 11) gzip', extra: { 'X-YouTube-Client-Name': '30', 'X-YouTube-Client-Version': '1.9' } },
    { name: 'TV_EMBEDDED', clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER', clientVersion: '2.0', ua: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 5.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/5.0 TV Safari/538.1', extra: { 'X-YouTube-Client-Name': '85', 'X-YouTube-Client-Version': '2.0' } },
  ];

  const results = {};
  for (const c of clients) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { ...base, ...c.extra, 'User-Agent': c.ua },
        body: JSON.stringify({ context: { client: { clientName: c.clientName, clientVersion: c.clientVersion, hl: 'en', gl: 'US', visitorData } }, params }),
        signal: AbortSignal.timeout(10_000),
      });
      const text = await r.text();
      const hasSegments = text.includes('transcriptSegmentRenderer');
      results[c.name] = { status: r.status, hasSegments, preview: text.slice(0, 150) };
    } catch(e) { results[c.name] = { error: String(e) }; }
  }
  return res.status(200).json({ results, clientVersion, hasParams: !!params, hasVisitorData: !!visitorData });
}
