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
    const fmtNasdaq = (d) => {
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      return d.getFullYear() + '-' + mm + '-' + dd;
    };
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

    // ═══ SOURCE 1: Nasdaq earnings calendar (per-day, JSON) ═══
    let nasdaqSuccess = false;
    try {
      const nasdaqFetches = dayNames.map(async (dayName, i) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        const dateStr = fmtNasdaq(d);
        const nUrl = `https://api.nasdaq.com/api/calendar/earnings?date=${dateStr}`;
        try {
          const nr = await fetch(nUrl, {
            headers: { 'User-Agent': UA, 'Accept': 'application/json' },
            signal: AbortSignal.timeout(10000)
          });
          if (!nr.ok) return;
          const nData = await nr.json();
          const rows = nData && nData.data && nData.data.rows;
          if (!rows || !Array.isArray(rows)) return;
          const seen = {};
          rows.forEach(function(row) {
            const ticker = (row.symbol || '').trim();
            if (!ticker || seen[ticker]) return;
            seen[ticker] = true;
            const company = row.name || '';
            const eps = row.eps || '';
            const time = (row.time || '').toLowerCase();
            const entry = { ticker, company, epsEstimate: eps };
            if (time.includes('before') || time === 'bmo' || time.includes('pre')) {
              results.days[dayName].beforeOpen.push(entry);
            } else {
              results.days[dayName].afterClose.push(entry);
            }
          });
        } catch(e) {}
      });
      await Promise.all(nasdaqFetches);
      const nasdaqTotal = Object.values(results.days).reduce((s, d) => s + d.beforeOpen.length + d.afterClose.length, 0);
      nasdaqSuccess = nasdaqTotal > 0;
    } catch(e) {}

    if (nasdaqSuccess) {
      results.source = 'nasdaq';
      return res.status(200).json(results);
    }

    // ═══ SOURCE 2: Yahoo Finance earnings calendar (fallback) ═══
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

      // Method 3: Last resort - get symbols as flat list
      const totalCount2 = Object.values(results.days).reduce((s, d) => s + d.beforeOpen.length + d.afterClose.length, 0);
      if (totalCount2 === 0) {
        const allSymbols = new Set();
        const symRegex = /data-symbol="([A-Z.]{1,6})"/g;
        let m;
        while ((m = symRegex.exec(html)) !== null) {
          allSymbols.add(m[1]);
        }
        results.allWeek = Array.from(allSymbols);
      }

      results.source = 'yahoo';
    }

    res.status(200).json(results);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
