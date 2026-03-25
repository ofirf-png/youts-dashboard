export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'Missing symbols param' });

  const symList = symbols.split(',').slice(0, 30);
  const results = {};

  await Promise.all(symList.map(async (sym) => {
    const s = sym.trim();
    try {
      // Fetch chart data for price + history
      const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=1y&includePrePost=false`;
      const chartResp = await fetch(chartUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(8000)
      });

      if (!chartResp.ok) { results[s] = null; return; }
      const chartData = await chartResp.json();
      if (!chartData.chart || !chartData.chart.result || !chartData.chart.result[0]) { results[s] = null; return; }

      const result = chartData.chart.result[0];
      const meta = result.meta;
      const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
      const timestamps = result.timestamp || [];

      let price = meta.regularMarketPrice;

      // Build daily closes
      var dailyCloses = [];
      if (q && q.close) {
        for (var i = 0; i < q.close.length; i++) {
          if (q.close[i] !== null && q.close[i] !== undefined) {
            dailyCloses.push({ ts: timestamps[i], close: q.close[i], high: q.high ? q.high[i] : null, low: q.low ? q.low[i] : null, volume: q.volume ? q.volume[i] : null });
          }
        }
      }

      if (!price && dailyCloses.length > 0) {
        price = dailyCloses[dailyCloses.length - 1].close;
      }

      // Previous close
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

      // Today's high/low from last day's data
      var dayHigh = 0, dayLow = Infinity, dayVolume = 0;
      if (dailyCloses.length > 0) {
        var todayStr = new Date(dailyCloses[dailyCloses.length - 1].ts * 1000).toDateString();
        for (var k = dailyCloses.length - 1; k >= 0; k--) {
          var ds = new Date(dailyCloses[k].ts * 1000).toDateString();
          if (ds !== todayStr) break;
          if (dailyCloses[k].high && dailyCloses[k].high > dayHigh) dayHigh = dailyCloses[k].high;
          if (dailyCloses[k].low && dailyCloses[k].low < dayLow) dayLow = dailyCloses[k].low;
          if (dailyCloses[k].volume) dayVolume += dailyCloses[k].volume;
        }
      }
      if (dayLow === Infinity) dayLow = 0;

      // 52-week high/low from all data
      var week52High = 0, week52Low = Infinity;
      for (var m = 0; m < dailyCloses.length; m++) {
        if (dailyCloses[m].high && dailyCloses[m].high > week52High) week52High = dailyCloses[m].high;
        if (dailyCloses[m].low && dailyCloses[m].low > 0 && dailyCloses[m].low < week52Low) week52Low = dailyCloses[m].low;
      }
      if (week52Low === Infinity) week52Low = 0;

      // Average volume (approx last 60 trading days)
      var volSum = 0, volCount = 0;
      var startIdx = Math.max(0, dailyCloses.length - 60);
      for (var n = startIdx; n < dailyCloses.length; n++) {
        if (dailyCloses[n].volume) { volSum += dailyCloses[n].volume; volCount++; }
      }
      var avgVolume = volCount > 0 ? Math.round(volSum / volCount) : 0;

      results[s] = price ? {
        price: price,
        prevClose: prevClose,
        dayHigh: dayHigh || price,
        dayLow: dayLow || price,
        volume: dayVolume,
        avgVolume: avgVolume,
        week52High: week52High || price,
        week52Low: week52Low || price,
        currency: meta.currency || 'USD',
        exchangeName: meta.exchangeName || '',
        shortName: meta.shortName || meta.symbol || s
      } : null;
    } catch (e) {
      results[s] = null;
    }
  }));

  res.status(200).json(results);
}
