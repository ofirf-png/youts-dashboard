export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  try {
    // ═══ SOURCE 1: Yahoo Finance gainers & losers ═══
    const results = { gainers: [], losers: [], source: '' };

    // Fetch gainers
    try {
      const gUrl = 'https://finance.yahoo.com/markets/stocks/gainers/';
      const gRes = await fetch(gUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html' },
        signal: AbortSignal.timeout(10000)
      });
      if (gRes.ok) {
        const html = await gRes.text();
        results.gainers = parseYahooTable(html, 5);
        if (results.gainers.length > 0) results.source = 'yahoo';
      }
    } catch(e) {}

    // Fetch losers
    try {
      const lUrl = 'https://finance.yahoo.com/markets/stocks/losers/';
      const lRes = await fetch(lUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'text/html' },
        signal: AbortSignal.timeout(10000)
      });
      if (lRes.ok) {
        const html = await lRes.text();
        results.losers = parseYahooTable(html, 5);
        if (results.losers.length > 0) results.source = 'yahoo';
      }
    } catch(e) {}

    if (results.gainers.length > 0 || results.losers.length > 0) {
      return res.status(200).json(results);
    }

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
            price: r.lastSalePrice || r.price || '',
            change: r.netChange || '',
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
            price: r.lastSalePrice || r.price || '',
            change: r.netChange || '',
            changePercent: r.percentageChange || r.pctChange || ''
          }));
        }
      }

      if (results.gainers.length > 0 || results.losers.length > 0) {
        results.source = 'nasdaq';
        return res.status(200).json(results);
      }
    } catch(e) {}

    // ═══ SOURCE 3: Scrape from Yahoo screener JSON ═══
    try {
      const screenerUrl = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=true&lang=en-US&region=US&scrIds=day_gainers&count=5';
      const sRes = await fetch(screenerUrl, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (sRes.ok) {
        const sData = await sRes.json();
        const quotes = sData && sData.finance && sData.finance.result && sData.finance.result[0] && sData.finance.result[0].quotes;
        if (quotes && quotes.length > 0) {
          results.gainers = quotes.slice(0, 5).map(q => ({
            symbol: q.symbol || '',
            name: q.shortName || q.longName || '',
            price: q.regularMarketPrice && q.regularMarketPrice.fmt ? q.regularMarketPrice.fmt : '',
            change: q.regularMarketChange && q.regularMarketChange.fmt ? q.regularMarketChange.fmt : '',
            changePercent: q.regularMarketChangePercent && q.regularMarketChangePercent.fmt ? q.regularMarketChangePercent.fmt : ''
          }));
        }
      }

      const screenerUrl2 = 'https://query1.finance.yahoo.com/v1/finance/screener/predefined/saved?formatted=true&lang=en-US&region=US&scrIds=day_losers&count=5';
      const sRes2 = await fetch(screenerUrl2, {
        headers: { 'User-Agent': UA, 'Accept': 'application/json' },
        signal: AbortSignal.timeout(8000)
      });
      if (sRes2.ok) {
        const sData2 = await sRes2.json();
        const quotes2 = sData2 && sData2.finance && sData2.finance.result && sData2.finance.result[0] && sData2.finance.result[0].quotes;
        if (quotes2 && quotes2.length > 0) {
          results.losers = quotes2.slice(0, 5).map(q => ({
            symbol: q.symbol || '',
            name: q.shortName || q.longName || '',
            price: q.regularMarketPrice && q.regularMarketPrice.fmt ? q.regularMarketPrice.fmt : '',
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

    return res.status(200).json({ gainers: [], losers: [], source: 'none', error: 'No data sources available' });

  } catch (e) {
    res.status(500).json({ error: e.message, gainers: [], losers: [] });
  }
}

function parseYahooTable(html, limit) {
  const results = [];
  try {
    // Try to find data-symbol attributes with surrounding price/change data
    // Yahoo Finance pages often have structured data in fin-streamer tags
    const rowRegex = /data-symbol="([A-Z.]{1,6})"[^>]*>[\s\S]*?<\/tr>/gi;
    let match;
    const seen = new Set();

    // Alternative: find table rows with symbol, name, price, change
    const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
    if (tbodyMatch) {
      const tbody = tbodyMatch[1];
      const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch;
      while ((trMatch = trRegex.exec(tbody)) !== null && results.length < limit) {
        const row = trMatch[1];
        // Extract symbol
        const symMatch = row.match(/data-symbol="([^"]+)"/);
        if (!symMatch) continue;
        const symbol = symMatch[1];
        if (seen.has(symbol)) continue;
        seen.add(symbol);

        // Extract all text values from cells
        const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells = [];
        let tdMatch;
        while ((tdMatch = tdRegex.exec(row)) !== null) {
          cells.push(tdMatch[1].replace(/<[^>]+>/g, '').trim());
        }

        // Try to extract from fin-streamer tags
        const priceMatch = row.match(/data-field="regularMarketPrice"[^>]*value="([^"]+)"/);
        const changeMatch = row.match(/data-field="regularMarketChange"[^>]*value="([^"]+)"/);
        const changePctMatch = row.match(/data-field="regularMarketChangePercent"[^>]*value="([^"]+)"/);

        const name = cells.length > 1 ? cells[1] : '';
        const price = priceMatch ? parseFloat(priceMatch[1]).toFixed(2) : (cells.length > 2 ? cells[2] : '');
        const change = changeMatch ? parseFloat(changeMatch[1]).toFixed(2) : (cells.length > 3 ? cells[3] : '');
        const changePct = changePctMatch ? (parseFloat(changePctMatch[1]) * 100).toFixed(2) + '%' : (cells.length > 4 ? cells[4] : '');

        results.push({ symbol, name, price, change, changePercent: changePct });
      }
    }

    // Fallback: just extract symbols
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
  } catch(e) {}
  return results;
}
