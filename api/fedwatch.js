export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // ═══ SOURCE 1: CME FedWatch JSON endpoints ═══
  const cmeEndpoints = [
    'https://www.cmegroup.com/services/fed-fund-target/fed-fund-target.json',
    'https://www.cmegroup.com/CmeWS/mvc/FedWatch/GetMiniFedWatch',
    'https://www.cmegroup.com/services/fedWatch.json'
  ];

  for (const url of cmeEndpoints) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html',
          'Origin': 'https://www.cmegroup.com'
        },
        signal: AbortSignal.timeout(8000)
      });
      if (r.ok) {
        const data = await r.json();
        if (data && (data.meetings || data.length > 0 || data.data)) {
          return res.status(200).json({ source: 'cme', data });
        }
      }
    } catch(e) {}
  }

  // ═══ SOURCE 2: Scrape CME FedWatch page for embedded data ═══
  try {
    const pageUrl = 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html';
    const r = await fetch(pageUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (r.ok) {
      const html = await r.text();
      // Look for JSON data embedded in page
      const jsonMatch = html.match(/fedWatchData\s*[:=]\s*(\{[\s\S]*?\})\s*[;,]/);
      const jsonMatch2 = html.match(/"meetings"\s*:\s*(\[[\s\S]*?\])/);
      const jsonMatch3 = html.match(/window\.__NEXT_DATA__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);

      if (jsonMatch) {
        try {
          const data = JSON.parse(jsonMatch[1]);
          return res.status(200).json({ source: 'cme-page', data });
        } catch(e) {}
      }
      if (jsonMatch2) {
        try {
          const meetings = JSON.parse(jsonMatch2[1]);
          return res.status(200).json({ source: 'cme-page', data: { meetings } });
        } catch(e) {}
      }
      if (jsonMatch3) {
        try {
          const nextData = JSON.parse(jsonMatch3[1]);
          return res.status(200).json({ source: 'cme-nextdata', data: nextData.props || nextData });
        } catch(e) {}
      }
    }
  } catch(e) {}

  // ═══ SOURCE 3: Use FRED API for Fed Funds Rate + futures implied ═══
  try {
    // Get current Fed Funds effective rate from FRED
    const fredUrl = 'https://api.stlouisfed.org/fred/series/observations?series_id=DFEDTARU&limit=1&sort_order=desc&file_type=json&api_key=DEMO_KEY';
    const r = await fetch(fredUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const fredData = await r.json();
      const obs = fredData.observations;
      if (obs && obs.length > 0) {
        const currentRate = parseFloat(obs[0].value);
        const rateDate = obs[0].date;

        // Also try to get market expectations from other FRED series
        // DFF = Daily Federal Funds Rate
        const fredUrl2 = 'https://api.stlouisfed.org/fred/series/observations?series_id=DFF&limit=1&sort_order=desc&file_type=json&api_key=DEMO_KEY';
        let effectiveRate = currentRate;
        try {
          const r2 = await fetch(fredUrl2, {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.timeout(5000)
          });
          if (r2.ok) {
            const d2 = await r2.json();
            if (d2.observations && d2.observations.length > 0) {
              effectiveRate = parseFloat(d2.observations[0].value);
            }
          }
        } catch(e) {}

        return res.status(200).json({
          source: 'fred',
          data: {
            currentTargetRate: currentRate,
            effectiveRate: effectiveRate,
            rateDate: rateDate,
            note: 'Current Fed Funds target rate from FRED. For meeting probabilities, visit CME FedWatch.'
          }
        });
      }
    }
  } catch(e) {}

  // ═══ FALLBACK: Return current rate info with link ═══
  return res.status(200).json({
    source: 'fallback',
    data: {
      currentTargetRange: '4.25% - 4.50%',
      lastUpdate: 'March 2025',
      note: 'CME FedWatch data unavailable from server. Current rate from last known FOMC decision.',
      link: 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html'
    }
  });
}
