// Invidious-based YouTube transcript proxy
// Invidious is an open-source YT frontend whose instances handle YouTube auth
// and serve caption VTT directly — bypassing IP blocking entirely.
// Multiple fallback instances for redundancy.

const INVIDIOUS_INSTANCES = [
  'https://invidious.io.lol',
  'https://yewtu.be',
  'https://inv.nadeko.net',
  'https://invidious.privacydev.net',
  'https://vid.puffyan.us',
];

async function fetchWithTimeout(url, opts = {}, timeoutMs = 8000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Try each Invidious instance until one responds with captions
async function getViaInvidious(videoId, debug) {
  const errors = [];
  for (const base of INVIDIOUS_INSTANCES) {
    try {
      // 1. Get caption track list
      const listRes = await fetchWithTimeout(`${base}/api/v1/captions/${videoId}`);
      if (!listRes.ok) { errors.push(`${base}: HTTP ${listRes.status}`); continue; }
      const listData = await listRes.json();
      const captions = listData?.captions ?? [];
      if (!captions.length) { errors.push(`${base}: no captions`); continue; }

      // Pick English caption (prefer non-auto-generated)
      const cap =
        captions.find(c => c.languageCode === 'en' && !c.label.toLowerCase().includes('auto')) ??
        captions.find(c => c.languageCode === 'en') ??
        captions[0];

      // 2. Fetch the VTT content via the Invidious proxy
      const vttUrl = `${base}${cap.url}&fmt=vtt`;
      const vttRes = await fetchWithTimeout(vttUrl);
      if (!vttRes.ok) { errors.push(`${base}: vtt HTTP ${vttRes.status}`); continue; }
      const vtt = await vttRes.text();
      if (!vtt || vtt.trim().length < 20) { errors.push(`${base}: empty vtt`); continue; }

      return { vtt, instance: base, label: cap.label, debug_errors: errors };
    } catch (e) {
      errors.push(`${base}: ${e.message ?? e}`);
    }
  }
  return { vtt: null, errors };
}
export default async function handler(req, res) {
  const videoId = req.query?.videoId;
  if (!videoId || !/^[\w-]{11}$/.test(videoId)) {
    return res.status(400).json({ error: 'bad videoId' });
  }
  const debug = req.query?.debug === '1';

  try {
    const result = await getViaInvidious(videoId, debug);

    if (!result.vtt) {
      return res.status(500).json({ error: 'All Invidious instances failed', details: result.errors });
    }

    if (debug) {
      return res.status(200).json({
        success: true,
        instance: result.instance,
        label: result.label,
        vttLen: result.vtt.length,
        vttPreview: result.vtt.slice(0, 300),
        errors: result.debug_errors,
      });
    }

    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return res.send(result.vtt);
  } catch (err) {
    console.error('[yt-transcript]', err);
    return res.status(500).json({ error: String(err?.message ?? err) });
  }
}
