import dynamic from 'next/dynamic';
import { useState, useMemo } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import PeriodSelector from './PeriodSelector';
import type { FgHistoryResponse, FgHistoryPoint } from '@/lib/types';
import { FG_PERIOD_OPTIONS } from '@/lib/constants';
import { ratingToColor, scoreToRating, movingAverage } from '@/lib/utils';

const TvChart = dynamic(() => import('./TvChart'), { ssr: false });
const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Rating labels ──────────────────────────────────────────────────────────
const RATING_ORDER = ['extreme fear', 'fear', 'neutral', 'greed', 'extreme greed'] as const;
const RATING_KO: Record<string, string> = {
  'extreme fear':  '극도의 공포',
  'fear':          '공포',
  'neutral':       '중립',
  'greed':         '탐욕',
  'extreme greed': '극도의 탐욕',
};

// ── Status card ────────────────────────────────────────────────────────────
function StatusCard({ label, score, diff }: { label: string; score?: number | null; diff?: number | null }) {
  if (score == null) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
        <div className="text-2xl text-gray-500">—</div>
        <div className="text-xs text-gray-400 mt-1">{label}</div>
      </div>
    );
  }
  const rating = scoreToRating(score);
  const color = ratingToColor(rating);
  const diffColor = diff == null ? undefined : diff >= 0 ? '#4ade80' : '#f87171';
  return (
    <div
      className="rounded-lg p-4 text-center border"
      style={{ backgroundColor: `${color}18`, borderColor: `${color}55` }}
    >
      <div className="text-2xl font-bold" style={{ color }}>{score.toFixed(1)}</div>
      {diff != null && (
        <div className="text-xs font-medium mt-0.5" style={{ color: diffColor }}>
          {diff >= 0 ? '▲' : '▼'} {Math.abs(diff).toFixed(1)}
        </div>
      )}
      <div className="text-xs text-gray-300 mt-1">{label}</div>
    </div>
  );
}

// ── Distribution bar chart ─────────────────────────────────────────────────
function DistributionChart({ data }: { data: FgHistoryPoint[] }) {
  if (!data.length) return null;
  const counts = Object.fromEntries(RATING_ORDER.map(r => [r, 0]));
  for (const p of data) counts[p.rating.toLowerCase()] = (counts[p.rating.toLowerCase()] ?? 0) + 1;
  const total = data.length;

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
      <h4 className="text-sm font-semibold text-white mb-4">구간별 출현 비율</h4>
      <div className="space-y-2">
        {RATING_ORDER.map(r => {
          const count = counts[r] ?? 0;
          const pct = total > 0 ? (count / total) * 100 : 0;
          const color = ratingToColor(r);
          return (
            <div key={r}>
              <div className="flex justify-between text-xs text-gray-300 mb-1">
                <span>{RATING_KO[r]}</span>
                <span className="font-mono">{pct.toFixed(1)}% ({count}일)</span>
              </div>
              <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${pct}%`, backgroundColor: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Statistics table ───────────────────────────────────────────────────────
function StatisticsTable({ data }: { data: FgHistoryPoint[] }) {
  if (!data.length) return null;
  const total = data.length;
  const scores = data.map(p => p.score);
  const avg = scores.reduce((s, v) => s + v, 0) / total;
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const maxScore = Math.max(...scores);
  const minScore = Math.min(...scores);
  const maxDate = data.find(p => p.score === maxScore)?.date ?? '';
  const minDate = data.find(p => p.score === minScore)?.date ?? '';

  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
      <h4 className="text-sm font-semibold text-white mb-3">전체 기간 통계</h4>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {[
          ['총 데이터', `${total.toLocaleString()}일`],
          ['평균 점수', avg.toFixed(1)],
          ['중앙값', median.toFixed(1)],
          ['최고점', `${maxScore.toFixed(1)} (${maxDate})`],
          ['최저점', `${minScore.toFixed(1)} (${minDate})`],
        ].map(([k, v]) => (
          <div key={k} className="bg-gray-800 rounded p-2">
            <div className="text-gray-400">{k}</div>
            <div className="text-white font-medium mt-0.5">{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sub-indicators ─────────────────────────────────────────────────────────
function SubIndicators({ histData, cutoff }: {
  histData: FgHistoryResponse;
  cutoff: Date | null;
}) {
  const filter = <T extends { date: string }>(arr?: T[]): T[] => {
    if (!arr?.length) return [];
    return cutoff ? arr.filter(p => new Date(p.date) >= cutoff) : arr;
  };

  const vix     = filter(histData.vix).map(p => ({ time: p.date, value: p.vix }));
  const putCall = filter(histData.putCall).map(p => ({ time: p.date, value: p.ratio }));
  const jb      = filter(histData.junkBond).map(p => ({ time: p.date, value: p.spread }));

  if (!vix.length && !putCall.length && !jb.length) {
    return (
      <div className="text-sm text-gray-500 text-center py-8">
        세부 구성 지표 데이터를 불러올 수 없습니다.
      </div>
    );
  }

  const indicators = [
    { label: 'VIX 변동성 지수', data: vix,     color: '#ef4444' },
    { label: 'Put/Call Ratio',  data: putCall, color: '#a78bfa' },
    { label: 'Junk Bond Spread', data: jb,     color: '#34d399' },
  ].filter(ind => ind.data.length > 0);

  return (
    <div className="space-y-4">
      {indicators.map(ind => (
        <div key={ind.label} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
          <h4 className="text-xs font-semibold text-gray-300 mb-2">{ind.label}</h4>
          <TvChart
            series={[{ type: 'line', data: ind.data, color: ind.color, lineWidth: 1.5 }]}
            height={150}
          />
        </div>
      ))}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function FearGreedHistoryTab() {
  const [periodDays, setPeriodDays] = useState<number | null>(null); // 전체
  const [showSP500, setShowSP500] = useState(true);

  const { data: histData, error, isLoading } =
    useSWR<FgHistoryResponse>('/api/fear-greed-history', fetcher, {
      revalidateOnFocus: false,
      dedupingInterval: 1800000,
    });

  const cutoff = useMemo<Date | null>(() => {
    if (!periodDays) return null;
    const d = new Date();
    d.setDate(d.getDate() - periodDays);
    return d;
  }, [periodDays]);

  const filteredFg = useMemo<FgHistoryPoint[]>(() => {
    if (!histData?.fgHistory) return [];
    return cutoff
      ? histData.fgHistory.filter(p => new Date(p.date) >= cutoff)
      : histData.fgHistory;
  }, [histData, cutoff]);

  const filteredSp500 = useMemo(() => {
    if (!histData?.sp500) return [];
    return cutoff
      ? histData.sp500.filter(p => new Date(p.date) >= cutoff)
      : histData.sp500;
  }, [histData, cutoff]);

  // Build chart series
  const mainSeries = useMemo(() => {
    const series = [];
    if (filteredFg.length > 0) {
      series.push({
        type: 'area' as const,
        data: filteredFg.map(p => ({ time: p.date, value: p.score })),
        color: '#60a5fa',
        topColor: 'rgba(96,165,250,0.2)',
        bottomColor: 'rgba(96,165,250,0.02)',
        lineWidth: 2,
        priceScaleId: 'left',
        priceLines: [
          { price: 25, color: 'rgba(220,38,38,0.4)',   label: 'Fear',     style: 'dotted' as const },
          { price: 45, color: 'rgba(249,115,22,0.4)',  label: 'Neutral',  style: 'dotted' as const },
          { price: 55, color: 'rgba(234,179,8,0.4)',   label: 'Greed',    style: 'dotted' as const },
          { price: 75, color: 'rgba(34,197,94,0.4)',   label: 'Ex.Greed', style: 'dotted' as const },
        ],
      });
    }
    if (showSP500 && filteredSp500.length > 0) {
      series.push({
        type: 'line' as const,
        data: filteredSp500.map(p => ({ time: p.date, value: p.price })),
        color: '#f59e0b',
        lineWidth: 1.5,
        priceScaleId: 'right',
      });
    }
    return series;
  }, [filteredFg, filteredSp500, showSP500]);

  // Rolling average chart series
  const rollingSeriesData = useMemo(() => {
    if (!filteredFg.length) return [];
    const raw = filteredFg.map(p => ({ time: p.date, value: p.score }));
    return [
      { type: 'line' as const, data: raw, color: 'rgba(96,165,250,0.35)', lineWidth: 1 },
      { type: 'line' as const, data: movingAverage(raw, 20), color: '#f59e0b', lineWidth: 2 },
      { type: 'line' as const, data: movingAverage(raw, 60), color: '#f87171', lineWidth: 2 },
    ];
  }, [filteredFg]);

  // Current info
  const current = histData?.current;
  const latestFg = histData?.fgHistory?.at(-1);
  const currentScore = current?.score ?? latestFg?.score ?? null;
  const src = histData?.dataSourceInfo;

  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <div className="text-gray-400">CNN Fear &amp; Greed 히스토리 로딩 중…</div>
      </div>
    );
  }

  if (error || !histData) {
    return (
      <div className="bg-red-900/30 border border-red-700 rounded-lg p-4 text-red-300 text-sm">
        ❌ Fear &amp; Greed 히스토리 데이터를 불러올 수 없습니다. 잠시 후 다시 시도해주세요.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-white">😨 Fear &amp; Greed Index 전체 히스토리</h2>
        <p className="text-xs text-gray-400 mt-0.5">출처: CNN Business Fear &amp; Greed Index</p>
      </div>

      {/* Data coverage banner */}
      {src && (
        <div className="bg-green-900/30 border border-green-700 rounded-lg px-4 py-2.5 text-sm text-green-300">
          ✅ 데이터 로드 완료 &nbsp;|&nbsp;
          F&amp;G: <strong>{src.startDate} ~ {src.endDate}</strong>&nbsp;
          ({((new Date(src.endDate).getTime() - new Date(src.startDate).getTime()) / (365.25*86400000)).toFixed(1)}년 / {src.totalDays.toLocaleString()}일)
          &nbsp;|&nbsp;
          {histData.sp500 ? `S&P 500: FRED SP500 ${histData.sp500.length.toLocaleString()}일` : ''}
          &nbsp;|&nbsp;
          출처: {src.hasOldCsv ? 'GitHub CSV(2011~) + CNN API' : 'CNN API'}
        </div>
      )}

      {/* Current status */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">📌 현재 상태</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatusCard label="현재 값" score={currentScore} />
          <StatusCard
            label="1주 전"
            score={current?.previous_1_week ?? null}
            diff={currentScore != null && current?.previous_1_week != null
              ? currentScore - current.previous_1_week : null}
          />
          <StatusCard
            label="1개월 전"
            score={current?.previous_1_month ?? null}
            diff={currentScore != null && current?.previous_1_month != null
              ? currentScore - current.previous_1_month : null}
          />
          <StatusCard
            label="1년 전"
            score={current?.previous_1_year ?? null}
            diff={currentScore != null && current?.previous_1_year != null
              ? currentScore - current.previous_1_year : null}
          />
        </div>
      </div>

      {/* Period filter */}
      <div className="flex flex-wrap items-center gap-4">
        <PeriodSelector
          options={FG_PERIOD_OPTIONS}
          selected={periodDays}
          onChange={setPeriodDays}
        />
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={showSP500}
            onChange={e => setShowSP500(e.target.checked)}
            className="w-4 h-4 accent-yellow-400"
          />
          S&amp;P 500 오버레이
        </label>
      </div>

      {/* Main F&G history chart */}
      <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-white">📊 Fear &amp; Greed 히스토리</h3>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-0.5 bg-blue-400" /> F&amp;G Index (left)
            </span>
            {showSP500 && (
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-yellow-400" /> S&amp;P 500 (right)
              </span>
            )}
          </div>
        </div>
        {mainSeries.length > 0 ? (
          <TvChart
            series={mainSeries}
            height={400}
            leftScaleVisible={true}
            rightScaleVisible={showSP500}
          />
        ) : (
          <div className="h-[400px] flex items-center justify-center text-gray-500">
            데이터 없음
          </div>
        )}
      </div>

      {/* Analysis: distribution + rolling avg */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DistributionChart data={filteredFg} />

        <div className="bg-gray-900 rounded-lg p-4 border border-gray-700">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-white">이동평균 트렌드</h4>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-yellow-400" /> 20일 MA
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-3 h-0.5 bg-red-400" /> 60일 MA
              </span>
            </div>
          </div>
          {rollingSeriesData.length > 0 ? (
            <TvChart series={rollingSeriesData} height={280} />
          ) : (
            <div className="h-[280px] flex items-center justify-center text-gray-500">데이터 없음</div>
          )}
        </div>
      </div>

      {/* Sub-indicators */}
      <div>
        <h3 className="text-sm font-semibold text-gray-300 mb-3">📉 구성 지표 히스토리</h3>
        <p className="text-xs text-gray-400 mb-3">
          VIX, Put/Call Ratio, Junk Bond Spread 등 Fear &amp; Greed 계산에 사용되는 세부 지표
        </p>
        <SubIndicators histData={histData} cutoff={cutoff} />
      </div>

      {/* Statistics detail */}
      <details className="bg-gray-900 rounded-lg border border-gray-700">
        <summary className="px-4 py-3 text-sm text-gray-300 cursor-pointer hover:text-white font-medium">
          📋 구간별 통계 상세 보기
        </summary>
        <div className="px-4 pb-4 space-y-4">
          <StatisticsTable data={filteredFg} />

          {/* Per-rating table */}
          {filteredFg.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-gray-300">
                <thead>
                  <tr className="border-b border-gray-700">
                    {['구간', '일수', '비율', '평균 점수', '최소', '최대'].map(h => (
                      <th key={h} className="py-2 px-2 text-left text-gray-400 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RATING_ORDER.map(r => {
                    const subset = filteredFg.filter(p => p.rating.toLowerCase() === r);
                    if (!subset.length) return null;
                    const pct = (subset.length / filteredFg.length * 100).toFixed(1);
                    const scores = subset.map(p => p.score);
                    const avg = (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1);
                    return (
                      <tr key={r} className="border-b border-gray-800">
                        <td className="py-2 px-2" style={{ color: ratingToColor(r) }}>
                          {RATING_KO[r]} ({r})
                        </td>
                        <td className="py-2 px-2">{subset.length.toLocaleString()}</td>
                        <td className="py-2 px-2">{pct}%</td>
                        <td className="py-2 px-2">{avg}</td>
                        <td className="py-2 px-2">{Math.min(...scores).toFixed(1)}</td>
                        <td className="py-2 px-2">{Math.max(...scores).toFixed(1)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      <p className="text-xs text-gray-500 text-right">
        데이터 출처: CNN Business Fear &amp; Greed Index
      </p>
    </div>
  );
}
