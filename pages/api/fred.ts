import type { NextApiRequest, NextApiResponse } from 'next';
import type { FredObservation } from '@/lib/types';

interface FredResponse {
  data?: FredObservation[];
  error?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse<FredResponse>) {
  const { series_id, start_date, end_date, limit = '10' } = req.query;
  const apiKey = process.env.FRED_API_KEY;

  if (!apiKey) {
    return res.status(500).json({ error: 'FRED_API_KEY not configured' });
  }
  if (!series_id || typeof series_id !== 'string') {
    return res.status(400).json({ error: 'series_id required' });
  }

  const now = new Date().toISOString().split('T')[0];
  const fiveYearsAgo = new Date(Date.now() - 1825 * 86400000).toISOString().split('T')[0];

  const params = new URLSearchParams({
    series_id,
    api_key: apiKey,
    file_type: 'json',
    sort_order: 'desc',
  });

  if (start_date && end_date) {
    params.set('observation_start', start_date as string);
    params.set('observation_end', end_date as string);
  } else {
    const lim = parseInt(limit as string, 10);
    if (!isNaN(lim) && lim > 0) params.set('limit', String(lim));
    params.set('observation_start', fiveYearsAgo);
    params.set('observation_end', now);
  }

  try {
    const response = await fetch(
      `https://api.stlouisfed.org/fred/series/observations?${params}`,
      { signal: AbortSignal.timeout(10000) }
    );

    if (!response.ok) {
      return res.status(502).json({ error: `FRED API returned ${response.status}` });
    }

    const json = await response.json();
    if (!json.observations || json.observations.length === 0) {
      return res.status(200).json({ data: [] });
    }

    const data: FredObservation[] = json.observations
      .map((obs: { date: string; value: string }) => ({
        date: obs.date,
        value: parseFloat(obs.value),
      }))
      .filter((obs: FredObservation) => !isNaN(obs.value))
      .sort((a: FredObservation, b: FredObservation) => b.date.localeCompare(a.date));

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({ data });
  } catch (err) {
    return res.status(502).json({ error: 'Failed to fetch FRED data' });
  }
}
