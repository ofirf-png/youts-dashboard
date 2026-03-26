export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  try {
    const results = { gainers: [], losers: [], source: '' };

    // ═══ SOURCE 1: Yahoo Finance screener API (JSON) ═══
    try {
      const [gRes, lRes] = await Promise.all([
        fetch('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=true&lang=en-US&region=US&scrIds=day_gainers&count=5', {
          headers: { 'User-Agent': UA, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000)
        }),
        fetch('https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=true&lang=en-US&region=US&scrIds=day_losers&count=5', {
          headers: { 'User-Agent': UA, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000)
        })
      ]);

      if (gRes.ok) {
        const gData = await gRes.json();
        const quotes = gData && gData.finance && gData.finance.result && gData.finance.result[0] && gData.finance.result[0].quotes;
        if (quotes && quotes.length > 0) {
          results.gainers = quotes.slice(0, 5).map(q => ({
            symbol: q.symbol || '',
            name: q.shortName || q.longName || '',
            price: q.regularMarketPrice && q.regularMarketPrice.fmt ? q.regularMarketPrice.fmt : (q.regularMarketPrice || ''),
            change: q.regularMarketChange && q.regularMarketChange.fmt ? q.regularMarketChange.fmt : '',
            changePercent: q.regularMarketChangePercent && q.regularMarketChangePercent.fmt ? q.regularMarketChangePercent.fmt : ''
          }));
        }
      }

      if (lRes.ok) {
        const lData = await lRes.json();
        const quotes = lData && lData.finance && lData.finance.result && lData.finance.result[0] && lData.finance.result[0].quotes;
        if (quotes && quotes.length > 0) {
          results.losers = quotes.slice(0, 5).map(q => ({
            symbol: q.symbol || '',
            name: q.shortName || q.longName || '',
            price: q.regularMarketPrice && q.regularMarketPrice.fmt ? q.regularMarketPrice.fmt : (q.regularMarketPrice || ''),
            change: q.regularMarketChange && q.regularMarketChange.fmt ? q.regularMarketChange.fmt : '',
            changePercent: q.regularMarketChangePercent && q.regularMarketChangePercent.fmt ? q.regularMarketChangePercent.fmt : ''
          }));
        }
      }

      if (results.gainers.length > 0 || results.losers.length > 0) {
        results.source = 'yahoo-screener';
        return res.status(200).json(results);
      }
    } catch(e) {}

    // ═══ SOURCE 2: Nasdaq API ═══
    try {
      const [gRes, lRes] = await Promise.all([
        fetch('https://api.nasdaq.com/api/marketmovers/gainers?exchange=nasdaq&limit=5', {
          headers: { 'User-Agent': UA, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000)
        }),
        fetch('https://api.nasdaq.com/api/marketmovers/losers?exchange=nasdaq&limit=5', {
          headers: { 'User-Agent': UA, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(8000)
        })
      ]);

      if (gRes.ok) {
        const gData = await gRes.json();
        const rows = gData && gData.data && gData.data.rows;
        if (rows && Array.isArray(rows)) {
          results.gainers = rows.slice(0, 5).map(r => ({
            symbol: r.symbol || '',
            name: r.companyName || r.name || '',
            price: (r.lastSalePrice || r.price || '').replace('$', ''),
            change: (r.netChange || '').replace('$', ''),
            changePercent: r.percentageChange || r.pctChange || ''
          }));
        }
      }

      if (lRes.ok) {
        const lData = await lRes.json();
        const rows = lData && lData.data && lData.data.rows;
        if (rows && Array.isArray(rows)) {
          results.losers = rows.slice(0, 5).map(r => ({
            symbol: r.symbol || '',
            name: r.companyName || r.name || '',
            price: (r.lastSalePrice || r.price || '').replace('$', ''),
            change: (r.netChange || '').replace('$', ''),
            changePercent: r.percentageChange || r.pctChange || ''
          }));
        }
      }

      if (results.gainers.length > 0 || results.losers.length > 0) {
        results.source = 'nasdaq';
        return res.status(200).json(results);
      }
    } catch(e) {}

    // ═══ SOURCE 3: Yahoo Finance page scraping (symbols only fallback) ═══
    try {
      const [gRes, lRes] = await Promise.all([
        fetch('https://finance.yahoo.com/markets/stocks/gainers/', {
          headers: { 'User-Agent': UA, 'Accept': 'text/html' },
          signal: AbortSignal.timeout(10000)
        }),
        fetch('https://finance.yahoo.com/markets/stocks/losers/', {
          headers: { 'User-Agent': UA, 'Accept': 'text/html' },
          signal: AbortSignal.timeout(10000)
        })
      ]);

      if (gRes.ok) {
        const html = await gRes.text();
        results.gainers = extractSymbolsFromHtml(html, 5);
      }
      if (lRes.ok) {
        const html = await lRes.text();
        results.losers = extractSymbolsFromHtml(html, 5);
      }

      // Deduplicate: if same symbols in both, clear losers
      if (results.gainers.length > 0 && results.losers.length > 0) {
        const gSyms = new Set(results.gainers.map(g => g.symbol));
        const overlap = results.losers.filter(l => gSyms.has(l.symbol)).length;
        if (overlap > 2) {
          results.losers = [];
        }
      }

      if (results.gainers.length > 0 || results.losers.length > 0) {
        results.source = 'yahoo-html';
        return res.status(200).json(results);
      }
    } catch(e) {}

    return res.status(200).json({ gainers: [], losers: [], source: 'none', error: 'No data sources available' });

  } catch (e) {
    res.status(500).json({ error: e.message, gainers: [], losers: [] });
  }
}

function extractSymbolsFromHtml(html, limit) {
  const results = [];
  const seen = new Set();

  // Try fin-streamer tags for price data
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (tbodyMatch) {
    const tbody = tbodyMatch[1];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch;
    while ((trMatch = trRegex.exec(tbody)) !== null && results.length < limit) {
      const row = trMatch[1];
      const symMatch = row.match(/data-symbol="([^"]+)"/);
      if (!symMatch) continue;
      const symbol = symMatch[1];
      if (seen.has(symbol)) continue;
      seen.add(symbol);

      const priceMatch = row.match(/data-field="regularMarketPrice"[^>]*value="([^"]+)"/);
      const changeMatch = row.match(/data-field="regularMarketChange"[^>]*value="([^"]+)"/);
      const changePctMatch = row.match(/data-field="regularMarketChangePercent"[^>]*value="([^"]+)"/);

      results.push({
        symbol,
        name: '',
        price: priceMatch ? parseFloat(priceMatch[1]).toFixed(2) : '',
        change: changeMatch ? parseFloat(changeMatch[1]).toFixed(2) : '',
        changePercent: changePctMatch ? (parseFloat(changePctMatch[1]) * 100).toFixed(2) + '%' : ''
      });
    }
  }

  // Fallback: just symbols
  if (results.length === 0) {
    const symRegex = /data-symbol="([A-Z.]{1,6})"/g;
    let m;
    while ((m = symRegex.exec(html)) !== null && results.length < limit) {
      if (!seen.has(m[1])) {
        seen.add(m[1]);
        results.push({ symbol: m[1], name: '', price: '', change: '', changePercent: '' });
      }
    }
  }

  return results;
}
