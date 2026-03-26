export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  try {
    // CME FedWatch API - get meeting probabilities
    const url = 'https://www.cmegroup.com/services/fed-fund-target/fed-fund-target.json';
    const r = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Referer': 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!r.ok) {
      // Fallback: try alternate endpoint
      const url2 = 'https://www.cmegroup.com/CmeWS/mvc/FedWatch/GetMiniFedWatch';
      const r2 = await fetch(url2, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(10000)
      });

      if (!r2.ok) {
        return res.status(200).json({ error: 'CME API unavailable', meetings: [] });
      }

      const data2 = await r2.json();
      return res.status(200).json(data2);
    }

    const data = await r.json();
    return res.status(200).json(data);
  } catch (e) {
    // Return empty data rather than error
    res.status(200).json({ error: e.message, meetings: [] });
  }
}
