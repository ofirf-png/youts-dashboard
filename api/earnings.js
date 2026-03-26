export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  try {
    // Get current week's Monday and Friday
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday
    const monday = new Date(now);
    monday.setDate(diff);
    monday.setHours(0,0,0,0);

    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    const fmt = (d) => d.toISOString().split('T')[0];
    const startDate = fmt(monday);
    const endDate = fmt(friday);

    // Try Yahoo Finance earnings calendar
    const results = { startDate, endDate, days: {} };
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    // Initialize days
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      results.days[dayNames[i]] = { date: fmt(d), beforeOpen: [], afterClose: [] };
    }

    // Fetch earnings for each day of the week
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = fmt(d);

      try {
        const url = `https://finance.yahoo.com/calendar/earnings?day=${dateStr}`;
        const r = await fetch(url, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(10000)
        });

        if (r.ok) {
          const html = await r.text();

          // Parse earnings from the HTML - look for JSON data
          const jsonMatch = html.match(/\"rows\"\s*:\s*(\[[\s\S]*?\])\s*,\s*\"columns/);
          if (jsonMatch) {
            try {
              const rows = JSON.parse(jsonMatch[1]);
              rows.forEach(function(row) {
                const ticker = row.ticker || '';
                const company = row.companyshortname || '';
                const time = row.startdatetimetype || '';
                const epsEstimate = row.epsestimate || '';

                const entry = { ticker, company, epsEstimate };

                if (time === 'BMO' || time === 'TAS') {
                  results.days[dayNames[i]].beforeOpen.push(entry);
                } else {
                  results.days[dayNames[i]].afterClose.push(entry);
                }
              });
            } catch(e) {}
          }

          // Alternative: try to find earnings data in a different format
          if (results.days[dayNames[i]].beforeOpen.length === 0 && results.days[dayNames[i]].afterClose.length === 0) {
            // Try extracting from table rows
            const tickerRegex = /data-symbol="([A-Z.]+)"/g;
            let match;
            const tickers = [];
            while ((match = tickerRegex.exec(html)) !== null) {
              tickers.push(match[1]);
            }
            // Put them all as TBD timing
            tickers.slice(0, 30).forEach(function(t) {
              results.days[dayNames[i]].beforeOpen.push({ ticker: t, company: '', epsEstimate: '' });
            });
          }
        }
      } catch(e) {}
    }

    // If Yahoo didn't work well, try alternative: scrape from stockanalysis.com
    const totalCount = Object.values(results.days).reduce((sum, d) => sum + d.beforeOpen.length + d.afterClose.length, 0);

    if (totalCount === 0) {
      // Fallback: use Yahoo Finance v1 API
      try {
        const apiUrl = `https://finance.yahoo.com/calendar/earnings?from=${startDate}&to=${endDate}&offset=0&size=100`;
        const r = await fetch(apiUrl, {
          headers: { 'User-Agent': UA, 'Accept': 'text/html' },
          signal: AbortSignal.timeout(10000)
        });
        if (r.ok) {
          const html = await r.text();
          // Extract company data from script tags
          const scriptMatch = html.match(/root\.App\.main\s*=\s*({[\s\S]*?});/);
          if (scriptMatch) {
            try {
              const appData = JSON.parse(scriptMatch[1]);
              const rows = appData?.context?.dispatcher?.stores?.ScreenerResultsStore?.results?.rows || [];
              rows.forEach(function(row) {
                const ticker = row.ticker || '';
                const company = row.companyshortname || '';
                const time = row.startdatetimetype || '';
                const dateStr2 = (row.startdatetime || '').split('T')[0];
                const epsEstimate = row.epsestimate || '';

                // Find which day this belongs to
                for (let j = 0; j < 5; j++) {
                  const dd = new Date(monday);
                  dd.setDate(monday.getDate() + j);
                  if (fmt(dd) === dateStr2) {
                    const entry = { ticker, company, epsEstimate };
                    if (time === 'BMO' || time === 'TAS') {
                      results.days[dayNames[j]].beforeOpen.push(entry);
                    } else {
                      results.days[dayNames[j]].afterClose.push(entry);
                    }
                    break;
                  }
                }
              });
            } catch(e) {}
          }
        }
      } catch(e) {}
    }

    res.status(200).json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
