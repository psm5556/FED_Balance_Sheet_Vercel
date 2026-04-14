import type { FgRating } from './types';

export function formatNumber(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return 'N/A';
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

export function formatChange(change: number | null | undefined): string {
  if (change == null || isNaN(change)) return 'N/A';
  if (change > 0) return `▲ ${Math.abs(change).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  if (change < 0) return `▼ ${Math.abs(change).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
  return '0';
}

export function scoreToRating(score: number): FgRating {
  if (score < 25) return 'extreme fear';
  if (score < 45) return 'fear';
  if (score < 55) return 'neutral';
  if (score < 75) return 'greed';
  return 'extreme greed';
}

export function ratingToColor(rating: string | null | undefined): string {
  const map: Record<string, string> = {
    'extreme fear':  '#dc2626',
    'fear':          '#f97316',
    'neutral':       '#eab308',
    'greed':         '#22c55e',
    'extreme greed': '#16a34a',
  };
  if (!rating || typeof rating !== 'string') return '#9ca3af';
  return map[rating.toLowerCase().trim()] ?? '#9ca3af';
}

export function ratingToEmoji(rating: string): string {
  const map: Record<string, string> = {
    'extreme fear':  '😱',
    'fear':          '😨',
    'neutral':       '😐',
    'greed':         '😊',
    'extreme greed': '🤑',
  };
  return map[rating.toLowerCase().trim()] ?? '📊';
}

export function getFredLink(seriesId: string): string {
  return `https://fred.stlouisfed.org/series/${seriesId}`;
}

export function getSignalStatus(value: number, signals: Record<string, { min: number; max: number; message: string }>): string {
  for (const entry of Object.values(signals)) {
    if (value >= entry.min && value < entry.max) return entry.message;
  }
  return '📊 데이터 확인 필요';
}

export function periodDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

export function today(): string {
  return new Date().toISOString().split('T')[0];
}

export function quarterLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

export function movingAverage(data: { time: string; value: number }[], window: number) {
  return data.map((point, i) => {
    const start = Math.max(0, i - window + 1);
    const slice = data.slice(start, i + 1);
    const avg = slice.reduce((s, p) => s + p.value, 0) / slice.length;
    return { time: point.time, value: avg };
  });
}
