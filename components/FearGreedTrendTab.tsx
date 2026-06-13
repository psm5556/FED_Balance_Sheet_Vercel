import dynamic from 'next/dynamic';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import PeriodSelector from './PeriodSelector';
import type { FgHistoryResponse } from '@/lib/types';
import { FG_PERIOD_OPTIONS } from '@/lib/constants';
import { movingAverage } from '@/lib/utils';
import type { SeriesConfig } from './TvChart';

const TvChart = dynamic(() => import('./TvChart'), { ssr: false });
const fetcher = (url: string) => fetch(url).then(r => r.json());

type IndexKey = 'SP500' | 'QQQ' | 'SOXX';

const INDEX_OPTIONS: { key: IndexKey; label: string; color: string }[] = [
  { key: 'SP500', label: 'S&P 500',   color: '#f59e0b' },
  { key: 'QQQ',  label: 'NASDAQ 100', color: '#a78bfa' },
  { key: 'SOXX', label: 'SOXX',       color: '#34d399' },
];

/** Convert a price series to 0-100 percentile rank over its own distribution */
function percentileRank(data: { time: string; value: number }[]): { time: string; value: number }[] {
  if (!data.length) return [];
  const sorted = [...data.map(d => d.value)].sort((a, b) => a - b);
  const n = sorted.length;
  return data.map(d => {
    let lo = 0, hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] <= d.value) lo = mid + 1;
      else hi = mid;
    }
    return { time: d.time, value: (lo / n) * 100 };
  });
}

export default function FearGreedTrendTab() {
  const [periodDays, setPeriodDays] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<IndexKey | null>(null);
  const [detrended, setDetrended] = useState(false);

  const { data: histData, isLoading } = useSWR<FgHistoryResponse>(
    '/api/fear-greed-history', fetcher,
    { revalidateOnFocus: false, dedupingInterval: 1800000 }
  );

  const { data: qqqData } = useSWR<{ data: { date: string; close: number }[] }>(
    selectedIndex === 'QQQ' ? '/api/yahoo-chart?ticker=QQQ' : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 1800000 }
  );

  const { data: soxxData } = useSWR<{ data: { date: string; close: number }[] }>(
    selectedIndex === 'SOXX' ? '/api/yahoo-chart?ticker=SOXX' : null,
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
    } else if (selectedIndex === 'QQQ' && qqqData?.data) {
      raw = qqqData.data;
    } else if (selectedIndex === 'SOXX' && soxxData?.data) {
      raw = soxxData.data;
    }
    const filtered = cutoff ? raw.filter(p => new Date(p.date) >= cutoff) : raw;
    const series = filtered.map(p => ({ time: p.date, value: p.close }));
    return detrended ? percentileRank(series) : series;
  }, [selectedIndex, histData, qqqData, soxxData, cutoff, detrended]);

  const indexMeta = selectedIndex ? INDEX_OPTIONS.find(o => o.key === selectedIndex) : null;

  const chartSeries = useMemo<SeriesConfig[]>(() => {
    if (!filteredFg.length) return [];

    const raw = filteredFg.map(p => ({ time: p.date, value: p.score }));
    const series: SeriesConfig[] = [
      {
        type: 'area',
        data: raw,
        color: '#60a5fa',
        topColor: 'rgba(96,165,250,0.15)',
        bottomColor: 'rgba(96,165,250,0.01)',
        lineWidth: 1,
        priceScaleId: 'left',
        priceLines: [
          { price: 25, color: 'rgba(220,38,38,0.5)',  label: 'Fear',      style: 'dotted' },
          { price: 45, color: 'rgba(249,115,22,0.5)', label: 'Neutral',   style: 'dotted' },
          { price: 55, color: 'rgba(234,179,8,0.5)',  label: 'Greed',     style: 'dotted' },
          { price: 75, color: 'rgba(34,197,94,0.5)',  label: 'Ex. Greed', style: 'dotted' },
        ],
      },
      {
        type: 'line',
        data: movingAverage(raw, 20),
        color: '#ffffff',
        lineWidth: 2,
        priceScaleId: 'left',
        lastValueVisible: true,
      },
      {
        type: 'line',
        data: movingAverage(raw, 60),
        color: '#eab308',
        lineWidth: 2,
        priceScaleId: 'left',
        lastValueVisible: true,
      },
      {
        type: 'line',
        data: movingAverage(raw, 200),
        color: '#f97316',
        lineWidth: 2,
        priceScaleId: 'left',
        lastValueVisible: true,
      },
    ];

    if (indexMeta && filteredIndex.length > 0) {
      series.push({
        type: 'line',
        data: filteredIndex,
        color: indexMeta.color,
        lineWidth: 1.5,
        priceScaleId: detrended ? 'left' : 'right',
        lastValueVisible: true,
      });
    }

    return series;
  }, [filteredFg, filteredIndex, indexMeta, detrended]);

  const showRightAxis = selectedIndex !== null && !detrended;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-400 text-sm">
        데이터 로딩 중...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-3">
        <PeriodSelector options={FG_PERIOD_OPTIONS} selected={periodDays} onChange={setPeriodDays} />

        <div className="h-4 border-l border-gray-700" />

        {/* Index selector */}
        <div className="flex items-center gap-1">
          <span className="text-xs text-gray-500 mr-1">지수 오버레이:</span>
          <button
            onClick={() => { setSelectedIndex(null); setDetrended(false); }}
            className={clsx(
              'px-3 py-1 text-sm rounded font-medium transition-colors',
              selectedIndex === null
                ? 'bg-gray-600 text-white'
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            )}
          >
            없음
          </button>
          {INDEX_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setSelectedIndex(opt.key)}
              className={clsx(
                'px-3 py-1 text-sm rounded font-medium transition-colors border',
                selectedIndex === opt.key
                  ? 'text-white border-transparent'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700 border-transparent'
              )}
              style={selectedIndex === opt.key ? { backgroundColor: opt.color + 'aa' } : undefined}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {/* Detrend toggle */}
        {selectedIndex && (
          <button
            onClick={() => setDetrended(v => !v)}
            className={clsx(
              'px-3 py-1 text-sm rounded font-medium transition-colors border',
              detrended
                ? 'bg-violet-700 border-violet-500 text-white'
                : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'
            )}
            title="추세(장기 우상향)를 제거하고 0-100 백분위로 정규화하여 F&G와 같은 축에 비교"
          >
            추세 제거 {detrended ? 'ON' : 'OFF'}
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-gray-400">
        {[
          { color: '#60a5fa', label: 'F&G 1일' },
          { color: '#ffffff', label: '20일 MA' },
          { color: '#eab308', label: '60일 MA' },
          { color: '#f97316', label: '200일 MA' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5">
            <div className="w-5 h-0.5 rounded" style={{ backgroundColor: color }} />
            <span>{label}</span>
          </div>
        ))}
        {indexMeta && (
          <div className="flex items-center gap-1.5">
            <div className="w-5 h-0.5 rounded" style={{ backgroundColor: indexMeta.color }} />
            <span>{indexMeta.label}</span>
            {detrended && <span className="text-violet-400 ml-1">(백분위 정규화)</span>}
          </div>
        )}
      </div>

      {/* Main chart */}
      <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden">
        {chartSeries.length > 0 ? (
          <TvChart
            series={chartSeries}
            height={600}
            leftScaleVisible
            rightScaleVisible={showRightAxis}
          />
        ) : (
          <div className="flex items-center justify-center h-[600px] text-gray-500 text-sm">
            데이터 없음
          </div>
        )}
      </div>

      {/* Data range info */}
      {histData?.dataSourceInfo && (
        <div className="text-xs text-gray-600 text-right">
          F&G 데이터: {histData.dataSourceInfo.startDate} ~ {histData.dataSourceInfo.endDate} ({histData.dataSourceInfo.totalDays.toLocaleString()}일)
        </div>
      )}
    </div>
  );
}
