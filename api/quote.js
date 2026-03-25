export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'Missing symbols param' });

  const symList = symbols.split(',').slice(0, 30);
  const results = {};
  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  // Try to get rich data from v6 quote endpoint for all symbols at once
  var richData = {};
  try {
    const quoteUrl = `https://query1.finance.yahoo.com/v6/finance/quote?symbols=${encodeURIComponent(symList.join(','))}`;
    const qr = await fetch(quoteUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
    if (qr.ok) {
      const qd = await qr.json();
      if (qd.quoteResponse && qd.quoteResponse.result) {
        qd.quoteResponse.result.forEach(function(item) {
          richData[item.symbol] = item;
        });
      }
    }
  } catch(e) {}

  // If v6 failed, try v7
  if (Object.keys(richData).length === 0) {
    try {
      const quoteUrl7 = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symList.join(','))}`;
      const qr7 = await fetch(quoteUrl7, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });
      if (qr7.ok) {
        const qd7 = await qr7.json();
        if (qd7.quoteResponse && qd7.quoteResponse.result) {
          qd7.quoteResponse.result.forEach(function(item) {
            richData[item.symbol] = item;
          });
        }
      }
    } catch(e) {}
  }

  await Promise.all(symList.map(async (sym) => {
    const s = sym.trim();
    try {
      // If we have rich data from v6/v7, use it directly
      var rd = richData[s];
      if (rd && rd.regularMarketPrice) {
        results[s] = {
          price: rd.regularMarketPrice,
          prevClose: rd.regularMarketPreviousClose || rd.regularMarketPrice,
          dayHigh: rd.regularMarketDayHigh || rd.regularMarketPrice,
          dayLow: rd.regularMarketDayLow || rd.regularMarketPrice,
          volume: rd.regularMarketVolume || 0,
          avgVolume: rd.averageDailyVolume3Month || rd.averageDailyVolume10Day || 0,
          week52High: rd.fiftyTwoWeekHigh || 0,
          week52Low: rd.fiftyTwoWeekLow || 0,
          marketCap: rd.marketCap || 0,
          trailingPE: rd.trailingPE || 0,
          forwardPE: rd.forwardPE || 0,
          beta: 0,
          dividendYield: rd.trailingAnnualDividendYield || 0,
          epsTrailing: rd.epsTrailingTwelveMonths || 0,
          currency: rd.currency || 'USD',
          exchangeName: rd.exchange || '',
          shortName: rd.shortName || rd.longName || s
        };
        return;
      }

      // Fallback: use chart API
      const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(s)}?interval=1d&range=1y&includePrePost=false`;
      const chartResp = await fetch(chartUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) });

      if (!chartResp.ok) { results[s] = null; return; }
      const chartData = await chartResp.json();
      if (!chartData.chart || !chartData.chart.result || !chartData.chart.result[0]) { results[s] = null; return; }

      const result = chartData.chart.result[0];
      const meta = result.meta;
      const q = result.indicators && result.indicators.quote && result.indicators.quote[0];
      const timestamps = result.timestamp || [];

      let price = meta.regularMarketPrice;

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

      var prevClose = null;
      if (dailyCloses.length >= 2) {
        var lastTs = dailyCloses[dailyCloses.length - 1].ts;
        var lastDay = new Date(lastTs * 1000).toDateString();
        for (var j = dailyCloses.length - 2; j >= 0; j--) {
          var dayStr = new Date(dailyCloses[j].ts * 1000).toDateString();
          if (dayStr !== lastDay) { prevClose = dailyCloses[j].close; break; }
        }
      }
      if (!prevClose) prevClose = meta.previousClose || meta.chartPreviousClose || price;

      var dayHigh = 0, dayLow = Infinity, dayVolume = 0;
      if (dailyCloses.length > 0) {
        var todayStr = new Date(dailyCloses[dailyCloses.length - 1].ts * 1000).toDateString();
        for (var k = dailyCloses.length - 1; k >= 0; k--) {
          if (new Date(dailyCloses[k].ts * 1000).toDateString() !== todayStr) break;
          if (dailyCloses[k].high && dailyCloses[k].high > dayHigh) dayHigh = dailyCloses[k].high;
          if (dailyCloses[k].low && dailyCloses[k].low < dayLow) dayLow = dailyCloses[k].low;
          if (dailyCloses[k].volume) dayVolume += dailyCloses[k].volume;
        }
      }
      if (dayLow === Infinity) dayLow = 0;

      var week52High = 0, week52Low = Infinity;
      for (var m = 0; m < dailyCloses.length; m++) {
        if (dailyCloses[m].high && dailyCloses[m].high > week52High) week52High = dailyCloses[m].high;
        if (dailyCloses[m].low && dailyCloses[m].low > 0 && dailyCloses[m].low < week52Low) week52Low = dailyCloses[m].low;
      }
      if (week52Low === Infinity) week52Low = 0;

      var volSum = 0, volCount = 0;
      var startIdx = Math.max(0, dailyCloses.length - 60);
      for (var n = startIdx; n < dailyCloses.length; n++) {
        if (dailyCloses[n].volume) { volSum += dailyCloses[n].volume; volCount++; }
      }
      var avgVolume = volCount > 0 ? Math.round(volSum / volCount) : 0;

      results[s] = price ? {
        price, prevClose,
        dayHigh: dayHigh || price, dayLow: dayLow || price,
        volume: dayVolume, avgVolume,
        week52High: week52High || price, week52Low: week52Low || price,
        marketCap: 0, trailingPE: 0, forwardPE: 0, beta: 0, dividendYield: 0, epsTrailing: 0,
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
