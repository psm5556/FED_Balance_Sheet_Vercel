import type { NextApiRequest, NextApiResponse } from 'next';

const ALLOWED = new Set(['QQQ', 'SOXX']);

interface YahooResponse {
  data: { date: string; close: number }[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<YahooResponse | { error: string }>
) {
  const ticker = (req.query.ticker as string)?.toUpperCase();
  if (!ticker || !ALLOWED.has(ticker)) {
    return res.status(400).json({ error: 'Invalid ticker' });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?range=20y&interval=1d&events=history`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!r.ok) {
      return res.status(502).json({ error: `Yahoo Finance returned ${r.status}` });
    }

    const json = await r.json();
    const result = json?.chart?.result?.[0];
    if (!result) {
      return res.status(502).json({ error: 'No data from Yahoo Finance' });
    }

    const timestamps: number[] = result.timestamp ?? [];
    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];

    const data: { date: string; close: number }[] = [];
    for (let i = 0; i < timestamps.length; i++) {
      const close = closes[i];
      if (close == null || isNaN(close)) continue;
      const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
      data.push({ date, close });
    }

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({ data });
  } catch {
    return res.status(502).json({ error: 'Failed to fetch from Yahoo Finance' });
  }
}
