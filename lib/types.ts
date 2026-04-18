// ── FRED ──────────────────────────────────────────────────────────────────
export interface FredObservation {
  date: string; // YYYY-MM-DD
  value: number;
}

// ── Balance Sheet ─────────────────────────────────────────────────────────
export interface SeriesInfoItem {
  id: string;
  highlight: boolean;
  category: string;
  description: string;
  liquidityImpact: string;
  order: number;
  showChart: boolean;
  isQuarterly?: boolean;
  apiSource?: 'fred' | 'ici'; // default: 'fred'
}

export interface IciMmfPoint {
  date: string; // YYYY-MM-DD
  value: number;
}

export interface IciMmfResponse {
  data: IciMmfPoint[];
  unit: string;
  source: string;
  lastUpdated?: string;
}

export interface BalanceSheetRow {
  category: string;
  name: string;
  seriesId: string;
  description: string;
  currentDate: string;
  currentValue: string;
  prevDate: string;
  prevValue: string;
  change: string;
  changeNum: number;
  liquidityImpact: string;
  highlight: boolean;
  order: number;
}

// ── Spreads ───────────────────────────────────────────────────────────────
export interface SignalEntry {
  min: number;
  max: number;
  message: string;
}

export interface SpreadInfo {
  name: string;
  series: string[];
  multiplier: number;
  thresholdMin: number;
  thresholdMax: number;
  description: string;
  normalRange: string;
  interpretation: string;
  signals: Record<string, SignalEntry>;
  isSingleSeries?: boolean;
  showMa?: boolean;
}

// ── Fear & Greed ───────────────────────────────────────────────────────────
export type FgRating = 'extreme fear' | 'fear' | 'neutral' | 'greed' | 'extreme greed';

export interface FgCurrentData {
  score: number;
  status: string;
  rating: string;
  color: string;
  emoji: string;
  source: string;
}

export interface FgHistoryPoint {
  date: string; // YYYY-MM-DD
  score: number;
  rating: string;
}

export interface FgHistoryResponse {
  fgHistory: FgHistoryPoint[];
  current?: {
    score: number;
    rating: string;
    previous_1_week?: number;
    previous_1_month?: number;
    previous_1_year?: number;
  };
  sp500?: { date: string; price: number }[];
  vix?: { date: string; vix: number }[];
  putCall?: { date: string; ratio: number }[];
  junkBond?: { date: string; spread: number }[];
  dataSourceInfo?: {
    totalDays: number;
    startDate: string;
    endDate: string;
    hasOldCsv: boolean;
  };
}

// ── Chart ──────────────────────────────────────────────────────────────────
export interface ChartPoint {
  time: string;
  value: number;
}
