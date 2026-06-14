import dynamic from 'next/dynamic';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import PeriodSelector from './PeriodSelector';
import type { FgHistoryResponse } from '@/lib/types';
import { FG_PERIOD_OPTIONS, INDEX_GROUPS, ALL_INDEX_OPTIONS } from '@/lib/constants';
import { movingAverage } from '@/lib/utils';
import type { SeriesConfig } from './TvChart';

const TvChart = dynamic(() => import('./TvChart'), { ssr: false });
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── F&G line definitions ──────────────────────────────────────────────────────

const FG_LINES = [
  { key: 'd1',    label: '1일',     color: '#60a5fa' },
  { key: 'ma20',  label: '20일 MA', color: '#e2e8f0' },
  { key: 'ma60',  label: '60일 MA', color: '#eab308' },
  { key: 'ma200', label: '200일 MA',color: '#f97316' },
] as const;

type FgLineKey = typeof FG_LINES[number]['key'];

// ── Detrend: OLS linear regression → normalize residuals to 0–100 ─────────────

function linearDetrend(data: { time: string; value: number }[]): { time: string; value: number }[] {
  const n = data.length;
  if (n < 2) return data.map(d => ({ ...d, value: 50 }));

  const sumX  = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumY  = data.reduce((s, d) => s + d.value, 0);
  const sumXY = data.reduce((s, d, i) => s + i * d.value, 0);
  const denom = n * sumX2 - sumX * sumX;

  const slope     = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  const residuals = data.map((d, i) => d.value - (slope * i + intercept));
  const minR = Math.min(...residuals);
  const maxR = Math.max(...residuals);
  const range = maxR - minR;

  return data.map((d, i) => ({
    time: d.time,
    value: range === 0 ? 50 : ((residuals[i] - minR) / range) * 100,
  }));
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FearGreedTrendTab() {
  const [periodDays, setPeriodDays]       = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<string | null>(null);
  const [detrended, setDetrended]         = useState(false);
  const [fgVis, setFgVis]                 = useState<Record<FgLineKey, boolean>>({
    d1: true, ma20: true, ma60: true, ma200: true,
  });

  // F&G + SP500 (FRED)
  const { data: histData, isLoading } = useSWR<FgHistoryResponse>(
    '/api/fear-greed-history', fetcher,
    { revalidateOnFocus: false, dedupingInterval: 1800000 }
  );

  // Yahoo Finance proxy — single hook, key changes when selectedIndex changes
  const yahooTicker = selectedIndex && selectedIndex !== 'SP500' ? selectedIndex : null;
  const { data: yahooData } = useSWR<{ data: { date: string; close: number }[] }>(
    yahooTicker ? `/api/yahoo-chart?ticker=${yahooTicker}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 1800000 }
  );

  const cutoff = useMemo<Date | null>(() => {
    if (!periodDays) return null;
    const d = new Date();
    d.setDate(d.getDate() - periodDays);
    return d;
  }, [periodDays]);

  const filteredFg = useMemo(() => {
    if (!histData?.fgHistory) return [];
    return cutoff
      ? histData.fgHistory.filter(p => new Date(p.date) >= cutoff)
      : histData.fgHistory;
  }, [histData, cutoff]);

  const filteredIndex = useMemo<{ time: string; value: number }[]>(() => {
    let raw: { date: string; close: number }[] = [];
    if (selectedIndex === 'SP500' && histData?.sp500) {
      raw = histData.sp500.map(p => ({ date: p.date, close: p.price }));
    } else if (yahooData?.data) {
      raw = yahooData.data;
    }
    const filtered = cutoff ? raw.filter(p => new Date(p.date) >= cutoff) : raw;
    const series = filtered.map(p => ({ time: p.date, value: p.close }));
    return detrended ? linearDetrend(series) : series;
  }, [selectedIndex, histData, yahooData, cutoff, detrended]);

  const selectedMeta = selectedIndex
    ? ALL_INDEX_OPTIONS.find(o => o.key === selectedIndex) ?? null
    : null;

  // Build chart series
  const chartSeries = useMemo<SeriesConfig[]>(() => {
    if (!filteredFg.length) return [];

    const raw = filteredFg.map(p => ({ time: p.date, value: p.score }));
    const series: SeriesConfig[] = [];

    // Monday background bands (rendered first so they appear behind all other series)
    const mondayData = filteredFg
      .filter(p => { const [y, m, d] = p.date.split('-').map(Number); return new Date(y, m - 1, d).getDay() === 1; })
      .map(p => ({ time: p.date, value: 100 }));
    if (mondayData.length > 0) {
      series.push({
        type: 'histogram',
        data: mondayData,
        color: 'rgba(148,163,184,0.12)',
        priceScaleId: 'left',
        lastValueVisible: false,
      });
    }

    if (fgVis.d1) {
      series.push({
        type: 'area',
        data: raw,
        color: '#60a5fa',
        topColor: 'rgba(96,165,250,0.15)',
        bottomColor: 'rgba(96,165,250,0.01)',
        lineWidth: 1,
        priceScaleId: 'left',
        lastValueVisible: true,
        priceLines: [
          { price: 25, color: 'rgba(220,38,38,0.5)',  label: 'Fear',      style: 'dotted' },
          { price: 45, color: 'rgba(249,115,22,0.5)', label: 'Neutral',   style: 'dotted' },
          { price: 55, color: 'rgba(234,179,8,0.5)',  label: 'Greed',     style: 'dotted' },
          { price: 75, color: 'rgba(34,197,94,0.5)',  label: 'Ex. Greed', style: 'dotted' },
        ],
      });
    }

    if (fgVis.ma20) {
      series.push({
        type: 'line', data: movingAverage(raw, 20),
        color: '#e2e8f0', lineWidth: 2, priceScaleId: 'left', lastValueVisible: true,
      });
    }
    if (fgVis.ma60) {
      series.push({
        type: 'line', data: movingAverage(raw, 60),
        color: '#eab308', lineWidth: 2, priceScaleId: 'left', lastValueVisible: true,
      });
    }
    if (fgVis.ma200) {
      series.push({
        type: 'line', data: movingAverage(raw, 200),
        color: '#f97316', lineWidth: 2, priceScaleId: 'left', lastValueVisible: true,
      });
    }

    if (selectedMeta && filteredIndex.length > 0) {
      series.push({
        type: 'line',
        data: filteredIndex,
        color: selectedMeta.color,
        lineWidth: 1.5,
        priceScaleId: detrended ? 'left' : 'right',
        lastValueVisible: true,
      });
    }

    return series;
  }, [filteredFg, filteredIndex, selectedMeta, detrended, fgVis]);

  const showRightAxis = selectedIndex !== null && !detrended;
  const toggleFg = (key: FgLineKey) => setFgVis(prev => ({ ...prev, [key]: !prev[key] }));

  if (isLoading) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">데이터 로딩 중...</div>;
  }

  return (
    <div className="space-y-3">

      {/* ── Period selector ───────────────────────────────────────────── */}
      <PeriodSelector options={FG_PERIOD_OPTIONS} selected={periodDays} onChange={setPeriodDays} />

      {/* ── Index overlay selector (grouped) ─────────────────────────── */}
      <div className="bg-gray-900/60 rounded-lg border border-gray-800 p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-400">지수 오버레이</span>
          {selectedIndex && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setDetrended(v => !v)}
                className={clsx(
                  'px-2.5 py-1 text-xs rounded font-medium border transition-colors',
                  detrended
                    ? 'bg-violet-700 border-violet-500 text-white'
                    : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'
                )}
                title="OLS 선형회귀로 장기 추세 제거 후 0-100 정규화 → F&G와 같은 축에 비교"
              >
                추세 제거 {detrended ? 'ON' : 'OFF'}
              </button>
              <button
                onClick={() => { setSelectedIndex(null); setDetrended(false); }}
                className="px-2.5 py-1 text-xs rounded text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-700"
              >
                ✕ 해제
              </button>
            </div>
          )}
        </div>

        {INDEX_GROUPS.map(({ group, items }) => (
          <div key={group} className="flex items-start gap-2">
            <span className="text-xs text-gray-600 w-10 shrink-0 pt-1">{group}</span>
            <div className="flex flex-wrap gap-1">
              {items.map(opt => {
                const isSelected = selectedIndex === opt.key;
                return (
                  <button
                    key={opt.key}
                    onClick={() => setSelectedIndex(isSelected ? null : opt.key)}
                    title={opt.title}
                    className={clsx(
                      'px-2.5 py-0.5 text-xs rounded font-medium border transition-all whitespace-nowrap',
                      isSelected
                        ? 'text-white border-transparent'
                        : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200 hover:border-gray-500'
                    )}
                    style={isSelected
                      ? { backgroundColor: opt.color + '33', borderColor: opt.color + '99', color: opt.color }
                      : undefined}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── F&G line toggles (clickable legend) ──────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-gray-500">F&G 선:</span>
        {FG_LINES.map(({ key, label, color }) => (
          <button
            key={key}
            onClick={() => toggleFg(key)}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium transition-all',
              fgVis[key] ? 'text-white' : 'border-gray-700 text-gray-600 opacity-40'
            )}
            style={fgVis[key] ? { borderColor: color + '70', backgroundColor: color + '18' } : undefined}
          >
            <div className="w-4 h-0.5 rounded shrink-0" style={{ backgroundColor: fgVis[key] ? color : '#4b5563' }} />
            {label}
          </button>
        ))}
        {selectedMeta && (
          <>
            <span className="text-gray-700 text-xs">|</span>
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs"
              style={{ borderColor: selectedMeta.color + '70', backgroundColor: selectedMeta.color + '18', color: selectedMeta.color }}
            >
              <div className="w-4 h-0.5 rounded" style={{ backgroundColor: selectedMeta.color }} />
              {selectedMeta.title}
              {detrended && <span className="text-violet-300 ml-0.5 text-[10px]">(추세 제거)</span>}
            </div>
          </>
        )}
      </div>

      {/* ── Main chart ────────────────────────────────────────────────── */}
      <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
        {chartSeries.length > 0 ? (
          <TvChart
            series={chartSeries}
            height={750}
            leftScaleVisible
            rightScaleVisible={showRightAxis}
          />
        ) : (
          <div className="flex items-center justify-center h-[750px] text-gray-500 text-sm">데이터 없음</div>
        )}
      </div>

      {histData?.dataSourceInfo && (
        <div className="text-xs text-gray-600 text-right">
          F&G: {histData.dataSourceInfo.startDate} ~ {histData.dataSourceInfo.endDate} ({histData.dataSourceInfo.totalDays.toLocaleString()}일)
        </div>
      )}
    </div>
  );
}
