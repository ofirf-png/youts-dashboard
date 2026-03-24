export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try {
    const r = await fetch('https://production.dataviz.cnn.io/index/fearandgreed/graphdata', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!r.ok) {
      return res.status(r.status).json({ error: 'CNN API returned ' + r.status });
    }

    const data = await r.json();

    // Extract the current score and rating
    const fgi = data.fear_and_greed;
    const result = {
      score: Math.round(fgi.score),
      rating: fgi.rating,
      previous: data.fear_and_greed_historical ? {
        previousClose: Math.round(data.fear_and_greed_historical.previousClose),
        oneWeekAgo: Math.round(data.fear_and_greed_historical.oneWeekAgo),
        oneMonthAgo: Math.round(data.fear_and_greed_historical.oneMonthAgo),
        oneYearAgo: Math.round(data.fear_and_greed_historical.oneYearAgo)
      } : null,
      timestamp: fgi.timestamp
    };

    res.status(200).json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
