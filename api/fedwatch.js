export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

  // Current rate as of March 18 2026 FOMC: 3.50% - 3.75% (held steady)
  const CURRENT_UPPER = 3.75;
  const CURRENT_LOWER = 3.50;
  const CURRENT_MID = (CURRENT_UPPER + CURRENT_LOWER) / 2; // 3.625
  const CUT_MID = CURRENT_MID - 0.25; // 3.375 (one 25bp cut)

  // 2026 FOMC meeting dates (remaining)
  const fomcMeetings = [
    { date: '2026-05-06', label: 'May 6-7' },
    { date: '2026-06-17', label: 'Jun 17-18' },
    { date: '2026-07-29', label: 'Jul 29-30' },
    { date: '2026-09-16', label: 'Sep 16-17' },
    { date: '2026-10-28', label: 'Oct 28-29' },
    { date: '2026-12-09', label: 'Dec 9-10' }
  ];

  // Fed Funds Futures month codes: F=Jan G=Feb H=Mar J=Apr K=May M=Jun N=Jul Q=Aug U=Sep V=Oct X=Nov Z=Dec
  const futuresTickers = [
    { ticker: 'ZQK26.CBT', meeting: 'May 6-7', meetingDate: '2026-05-06' },
    { ticker: 'ZQM26.CBT', meeting: 'Jun 17-18', meetingDate: '2026-06-17' },
    { ticker: 'ZQN26.CBT', meeting: 'Jul 29-30', meetingDate: '2026-07-29' },
    { ticker: 'ZQU26.CBT', meeting: 'Sep 16-17', meetingDate: '2026-09-16' },
    { ticker: 'ZQV26.CBT', meeting: 'Oct 28-29', meetingDate: '2026-10-28' },
    { ticker: 'ZQZ26.CBT', meeting: 'Dec 9-10', meetingDate: '2026-12-09' }
  ];

  // ═══ SOURCE 1: Yahoo Finance Fed Funds Futures ═══
  try {
    const symbols = futuresTickers.map(f => f.ticker).join(',');
    const yUrl = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=symbol,regularMarketPrice,regularMarketPreviousClose`;
    const r = await fetch(yUrl, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });
    if (r.ok) {
      const data = await r.json();
      const quotes = data?.quoteResponse?.result || [];
      if (quotes.length > 0) {
        const meetings = [];
        let prevImpliedRate = CURRENT_MID;

        for (const ft of futuresTickers) {
          const quote = quotes.find(q => q.symbol === ft.ticker);
          if (quote && quote.regularMarketPrice) {
            const price = quote.regularMarketPrice;
            const impliedRate = 100 - price;

            // Probability of cut at THIS meeting (incremental)
            // P(cut) = (prevImpliedRate - impliedRate) / 0.25
            const cutProb = Math.max(0, Math.min(100, ((prevImpliedRate - impliedRate) / 0.25) * 100));
            const holdProb = Math.max(0, 100 - cutProb);

            meetings.push({
              meetingDate: ft.meeting,
              date: ft.meetingDate,
              impliedRate: impliedRate.toFixed(3),
              cutProbability: Math.round(cutProb * 10) / 10,
              holdProbability: Math.round(holdProb * 10) / 10,
              futuresPrice: price
            });

            // For cumulative: use this meeting's implied rate as base for next
            // But for non-meeting months we skip, so use the actual implied rate
            prevImpliedRate = impliedRate;
          }
        }

        if (meetings.length > 0) {
          return res.status(200).json({
            source: 'futures',
            data: {
              currentRate: `${CURRENT_LOWER.toFixed(2)}% - ${CURRENT_UPPER.toFixed(2)}%`,
              meetings: meetings,
              note: 'Probabilities derived from Fed Funds Futures (Yahoo Finance)'
            }
          });
        }
      }
    }
  } catch(e) {}

  // ═══ SOURCE 1b: Try alternative Yahoo ticker formats ═══
  try {
    const altTickers = ['ZQ=F', 'ZQK2026.CBT', 'ZQM2026.CBT'];
    const symbols = altTickers.join(',');
    const yUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}`;
    const r = await fetch(yUrl, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (r.ok) {
      const data = await r.json();
      const quotes = data?.quoteResponse?.result || [];
      if (quotes.length > 0) {
        const frontMonth = quotes[0];
        const impliedRate = 100 - frontMonth.regularMarketPrice;
        const cutProb = Math.max(0, Math.min(100, ((CURRENT_MID - impliedRate) / 0.25) * 100));

        return res.status(200).json({
          source: 'futures-alt',
          data: {
            currentRate: `${CURRENT_LOWER.toFixed(2)}% - ${CURRENT_UPPER.toFixed(2)}%`,
            frontMonthImpliedRate: impliedRate.toFixed(3),
            cutProbability: Math.round(cutProb * 10) / 10,
            holdProbability: Math.round((100 - cutProb) * 10) / 10,
            ticker: frontMonth.symbol,
            price: frontMonth.regularMarketPrice
          }
        });
      }
    }
  } catch(e) {}

  // ═══ SOURCE 2: CME FedWatch JSON endpoints ═══
  const cmeEndpoints = [
    'https://www.cmegroup.com/services/fed-fund-target/fed-fund-target.json',
    'https://www.cmegroup.com/CmeWS/mvc/FedWatch/GetMiniFedWatch',
    'https://www.cmegroup.com/services/fedWatch.json'
  ];
  for (const url of cmeEndpoints) {
    try {
      const r = await fetch(url, {
        headers: {
          'User-Agent': UA,
          'Accept': 'application/json, text/plain, */*',
          'Referer': 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html'
        },
        signal: AbortSignal.timeout(6000)
      });
      if (r.ok) {
        const data = await r.json();
        if (data && (data.meetings || data.length > 0 || data.data)) {
          return res.status(200).json({ source: 'cme', data });
        }
      }
    } catch(e) {}
  }

  // ═══ SOURCE 3: FRED API ═══
  try {
    const fredUrl = 'https://api.stlouisfed.org/fred/series/observations?series_id=DFEDTARU&limit=1&sort_order=desc&file_type=json&api_key=DEMO_KEY';
    const r = await fetch(fredUrl, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(6000)
    });
    if (r.ok) {
      const fredData = await r.json();
      const obs = fredData.observations;
      if (obs && obs.length > 0) {
        return res.status(200).json({
          source: 'fred',
          data: {
            currentTargetRate: parseFloat(obs[0].value),
            rateDate: obs[0].date
          }
        });
      }
    }
  } catch(e) {}

  // ═══ FALLBACK: Current rate + FOMC schedule (updated March 2026) ═══
  // Filter to only future meetings
  const now = new Date();
  const upcomingMeetings = fomcMeetings.filter(m => new Date(m.date) > now);

  return res.status(200).json({
    source: 'fallback',
    data: {
      currentRate: `${CURRENT_LOWER.toFixed(2)}% - ${CURRENT_UPPER.toFixed(2)}%`,
      lastFOMC: 'March 18-19, 2026 — Held steady',
      dotPlot: '1 cut projected for 2026',
      upcomingMeetings: upcomingMeetings.map(m => m.label),
      nextMeeting: upcomingMeetings.length > 0 ? upcomingMeetings[0].label : null,
      link: 'https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html'
    }
  });
}
