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
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(8000)
      });
      if (!r.ok) { results[sym] = null; return; }
      const data = await r.json();
      if (!data.chart || !data.chart.result || !data.chart.result[0]) { results[sym] = null; return; }

      const result = data.chart.result[0];
      const meta = result.meta;
      const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
      const timestamps = result.timestamp || [];

      let price = meta.regularMarketPrice;

      var dailyCloses = [];
      if (q && q.close) {
        for (var i = 0; i < q.close.length; i++) {
          if (q.close[i] !== null && q.close[i] !== undefined) {
            dailyCloses.push({ ts: timestamps[i], close: q.close[i] });
          }
        }
      }

      if (!price && dailyCloses.length > 0) {
        price = dailyCloses[dailyCloses.length - 1].close;
      }

      var prevClose = null;
      if (dailyCloses.length >= 2) {
        var lastTs = dailyCloses[dailyCloses.length - 1].ts;
        var lastDay = new Date(lastTs * 1000).toDateString();
        for (var j = dailyCloses.length - 2; j >= 0; j--) {
          var dayStr = new Date(dailyCloses[j].ts * 1000).toDateString();
          if (dayStr !== lastDay) {
            prevClose = dailyCloses[j].close;
            break;
          }
        }
      }

      if (!prevClose) {
        prevClose = meta.previousClose || meta.chartPreviousClose || price;
      }

      results[sym] = price ? { price: price, prevClose: prevClose } : null;
    } catch (e) {
      results[sym] = null;
    }
  }));

  res.status(200).json(results);
}
