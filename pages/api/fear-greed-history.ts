import type { NextApiRequest, NextApiResponse } from 'next';
import type { FgHistoryResponse, FgHistoryPoint } from '@/lib/types';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

function scoreToRating(s: number): string {
  if (s < 25) return 'extreme fear';
  if (s < 45) return 'fear';
  if (s < 55) return 'neutral';
  if (s < 75) return 'greed';
  return 'extreme greed';
}

/** Parse simple 2-column CSV: Date,Fear Greed */
function parseCsvFg(text: string): FgHistoryPoint[] {
  const lines = text.trim().split('\n');
  const out: FgHistoryPoint[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',');
    if (cols.length < 2) continue;
    const dateStr = cols[0].trim().replace(/"/g, '');
    const score = parseFloat(cols[1].trim());
    if (!dateStr || isNaN(score)) continue;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;
    out.push({
      date: d.toISOString().split('T')[0],
      score,
      rating: scoreToRating(score),
    });
  }
  return out;
}

/** Merge two FG history arrays, dedup by date, sort ascending */
function mergeFg(a: FgHistoryPoint[], b: FgHistoryPoint[]): FgHistoryPoint[] {
  const map = new Map<string, FgHistoryPoint>();
  for (const p of [...a, ...b]) map.set(p.date, p);
  return Array.from(map.values()).sort((x, y) => x.date.localeCompare(y.date));
}

/** Parse CNN component data: [{x: ms_timestamp, y: value}] */
function parseCnnComponent(data: unknown, yKey: string): { date: string; [k: string]: number | string }[] {
  if (!Array.isArray(data)) return [];
  return data
    .map((item: { x: number; y: number }) => ({
      date: new Date(item.x).toISOString().split('T')[0],
      [yKey]: item.y,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse<FgHistoryResponse | { error: string }>
) {
  const headers = { 'User-Agent': UA };
  const result: Partial<FgHistoryResponse> = {};

  // ── ① Old CSV from GitHub (2011 ~ ~2020) ──────────────────────────────
  let dfOld: FgHistoryPoint[] = [];
  try {
    const r = await fetch(
      'https://raw.githubusercontent.com/hackingthemarkets/sentiment-fear-and-greed/master/datasets/fear-greed.csv',
      { headers, signal: AbortSignal.timeout(15000) }
    );
    if (r.ok) {
      dfOld = parseCsvFg(await r.text());
    }
  } catch { /* ignore */ }

  // ── ② CNN API (with start date if we have old data) ───────────────────
  let cnnStart = '2016-01-01';
  if (dfOld.length > 0) {
    const lastDate = new Date(dfOld[dfOld.length - 1].date);
    lastDate.setDate(lastDate.getDate() + 1);
    cnnStart = lastDate.toISOString().split('T')[0];
  }

  const cnnUrls = [
    `https://production.dataviz.cnn.io/index/fearandgreed/graphdata/${cnnStart}`,
    'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
  ];

  let cnnData: Record<string, unknown> | null = null;
  for (const url of cnnUrls) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
      if (r.ok) { cnnData = await r.json(); break; }
    } catch { /* try next */ }
  }

  if (cnnData == null && dfOld.length === 0) {
    return res.status(502).json({ error: 'CNN API and fallback CSV both failed' });
  }

  // current F&G info
  if (cnnData?.fear_and_greed) {
    result.current = cnnData.fear_and_greed as FgHistoryResponse['current'];
  }

  // CNN historical
  let dfNew: FgHistoryPoint[] = [];
  const hist = cnnData?.fear_and_greed_historical as { data?: { x: number; y: number; rating?: string }[] } | undefined;
  if (hist?.data) {
    dfNew = hist.data.map(d => ({
      date: new Date(d.x).toISOString().split('T')[0],
      score: d.y,
      rating: d.rating ?? scoreToRating(d.y),
    })).sort((a, b) => a.date.localeCompare(b.date));
  }

  result.fgHistory = mergeFg(dfOld, dfNew);

  if (!result.fgHistory || result.fgHistory.length === 0) {
    return res.status(502).json({ error: 'No F&G history data' });
  }

  // data coverage info
  result.dataSourceInfo = {
    totalDays: result.fgHistory.length,
    startDate: result.fgHistory[0].date,
    endDate:   result.fgHistory[result.fgHistory.length - 1].date,
    hasOldCsv: dfOld.length > 0,
  };

  // ── Sub-indicators from CNN ────────────────────────────────────────────
  if (cnnData) {
    const vixRaw = (cnnData.market_volatility_vix as { data?: unknown })?.data;
    if (vixRaw) result.vix = parseCnnComponent(vixRaw, 'vix') as FgHistoryResponse['vix'];

    const pcRaw = (cnnData.put_call_options as { data?: unknown })?.data;
    if (pcRaw) result.putCall = parseCnnComponent(pcRaw, 'ratio') as FgHistoryResponse['putCall'];

    const jbRaw = (cnnData.junk_bond_demand as { data?: unknown })?.data;
    if (jbRaw) result.junkBond = parseCnnComponent(jbRaw, 'spread') as FgHistoryResponse['junkBond'];
  }

  // ── S&P 500 from FRED ─────────────────────────────────────────────────
  const apiKey = process.env.FRED_API_KEY;
  if (apiKey && result.fgHistory.length > 0) {
    try {
      const startD = result.fgHistory[0].date;
      const endD   = result.fgHistory[result.fgHistory.length - 1].date;
      const params = new URLSearchParams({
        series_id: 'SP500', api_key: apiKey, file_type: 'json',
        sort_order: 'asc', observation_start: startD, observation_end: endD,
      });
      const r = await fetch(`https://api.stlouisfed.org/fred/series/observations?${params}`, {
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const json = await r.json();
        result.sp500 = (json.observations ?? [])
          .map((o: { date: string; value: string }) => ({ date: o.date, price: parseFloat(o.value) }))
          .filter((p: { date: string; price: number }) => !isNaN(p.price));
      }
    } catch { /* ignore */ }
  }

  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  return res.status(200).json(result as FgHistoryResponse);
}
