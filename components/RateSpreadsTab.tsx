import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import GaugeChart from './GaugeChart';
import MetricCard from './MetricCard';
import PeriodSelector from './PeriodSelector';
import type { SeriesConfig } from './TvChart';
import type { FredObservation, FgCurrentData } from '@/lib/types';
import { SPREADS, POLICY_SERIES, POLICY_COLORS, PERIOD_OPTIONS_LONG } from '@/lib/constants';
import { getSignalStatus, periodDaysAgo, today, movingAverage } from '@/lib/utils';

const TvChart = dynamic(() => import('./TvChart'), { ssr: false });
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Gauge color stops ──────────────────────────────────────────────────────
const FG_STOPS = [
  { from: 0,  to: 25,  color: '#dc2626', label: 'Extreme Fear' },
  { from: 25, to: 45,  color: '#f97316', label: 'Fear' },
  { from: 45, to: 55,  color: '#eab308', label: 'Neutral' },
  { from: 55, to: 75,  color: '#22c55e', label: 'Greed' },
  { from: 75, to: 101, color: '#16a34a', label: 'Extreme Greed' },
];

const VIX_STOPS = [
  { from: 0,  to: 12, color: '#16a34a', label: '매우 낮음' },
  { from: 12, to: 20, color: '#22c55e', label: '낮음' },
  { from: 20, to: 30, color: '#eab308', label: '보통' },
  { from: 30, to: 40, color: '#f97316', label: '높음' },
  { from: 40, to: 81, color: '#dc2626', label: '매우 높음' },
];

// ── Spread calculation ─────────────────────────────────────────────────────
function useSpreadData(spreadKey: string, startDate: string, endDate: string) {
  const info = SPREADS[spreadKey];

  // Fetch both series
  const s1Params = new URLSearchParams({ series_id: info.series[0], start_date: startDate, end_date: endDate });
  const s2Params = info.isSingleSeries ? null
    : new URLSearchParams({ series_id: info.series[1], start_date: startDate, end_date: endDate });

  const { data: d1 } = useSWR<{ data: FredObservation[] }>(
    `/api/fred?${s1Params}`, fetcher, { revalidateOnFocus: false, dedupingInterval: 1800000 }
  );
  const { data: d2 } = useSWR<{ data: FredObservation[] }>(
    s2Params ? `/api/fred?${s2Params}` : null, fetcher,
    { revalidateOnFocus: false, dedupingInterval: 1800000 }
  );

  if (!d1?.data) return { spreadData: null, latestValue: null, s1Data: null, s2Data: null };

  const map1 = new Map(d1.data.map(o => [o.date, o.value]));
  let spreadPoints: { time: string; value: number }[];

  if (info.isSingleSeries) {
    spreadPoints = d1.data.map(o => ({ time: o.date, value: o.value * info.multiplier }))
      .sort((a, b) => a.time.localeCompare(b.time));
  } else {
    if (!d2?.data) return { spreadData: null, latestValue: null, s1Data: null, s2Data: null };
    const map2 = new Map(d2.data.map(o => [o.date, o.value]));
    const dates = [...new Set([...map1.keys(), ...map2.keys()])].sort();
    spreadPoints = [];
    let prev1 = 0, prev2 = 0;
    for (const date of dates) {
      const v1 = map1.get(date) ?? prev1;
      const v2 = map2.get(date) ?? prev2;
      if (map1.has(date)) prev1 = v1;
      if (map2.has(date)) prev2 = v2;
      if (v1 && v2) spreadPoints.push({ time: date, value: (v1 - v2) * info.multiplier });
    }
  }

  const latestValue = spreadPoints.length > 0 ? spreadPoints[spreadPoints.length - 1].value : null;
  const s1Data = d1.data.map(o => ({ time: o.date, value: o.value })).sort((a, b) => a.time.localeCompare(b.time));
  const s2Data = d2?.data?.map(o => ({ time: o.date, value: o.value })).sort((a, b) => a.time.localeCompare(b.time));

  return { spreadData: spreadPoints, latestValue, s1Data, s2Data };
}

// ── Spread Chart Card ──────────────────────────────────────────────────────
function SpreadCard({ spreadKey, startDate, endDate, isActive }: {
  spreadKey: string; startDate: string; endDate: string; isActive: boolean;
}) {
  const info = SPREADS[spreadKey];
  const { spreadData, latestValue, s1Data, s2Data } = useSpreadData(spreadKey, startDate, endDate);

  const unit = info.isSingleSeries ? '' : 'bp';
  const signal = latestValue != null ? getSignalStatus(latestValue, info.signals) : '—';

  if (!spreadData) {
    return (
      <div className="flex items-center justify-center h-[350px] text-gray-500 text-sm">
        데이터 로딩 중…
      </div>
    );
  }

  const priceLines = [
    { price: 0, color: 'rgba(200,200,200,0.5)', label: '', style: 'dashed' as const },
    { price: info.thresholdMin, color: 'rgba(255,165,0,0.5)', label: 'Min', style: 'dotted' as const },
    { price: info.thresholdMax, color: 'rgba(255,165,0,0.5)', label: 'Max', style: 'dotted' as const },
  ];

  // Series config
  const seriesConfig: SeriesConfig[] = [
    { type: 'baseline', data: spreadData, lineWidth: 2, priceLines },
  ];
  if (info.showMa) {
    const ma = movingAverage(spreadData, 4);
    seriesConfig.push({ type: 'line', data: ma, color: '#FF6B6B', lineWidth: 2 });
  }

  const avg = spreadData.reduce((s, p) => s + p.value, 0) / (spreadData.length || 1);
  const max = Math.max(...spreadData.map(p => p.value));
  const min = Math.min(...spreadData.map(p => p.value));

  return (
    <div className="space-y-4">
      {/* Metrics row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard label="현재 값" value={latestValue != null ? `${latestValue.toFixed(2)}${unit}` : 'N/A'} />
        <MetricCard label="평균" value={`${avg.toFixed(2)}${unit}`} />
        <MetricCard label="최대" value={`${max.toFixed(2)}${unit}`} />
        <MetricCard label="최소" value={`${min.toFixed(2)}${unit}`} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Chart */}
        <div className="lg:col-span-2 bg-gray-900 rounded-lg p-3 border border-gray-700">
          <TvChart series={seriesConfig} height={300} />
        </div>
        {/* Signal info */}
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700 space-y-3">
          <div>
            <div className="text-xs text-gray-400 mb-1">현재 신호</div>
            <div className="text-sm font-medium text-white">{signal}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">정상 범위</div>
            <div className="text-sm text-gray-200">{info.normalRange}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">의미</div>
            <div className="text-xs text-gray-300">{info.description}</div>
          </div>
          <div>
            <div className="text-xs text-gray-400 mb-1">해석</div>
            <div className="text-xs text-gray-300 leading-relaxed">{info.interpretation}</div>
          </div>
        </div>
      </div>

      {/* Component series (non-single) */}
      {!info.isSingleSeries && s1Data && s2Data && (
        <details className="bg-gray-900 rounded-lg border border-gray-700">
          <summary className="px-4 py-2 text-sm text-gray-300 cursor-pointer hover:text-white">
            ▶ 구성 요소 보기 ({info.series[0]} / {info.series[1]})
          </summary>
          <div className="px-4 pb-4">
            <TvChart
              series={[
                { type: 'line', data: s1Data, color: '#EE5A6F', lineWidth: 2, name: info.series[0] },
                { type: 'line', data: s2Data, color: '#4ECDC4', lineWidth: 2, name: info.series[1] },
              ]}
              height={200}
            />
            <div className="flex gap-6 mt-2 text-xs">
              {[info.series[0], info.series[1]].map((s, i) => (
                <span key={s} style={{ color: i === 0 ? '#EE5A6F' : '#4ECDC4' }}>
                  ● {s}
                </span>
              ))}
            </div>
          </div>
        </details>
      )}
    </div>
  );
}

// ── Summary bar (overview) ─────────────────────────────────────────────────
function SpreadSummaryBar({ startDate, endDate }: { startDate: string; endDate: string }) {
  const spreadKeys = Object.keys(SPREADS);

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {spreadKeys.map(key => {
        const info = SPREADS[key];
        const s1P = new URLSearchParams({ series_id: info.series[0], start_date: startDate, end_date: endDate });
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const { data: d1 } = useSWR<{ data: FredObservation[] }>(
          `/api/fred?${s1P}`, fetcher, { revalidateOnFocus: false, dedupingInterval: 1800000 }
        );
        const s2P = info.isSingleSeries ? null
          : new URLSearchParams({ series_id: info.series[1], start_date: startDate, end_date: endDate });
        // eslint-disable-next-line react-hooks/rules-of-hooks
        const { data: d2 } = useSWR<{ data: FredObservation[] }>(
          s2P ? `/api/fred?${s2P}` : null, fetcher,
          { revalidateOnFocus: false, dedupingInterval: 1800000 }
        );

        let latestValue: number | null = null;
        if (d1?.data) {
          if (info.isSingleSeries) {
            latestValue = (d1.data[0]?.value ?? null);
            if (latestValue != null) latestValue *= info.multiplier;
          } else if (d2?.data) {
            const v1 = d1.data[0]?.value;
            const v2 = d2.data[0]?.value;
            if (v1 != null && v2 != null) latestValue = (v1 - v2) * info.multiplier;
          }
        }

        const unit = info.isSingleSeries ? '' : 'bp';
        const signal = latestValue != null ? getSignalStatus(latestValue, info.signals) : '로딩 중…';
        const shortSignal = signal.split(' - ')[0];

        return (
          <MetricCard
            key={key}
            label={info.name}
            value={latestValue != null ? `${latestValue.toFixed(2)}${unit}` : '—'}
            delta={shortSignal}
            description={info.description}
          />
        );
      })}
    </div>
  );
}

// ── Policy Rate Framework Chart ────────────────────────────────────────────
function PolicyRateChart({ startDate, endDate }: { startDate: string; endDate: string }) {
  const seriesIds = Object.keys(POLICY_SERIES);
  const allData: Record<string, { time: string; value: number }[]> = {};

  // Fetch each series (hooks must be called unconditionally)
  seriesIds.forEach(id => {
    const params = new URLSearchParams({ series_id: id, start_date: startDate, end_date: endDate });
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { data } = useSWR<{ data: FredObservation[] }>(
      `/api/fred?${params}`, fetcher, { revalidateOnFocus: false, dedupingInterval: 1800000 }
    );
    if (data?.data) {
      allData[id] = data.data
        .map(o => ({ time: o.date, value: o.value }))
        .sort((a, b) => a.time.localeCompare(b.time));
    }
  });

  const hasData = Object.keys(allData).length > 0;

  const seriesConfigs = seriesIds
    .filter(id => allData[id]?.length > 0)
    .map(id => ({
      type: 'line' as const,
      data: allData[id],
      color: POLICY_COLORS[id] ?? '#aaa',
      lineWidth: id === 'DFEDTARL' || id === 'DFEDTARU' ? 1 : 2,
      name: id,
    }));

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
      <h3 className="text-sm font-semibold text-white mb-3">연준 정책금리 프레임워크</h3>
      {hasData ? (
        <>
          <TvChart series={seriesConfigs} height={380} />
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
            {seriesIds.filter(id => allData[id]).map(id => (
              <span key={id} className="text-xs flex items-center gap-1">
                <span style={{ color: POLICY_COLORS[id] }}>●</span>
                <span className="text-gray-300">{id} ({POLICY_SERIES[id]})</span>
              </span>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4 text-xs text-gray-300">
            <div className="bg-gray-800 rounded p-3">
              <strong className="text-white">금리 조절 메커니즘</strong>
              <ul className="mt-1 space-y-0.5">
                <li>목표 범위: FOMC 설정</li>
                <li>IORB: 상한 역할</li>
                <li>ON RRP: 하한 역할</li>
                <li>EFFR: 실제 시장금리</li>
              </ul>
            </div>
            {allData.SOFR && allData.EFFR && allData.IORB && allData.RRPONTSYAWARD && (() => {
              const latest = { SOFR: allData.SOFR.at(-1)?.value, EFFR: allData.EFFR.at(-1)?.value,
                               IORB: allData.IORB.at(-1)?.value, RRP: allData.RRPONTSYAWARD.at(-1)?.value };
              return (
                <div className="bg-gray-800 rounded p-3">
                  <strong className="text-white">최신 금리 (%)</strong>
                  <ul className="mt-1 space-y-0.5">
                    <li>SOFR: <strong>{latest.SOFR?.toFixed(2)}</strong>%</li>
                    <li>EFFR: <strong>{latest.EFFR?.toFixed(2)}</strong>%</li>
                    <li>IORB: <strong>{latest.IORB?.toFixed(2)}</strong>%</li>
                    <li>ON RRP: <strong>{latest.RRP?.toFixed(2)}</strong>%</li>
                  </ul>
                </div>
              );
            })()}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-[380px] text-gray-500 text-sm">
          데이터 로딩 중…
        </div>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function RateSpreadsTab() {
  const [periodDays, setPeriodDays] = useState<number | null>(365);
  const [activeSpread, setActiveSpread] = useState<string>(Object.keys(SPREADS)[0]);

  const startDate = periodDays ? periodDaysAgo(periodDays) : '2004-01-01';
  const endDate = today();

  const { data: fgData } = useSWR<{ data: FgCurrentData }>(
    '/api/fear-greed', fetcher, { revalidateOnFocus: false, dedupingInterval: 1800000 }
  );

  const { data: vixRaw } = useSWR<{ data: FredObservation[] }>(
    '/api/fred?series_id=VIXCLS&limit=1', fetcher,
    { revalidateOnFocus: false, dedupingInterval: 1800000 }
  );
  const vixValue = vixRaw?.data?.[0]?.value ?? null;
  const vixLabel = vixValue == null ? '로딩 중'
    : vixValue < 12 ? '매우 낮음 - 시장 안정'
    : vixValue < 20 ? '낮음 - 시장 안정'
    : vixValue < 30 ? '보통 - 변동성 증가'
    : vixValue < 40 ? '높음 - 시장 불안'
    : '매우 높음 - 극심한 불안';

  const spreadKeys = Object.keys(SPREADS);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">금리 스프레드 모니터링</h2>
          <p className="text-xs text-gray-400 mt-0.5">유동성 · 침체 · 스트레스 지표</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400">기간:</span>
          <PeriodSelector
            options={PERIOD_OPTIONS_LONG}
            selected={periodDays}
            onChange={setPeriodDays}
          />
        </div>
      </div>

      {/* Sentiment gauges */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">🎭 시장 심리 지표</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Fear & Greed */}
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 flex flex-col items-center">
            {fgData?.data ? (
              <>
                <GaugeChart
                  value={fgData.data.score}
                  min={0} max={100}
                  colorStops={FG_STOPS}
                  title={`${fgData.data.emoji} ${fgData.data.status}`}
                  subtitle={`Score: ${fgData.data.score.toFixed(1)} / 100 · ${fgData.data.source}`}
                  size={220}
                />
                <div className="mt-3 text-center text-xs text-gray-400 leading-relaxed">
                  0–25: Extreme Fear 😱 · 25–45: Fear 😨<br />
                  45–55: Neutral 😐 · 55–75: Greed 😊 · 75–100: Extreme Greed 🤑
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-gray-500 text-sm">Fear & Greed 로딩 중…</span>
              </div>
            )}
            <div className="text-xs font-semibold text-gray-300 mt-3">Fear & Greed Index (CNN)</div>
          </div>

          {/* VIX */}
          <div className="bg-gray-900 rounded-lg p-6 border border-gray-700 flex flex-col items-center">
            {vixValue != null ? (
              <>
                <GaugeChart
                  value={vixValue}
                  min={0} max={80}
                  colorStops={VIX_STOPS}
                  title={vixLabel.split(' - ')[0]}
                  subtitle={`VIX: ${vixValue.toFixed(2)} · ${vixLabel.split(' - ')[1] ?? ''}`}
                  size={220}
                />
                <div className="mt-3 text-center text-xs text-gray-400 leading-relaxed">
                  &lt;12: 매우 낮음 😌 · 12–20: 낮음 🙂<br />
                  20–30: 보통 😐 · 30–40: 높음 😰 · &gt;40: 매우 높음 🚨
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-gray-500 text-sm">VIX 로딩 중…</span>
              </div>
            )}
            <div className="text-xs font-semibold text-gray-300 mt-3">VIX Volatility Index (FRED)</div>
          </div>
        </div>
      </div>

      {/* Summary bar */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">📍 현재 상태 요약</h3>
        <SpreadSummaryBar startDate={startDate} endDate={endDate} />
      </div>

      {/* Policy rate chart */}
      <PolicyRateChart startDate={startDate} endDate={endDate} />

      {/* Spread detail tabs */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">📈 상세 스프레드 차트</h3>
        {/* Spread selector */}
        <div className="flex flex-wrap gap-1 mb-4 border-b border-gray-700 pb-2">
          {spreadKeys.map(key => (
            <button
              key={key}
              onClick={() => setActiveSpread(key)}
              className={clsx(
                'px-3 py-1.5 text-xs rounded-t font-medium transition-colors',
                activeSpread === key
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800'
              )}
            >
              {SPREADS[key].name}
            </button>
          ))}
        </div>

        <SpreadCard
          spreadKey={activeSpread}
          startDate={startDate}
          endDate={endDate}
          isActive={true}
        />
      </div>

      <p className="text-xs text-gray-500 text-right">
        데이터 출처: Federal Reserve Economic Data (FRED)
      </p>
    </div>
  );
}
