export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

  try {
    const now = new Date();
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(now);
    monday.setDate(diff);
    monday.setHours(0,0,0,0);

    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    const fmt = (d) => d.toISOString().split('T')[0];
    const startDate = fmt(monday);
    const endDate = fmt(friday);

    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const results = { startDate, endDate, days: {} };

    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      results.days[dayNames[i]] = { date: fmt(d), beforeOpen: [], afterClose: [] };
    }

    // Fetch each day individually
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const dateStr = fmt(d);

      try {
        const url = `https://finance.yahoo.com/calendar/earnings?day=${dateStr}`;
        const r = await fetch(url, {
          headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
          signal: AbortSignal.timeout(10000)
        });

        if (!r.ok) continue;
        const html = await r.text();

        // Method 1: Try to find structured data in script tags
        const dataMatch = html.match(/"rows"\s*:\s*(\[[\s\S]*?\])\s*,\s*"columns/);
        if (dataMatch) {
          try {
            const rows = JSON.parse(dataMatch[1]);
            const seen = new Set();
            rows.forEach(function(row) {
              const ticker = row.ticker || '';
              if (!ticker || seen.has(ticker)) return;
              seen.add(ticker);
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
            continue;
          } catch(e) {}
        }

        // Method 2: Parse from table - extract unique symbols
        const seen = new Set();
        // Look for table rows with ticker symbols
        const rowRegex = /<tr[^>]*>[\s\S]*?<\/tr>/gi;
        let rowMatch;
        while ((rowMatch = rowRegex.exec(html)) !== null) {
          const row = rowMatch[0];
          const symMatch = row.match(/data-symbol="([A-Z.]{1,6})"/);
          if (symMatch && !seen.has(symMatch[1])) {
            const ticker = symMatch[1];
            seen.add(ticker);
            // Try to get timing (BMO/AMC)
            const isBMO = row.includes('Before Market Open') || row.includes('BMO') || row.includes('TAS');
            const entry = { ticker, company: '', epsEstimate: '' };
            // Try to extract company name
            const nameMatch = row.match(/title="([^"]+)"/);
            if (nameMatch) entry.company = nameMatch[1];
            if (isBMO) {
              results.days[dayNames[i]].beforeOpen.push(entry);
            } else {
              results.days[dayNames[i]].afterClose.push(entry);
            }
          }
        }

        // Method 3: If still empty, try simpler extraction
        if (results.days[dayNames[i]].beforeOpen.length === 0 && results.days[dayNames[i]].afterClose.length === 0) {
          const allSymbols = new Set();
          const symRegex = /data-symbol="([A-Z.]{1,6})"/g;
          let m;
          while ((m = symRegex.exec(html)) !== null) {
            allSymbols.add(m[1]);
          }
          allSymbols.forEach(function(t) {
            results.days[dayNames[i]].beforeOpen.push({ ticker: t, company: '', epsEstimate: '' });
          });
        }
      } catch(e) {}
    }

    res.status(200).json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
