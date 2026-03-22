export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'Missing symbols param' });

  const symList = symbols.split(',').slice(0, 30);
  const results = {};

  await Promise.all(symList.map(async (sym) => {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym.trim())}?interval=1d&range=5d&includePrePost=false`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) { results[sym] = null; return; }
      const data = await r.json();
      if (!data.chart || !data.chart.result || !data.chart.result[0]) { results[sym] = null; return; }
      const meta = data.chart.result[0].meta;
      let price = meta.regularMarketPrice;
      let prev = meta.chartPreviousClose || meta.previousClose;
      if (!price) {
        const q = data.chart.result[0].indicators?.quote?.[0];
        if (q?.close) {
          for (let i = q.close.length - 1; i >= 0; i--) { if (q.close[i] !== null) { price = q.close[i]; break; } }
          if (!prev) { for (let i = q.close.length - 2; i >= 0; i--) { if (q.close[i] !== null) { prev = q.close[i]; break; } } }
        }
      }
      results[sym] = price ? { price, prevClose: prev || price } : null;
    } catch (e) { results[sym] = null; }
  }));

  res.status(200).json(results);
}
