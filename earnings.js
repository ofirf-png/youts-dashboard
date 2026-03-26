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
    const dayDates = {};

    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const ds = fmt(d);
      results.days[dayNames[i]] = { date: ds, beforeOpen: [], afterClose: [] };
      dayDates[ds] = dayNames[i];
    }

    // Fetch the whole week at once
    const url = `https://finance.yahoo.com/calendar/earnings?from=${startDate}&to=${endDate}&offset=0&size=200`;
    const r = await fetch(url, {
      headers: { 'User-Agent': UA, 'Accept': 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15000)
    });

    if (r.ok) {
      const html = await r.text();

      // Method 1: Try structured JSON in page
      const dataMatch = html.match(/"rows"\s*:\s*(\[[\s\S]*?\])\s*,\s*"columns/);
      if (dataMatch) {
        try {
          const rows = JSON.parse(dataMatch[1]);
          const seen = {};
          rows.forEach(function(row) {
            const ticker = row.ticker || '';
            const dateStr = (row.startdatetime || '').split('T')[0];
            const dayName = dayDates[dateStr];
            if (!ticker || !dayName) return;
            const key = ticker + '_' + dateStr;
            if (seen[key]) return;
            seen[key] = true;

            const company = row.companyshortname || '';
            const time = row.startdatetimetype || '';
            const epsEstimate = row.epsestimate || '';
            const entry = { ticker, company, epsEstimate };
            if (time === 'BMO' || time === 'TAS') {
              results.days[dayName].beforeOpen.push(entry);
            } else {
              results.days[dayName].afterClose.push(entry);
            }
          });
        } catch(e) {}
      }

      // Method 2: Parse HTML tables if Method 1 didn't work
      const totalCount = Object.values(results.days).reduce((s, d) => s + d.beforeOpen.length + d.afterClose.length, 0);
      if (totalCount === 0) {
        // Try to extract from table - each row has: Symbol, Company, Date, Time, EPS Est, EPS Actual, Surprise
        const tableMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/);
        if (tableMatch) {
          const tbody = tableMatch[1];
          const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
          let rowMatch;
          const seen = {};
          while ((rowMatch = rowRegex.exec(tbody)) !== null) {
            const cells = [];
            const cellRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
            let cellMatch;
            while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
              cells.push(cellMatch[1].replace(/<[^>]+>/g, '').trim());
            }
            if (cells.length >= 4) {
              const ticker = cells[0];
              const company = cells[1];
              // Date might be in cells[2] or cells[3]
              let dateStr = '';
              let time = '';
              for (let c = 2; c < cells.length; c++) {
                if (/^\d{4}-\d{2}-\d{2}/.test(cells[c])) dateStr = cells[c].substring(0,10);
                if (/BMO|AMC|TAS|TNS/.test(cells[c])) time = cells[c];
              }

              const dayName = dayDates[dateStr];
              if (!ticker || !dayName) continue;
              const key = ticker + '_' + dateStr;
              if (seen[key]) continue;
              seen[key] = true;

              const entry = { ticker, company, epsEstimate: '' };
              if (time === 'BMO' || time === 'TAS') {
                results.days[dayName].beforeOpen.push(entry);
              } else {
                results.days[dayName].afterClose.push(entry);
              }
            }
          }
        }
      }

      // Method 3: Last resort - try data-symbol with date context
      const totalCount2 = Object.values(results.days).reduce((s, d) => s + d.beforeOpen.length + d.afterClose.length, 0);
      if (totalCount2 === 0) {
        // Just get unique symbols from page as a flat list for the whole week
        const allSymbols = new Set();
        const symRegex = /data-symbol="([A-Z.]{1,6})"/g;
        let m;
        while ((m = symRegex.exec(html)) !== null) {
          allSymbols.add(m[1]);
        }
        // Put them all under a special "all" key
        results.allWeek = Array.from(allSymbols);
      }
    }

    res.status(200).json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
