export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'Missing url param' });

  // Only allow YouTube URLs
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.endsWith('youtube.com')) {
      return res.status(403).json({ error: 'Only youtube.com URLs are allowed' });
    }
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(15000)
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: 'Upstream returned ' + response.status });
    }

    const contentType = response.headers.get('content-type') || 'text/html';
    const body = await response.text();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).send(body);
  } catch (e) {
    res.status(500).json({ error: 'Proxy fetch failed: ' + e.message });
  }
}
