import type { NextApiRequest, NextApiResponse } from 'next';
import type { FgCurrentData } from '@/lib/types';

function scoreToStatus(score: number): Omit<FgCurrentData, 'score' | 'source' | 'rating'> {
  if (score >= 75) return { status: 'Extreme Greed', color: '#16a34a', emoji: '🤑' };
  if (score >= 55) return { status: 'Greed',         color: '#22c55e', emoji: '😊' };
  if (score >= 45) return { status: 'Neutral',       color: '#eab308', emoji: '😐' };
  if (score >= 25) return { status: 'Fear',          color: '#f97316', emoji: '😨' };
  return                  { status: 'Extreme Fear',  color: '#dc2626', emoji: '😱' };
}

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<{ data?: FgCurrentData; error?: string }>
) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
  };

  // ① CNN API
  try {
    const r = await fetch(
      'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (r.ok) {
      const json = await r.json();
      if (json.fear_and_greed?.score != null) {
        const score = parseFloat(json.fear_and_greed.score);
        const rating = json.fear_and_greed.rating ?? '';
        res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
        return res.status(200).json({
          data: { score, rating, source: 'CNN API', ...scoreToStatus(score) },
        });
      }
    }
  } catch { /* fallthrough */ }

  // ② Alternative.me Crypto F&G (fallback)
  try {
    const r = await fetch(
      'https://api.alternative.me/fng/?limit=1',
      { signal: AbortSignal.timeout(10000) }
    );
    if (r.ok) {
      const json = await r.json();
      const item = json.data?.[0];
      if (item) {
        const score = parseFloat(item.value);
        res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
        return res.status(200).json({
          data: {
            score, rating: item.value_classification,
            source: 'Crypto F&G (참고용)', ...scoreToStatus(score),
          },
        });
      }
    }
  } catch { /* fallthrough */ }

  // ③ VIX-based estimate
  const apiKey = process.env.FRED_API_KEY;
  if (apiKey) {
    try {
      const params = new URLSearchParams({
        series_id: 'VIXCLS', api_key: apiKey, file_type: 'json',
        sort_order: 'desc', limit: '1',
      });
      const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params}`, {
        signal: AbortSignal.timeout(10000),
      });
      if (r.ok) {
        const json = await r.json();
        const vix = parseFloat(json.observations?.[0]?.value);
        if (!isNaN(vix)) {
          let score = 50;
          if (vix <= 12) score = 85;
          else if (vix <= 15) score = 75;
          else if (vix <= 20) score = 60;
          else if (vix <= 25) score = 50;
          else if (vix <= 30) score = 40;
          else if (vix <= 35) score = 30;
          else if (vix <= 40) score = 20;
          else score = 10;
          res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
          return res.status(200).json({
            data: {
              score, rating: `VIX 기반 추정 (VIX: ${vix.toFixed(2)})`,
              source: 'VIX 기반 계산', ...scoreToStatus(score),
            },
          });
        }
      }
    } catch { /* fallthrough */ }
  }

  return res.status(502).json({ error: '모든 F&G 데이터 소스 실패' });
}
