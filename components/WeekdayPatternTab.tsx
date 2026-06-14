import { useState, useMemo } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import PeriodSelector from './PeriodSelector';
import { INDEX_GROUPS, ALL_INDEX_OPTIONS, FG_PERIOD_OPTIONS } from '@/lib/constants';
import type { FgHistoryResponse } from '@/lib/types';

const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReturnPoint {
  date: string;
  weekday: number;
  ret: number;
}

interface WeekdayStat {
  weekday: number;
  count: number;
  avg: number;
  stddev: number;
  winRate: number;
}

interface PairStat {
  total: number;
  downPrev: { count: number; nextWinRate: number; nextAvg: number };
  upPrev: { count: number; nextWinRate: number; nextAvg: number };
}

interface TripletCell {
  count: number;
  monWinRate: number;
  monAvg: number;
}

interface TripletStat {
  thuDown_friDown: TripletCell;
  thuDown_friUp:   TripletCell;
  thuUp_friDown:   TripletCell;
  thuUp_friUp:     TripletCell;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const WEEKDAYS = [1, 2, 3, 4, 5] as const;
const WEEKDAY_LABELS: Record<number, string> = { 1:'월', 2:'화', 3:'수', 4:'목', 5:'금' };
const WEEKDAY_FULL:   Record<number, string> = { 1:'월요일', 2:'화요일', 3:'수요일', 4:'목요일', 5:'금요일' };

const PAIRS: { from: number; to: number; highlight?: boolean }[] = [
  { from: 1, to: 2 },
  { from: 2, to: 3 },
  { from: 3, to: 4 },
  { from: 4, to: 5, highlight: true },
  { from: 5, to: 1, highlight: true },
];

// ── Stats helpers ─────────────────────────────────────────────────────────────

function getWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}

function computeReturns(prices: { date: string; close: number }[]): ReturnPoint[] {
  if (prices.length < 2) return [];
  return prices.slice(1).map((p, i) => ({
    date: p.date,
    weekday: getWeekday(p.date),
    ret: (p.close - prices[i].close) / prices[i].close,
  }));
}

function computeWeekdayStats(returns: ReturnPoint[]): Record<number, WeekdayStat> {
  const acc: Record<number, { sumR: number; sumR2: number; up: number; n: number }> = {};
  WEEKDAYS.forEach(wd => { acc[wd] = { sumR: 0, sumR2: 0, up: 0, n: 0 }; });

  for (const r of returns) {
    if (!(r.weekday in acc)) continue;
    acc[r.weekday].n++;
    acc[r.weekday].sumR += r.ret;
    acc[r.weekday].sumR2 += r.ret * r.ret;
    if (r.ret >= 0) acc[r.weekday].up++;
  }

  const result: Record<number, WeekdayStat> = {};
  WEEKDAYS.forEach(wd => {
    const { n, sumR, sumR2, up } = acc[wd];
    const avg = n > 0 ? sumR / n : 0;
    const variance = n > 1 ? (sumR2 - n * avg * avg) / (n - 1) : 0;
    result[wd] = { weekday: wd, count: n, avg, stddev: Math.sqrt(Math.max(0, variance)), winRate: n > 0 ? up / n : 0 };
  });
  return result;
}

function computePairStat(returns: ReturnPoint[], fromWd: number, toWd: number): PairStat {
  const downPrevRets: number[] = [];
  const upPrevRets: number[] = [];

  for (let i = 1; i < returns.length; i++) {
    if (returns[i].weekday === toWd && returns[i - 1].weekday === fromWd) {
      (returns[i - 1].ret < 0 ? downPrevRets : upPrevRets).push(returns[i].ret);
    }
  }

  const avgOf = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const winOf = (arr: number[]) => arr.length > 0 ? arr.filter(v => v >= 0).length / arr.length : 0;

  return {
    total: downPrevRets.length + upPrevRets.length,
    downPrev: { count: downPrevRets.length, nextWinRate: winOf(downPrevRets), nextAvg: avgOf(downPrevRets) },
    upPrev:   { count: upPrevRets.length,   nextWinRate: winOf(upPrevRets),   nextAvg: avgOf(upPrevRets) },
  };
}

function computeThuFriMon(returns: ReturnPoint[]): TripletStat {
  type Key = keyof TripletStat;
  const acc: Record<Key, { n: number; monRets: number[] }> = {
    thuDown_friDown: { n: 0, monRets: [] },
    thuDown_friUp:   { n: 0, monRets: [] },
    thuUp_friDown:   { n: 0, monRets: [] },
    thuUp_friUp:     { n: 0, monRets: [] },
  };

  for (let i = 1; i < returns.length - 1; i++) {
    if (returns[i].weekday === 5 && returns[i - 1].weekday === 4 && returns[i + 1].weekday === 1) {
      const key: Key = `${returns[i - 1].ret < 0 ? 'thuDown' : 'thuUp'}_${returns[i].ret < 0 ? 'friDown' : 'friUp'}`;
      acc[key].n++;
      acc[key].monRets.push(returns[i + 1].ret);
    }
  }

  const toCell = ({ n, monRets }: { n: number; monRets: number[] }): TripletCell => ({
    count: n,
    monWinRate: n > 0 ? monRets.filter(r => r >= 0).length / n : 0,
    monAvg:     n > 0 ? monRets.reduce((s, r) => s + r, 0) / n : 0,
  });

  return {
    thuDown_friDown: toCell(acc.thuDown_friDown),
    thuDown_friUp:   toCell(acc.thuDown_friUp),
    thuUp_friDown:   toCell(acc.thuUp_friDown),
    thuUp_friUp:     toCell(acc.thuUp_friUp),
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

const pct  = (v: number, d = 2) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;
const winP = (v: number)        => `${(v * 100).toFixed(1)}%`;

// ── Component ─────────────────────────────────────────────────────────────────

export default function WeekdayPatternTab() {
  const [periodDays, setPeriodDays]   = useState<number | null>(1825);
  const [selectedIndex, setSelectedIndex] = useState<string>('SP500');

  const { data: histData, isLoading: histLoading } = useSWR<FgHistoryResponse>(
    '/api/fear-greed-history', fetcher,
    { revalidateOnFocus: false, dedupingInterval: 1800000 }
  );

  const yahooTicker = selectedIndex !== 'SP500' ? selectedIndex : null;
  const { data: yahooData, isLoading: yahooLoading } = useSWR<{ data: { date: string; close: number }[] }>(
    yahooTicker ? `/api/yahoo-chart?ticker=${yahooTicker}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 1800000 }
  );

  const isLoading = histLoading || (yahooTicker !== null && yahooLoading);

  const priceData = useMemo<{ date: string; close: number }[]>(() => {
    let raw: { date: string; close: number }[] = [];
    if (selectedIndex === 'SP500' && histData?.sp500) {
      raw = histData.sp500.map(p => ({ date: p.date, close: p.price }));
    } else if (yahooData?.data) {
      raw = yahooData.data;
    }
    if (periodDays !== null) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - periodDays);
      raw = raw.filter(p => new Date(p.date) >= cutoff);
    }
    return [...raw].sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedIndex, histData, yahooData, periodDays]);

  const returns      = useMemo(() => computeReturns(priceData), [priceData]);
  const wdStats      = useMemo(() => computeWeekdayStats(returns), [returns]);
  const pairStats    = useMemo<Record<string, PairStat>>(() => {
    const r: Record<string, PairStat> = {};
    for (const { from, to } of PAIRS) r[`${from}-${to}`] = computePairStat(returns, from, to);
    return r;
  }, [returns]);
  const thuFriMon    = useMemo(() => computeThuFriMon(returns), [returns]);

  const selectedMeta = ALL_INDEX_OPTIONS.find(o => o.key === selectedIndex) ?? null;
  const maxAbsAvg    = useMemo(
    () => Math.max(...WEEKDAYS.map(wd => Math.abs(wdStats[wd]?.avg ?? 0)), 0.0001),
    [wdStats]
  );

  if (isLoading && priceData.length === 0) {
    return <div className="flex items-center justify-center h-64 text-gray-400 text-sm">데이터 로딩 중...</div>;
  }

  return (
    <div className="space-y-6">

      {/* ── Controls ──────────────────────────────────────────────── */}
      <div className="space-y-3">
        <PeriodSelector options={FG_PERIOD_OPTIONS} selected={periodDays} onChange={setPeriodDays} />

        <div className="bg-gray-900/60 rounded-lg border border-gray-800 p-3 space-y-2">
          <span className="text-xs font-medium text-gray-400">자산 선택</span>
          {INDEX_GROUPS.map(({ group, items }) => (
            <div key={group} className="flex items-start gap-2">
              <span className="text-xs text-gray-600 w-10 shrink-0 pt-1">{group}</span>
              <div className="flex flex-wrap gap-1">
                {items.map(opt => {
                  const isSel = selectedIndex === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => setSelectedIndex(opt.key)}
                      title={opt.title}
                      className={clsx(
                        'px-2.5 py-0.5 text-xs rounded font-medium border transition-all whitespace-nowrap',
                        isSel
                          ? 'text-white border-transparent'
                          : 'bg-gray-800 text-gray-400 border-gray-700 hover:text-gray-200 hover:border-gray-500'
                      )}
                      style={isSel ? { backgroundColor: opt.color + '33', borderColor: opt.color + '99', color: opt.color } : undefined}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {returns.length === 0 ? (
        <div className="text-gray-500 text-sm text-center py-12">데이터가 없습니다</div>
      ) : (
        <>
          {/* ── Section 1: Weekday Stats ───────────────────────────── */}
          <section className="bg-gray-900/40 rounded-xl border border-gray-800 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-200">
              요일별 수익률 통계
              <span className="ml-2 text-xs text-gray-500 font-normal">
                {selectedMeta?.title ?? 'S&P 500'} · {returns.length.toLocaleString()}거래일
              </span>
            </h3>

            {/* Diverging bar chart */}
            <div className="space-y-2.5">
              {WEEKDAYS.map(wd => {
                const stat = wdStats[wd];
                if (!stat) return null;
                const barW = (Math.abs(stat.avg) / maxAbsAvg) * 44;
                const isPos = stat.avg >= 0;
                return (
                  <div key={wd} className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 w-6 text-right shrink-0">{WEEKDAY_LABELS[wd]}</span>
                    <div className="flex-1 flex items-center">
                      {/* Left (negative) side */}
                      <div className="flex-1 flex justify-end pr-px">
                        {!isPos && (
                          <div className="h-5 rounded-l bg-red-500/70" style={{ width: `${barW}%` }} />
                        )}
                      </div>
                      {/* Center line */}
                      <div className="w-px h-6 bg-gray-600 shrink-0" />
                      {/* Right (positive) side */}
                      <div className="flex-1 pl-px">
                        {isPos && (
                          <div className="h-5 rounded-r bg-green-500/70" style={{ width: `${barW}%` }} />
                        )}
                      </div>
                    </div>
                    <span className={clsx('text-xs font-mono w-16 text-right shrink-0', isPos ? 'text-green-400' : 'text-red-400')}>
                      {pct(stat.avg)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Stats table */}
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-500 border-b border-gray-800">
                    <th className="text-left py-2 font-medium">요일</th>
                    <th className="text-right py-2 font-medium">평균 수익</th>
                    <th className="text-right py-2 font-medium">표준편차</th>
                    <th className="text-right py-2 font-medium">상승 확률</th>
                    <th className="text-right py-2 font-medium">샘플 수</th>
                  </tr>
                </thead>
                <tbody>
                  {WEEKDAYS.map(wd => {
                    const stat = wdStats[wd];
                    if (!stat) return null;
                    return (
                      <tr key={wd} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className="py-2 font-medium text-gray-200">{WEEKDAY_FULL[wd]}</td>
                        <td className={clsx('py-2 text-right font-mono', stat.avg >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {pct(stat.avg)}
                        </td>
                        <td className="py-2 text-right font-mono text-gray-500">±{pct(stat.stddev)}</td>
                        <td className="py-2 text-right font-mono text-gray-300">{winP(stat.winRate)}</td>
                        <td className="py-2 text-right text-gray-500">{stat.count.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          {/* ── Section 2: Consecutive Day Pairs ──────────────────── */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-gray-200">
              연속 요일 조건부 분석
              <span className="ml-2 text-xs text-gray-500 font-normal">오늘 방향에 따른 내일 수익률</span>
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {PAIRS.map(({ from, to, highlight }) => {
                const stat = pairStats[`${from}-${to}`];
                if (!stat) return null;
                return (
                  <div
                    key={`${from}-${to}`}
                    className={clsx(
                      'rounded-lg border p-3 space-y-3',
                      highlight
                        ? 'border-yellow-600/50 bg-yellow-900/10'
                        : 'border-gray-800 bg-gray-900/40'
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-xs font-semibold text-gray-200">
                        {WEEKDAY_LABELS[from]} → {WEEKDAY_LABELS[to]}
                      </span>
                      {highlight && (
                        <span className="text-[10px] bg-yellow-700/40 text-yellow-300 px-1.5 py-0.5 rounded shrink-0">핵심</span>
                      )}
                    </div>

                    {/* When prev day was down */}
                    <div className="space-y-1">
                      <div className="text-[10px] text-red-400 font-medium">
                        {WEEKDAY_LABELS[from]} 하락 ({stat.downPrev.count}건)
                      </div>
                      <div className="text-xs text-gray-300">
                        상승 확률{' '}
                        <span className={clsx('font-mono font-semibold', stat.downPrev.nextWinRate >= 0.5 ? 'text-green-400' : 'text-red-400')}>
                          {winP(stat.downPrev.nextWinRate)}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        평균{' '}
                        <span className={clsx('font-mono', stat.downPrev.nextAvg >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {pct(stat.downPrev.nextAvg)}
                        </span>
                      </div>
                    </div>

                    <div className="border-t border-gray-700/50" />

                    {/* When prev day was up */}
                    <div className="space-y-1">
                      <div className="text-[10px] text-green-400 font-medium">
                        {WEEKDAY_LABELS[from]} 상승 ({stat.upPrev.count}건)
                      </div>
                      <div className="text-xs text-gray-300">
                        상승 확률{' '}
                        <span className={clsx('font-mono font-semibold', stat.upPrev.nextWinRate >= 0.5 ? 'text-green-400' : 'text-red-400')}>
                          {winP(stat.upPrev.nextWinRate)}
                        </span>
                      </div>
                      <div className="text-[11px] text-gray-500">
                        평균{' '}
                        <span className={clsx('font-mono', stat.upPrev.nextAvg >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {pct(stat.upPrev.nextAvg)}
                        </span>
                      </div>
                    </div>

                    <div className="text-[10px] text-gray-700 text-right">전체 {stat.total}건</div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* ── Section 3: Thu / Fri / Mon 3-day Pattern ──────────── */}
          <section className="bg-gray-900/40 rounded-xl border border-gray-800 p-4 space-y-4">
            <h3 className="text-sm font-semibold text-gray-200">
              목/금/월요일 3일 패턴
              <span className="ml-2 text-xs text-gray-500 font-normal">목요일+금요일 방향 → 다음 월요일 결과</span>
            </h3>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-600 border-b border-gray-700">
                    <th className="text-center py-2 px-4 font-medium">목요일</th>
                    <th className="text-center py-2 px-4 font-medium">금요일</th>
                    <th className="text-center py-2 px-4 font-medium">월 상승 확률</th>
                    <th className="text-center py-2 px-4 font-medium">월 평균 수익</th>
                    <th className="text-center py-2 px-4 font-medium">샘플 수</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      { key: 'thuDown_friDown' as keyof TripletStat, thuLabel: '하락↓', friLabel: '하락↓', thuCls: 'text-red-400',   friCls: 'text-red-400'   },
                      { key: 'thuDown_friUp'   as keyof TripletStat, thuLabel: '하락↓', friLabel: '상승↑', thuCls: 'text-red-400',   friCls: 'text-green-400' },
                      { key: 'thuUp_friDown'   as keyof TripletStat, thuLabel: '상승↑', friLabel: '하락↓', thuCls: 'text-green-400', friCls: 'text-red-400'   },
                      { key: 'thuUp_friUp'     as keyof TripletStat, thuLabel: '상승↑', friLabel: '상승↑', thuCls: 'text-green-400', friCls: 'text-green-400' },
                    ]
                  ).map(({ key, thuLabel, friLabel, thuCls, friCls }) => {
                    const cell = thuFriMon[key];
                    const hi = cell.monWinRate >= 0.55;
                    const lo = cell.monWinRate < 0.45;
                    return (
                      <tr key={key} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                        <td className={clsx('py-3 px-4 text-center font-semibold', thuCls)}>{thuLabel}</td>
                        <td className={clsx('py-3 px-4 text-center font-semibold', friCls)}>{friLabel}</td>
                        <td className="py-3 px-4 text-center">
                          <span className={clsx('font-mono font-bold text-sm', hi ? 'text-green-400' : lo ? 'text-red-400' : 'text-gray-300')}>
                            {winP(cell.monWinRate)}
                          </span>
                        </td>
                        <td className={clsx('py-3 px-4 text-center font-mono', cell.monAvg >= 0 ? 'text-green-400' : 'text-red-400')}>
                          {pct(cell.monAvg)}
                        </td>
                        <td className="py-3 px-4 text-center text-gray-500">{cell.count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Key insight */}
            {thuFriMon.thuDown_friDown.count >= 5 && (() => {
              const cell = thuFriMon.thuDown_friDown;
              return (
                <p className="text-xs text-gray-500 border-t border-gray-800 pt-3">
                  💡 목요일 하락 + 금요일 하락 시, 다음 월요일은{' '}
                  <span className={clsx('font-semibold', cell.monWinRate >= 0.5 ? 'text-green-400' : 'text-red-400')}>
                    {winP(cell.monWinRate)}
                  </span>{' '}
                  확률로 상승 (평균{' '}
                  <span className={clsx('font-mono', cell.monAvg >= 0 ? 'text-green-400' : 'text-red-400')}>
                    {pct(cell.monAvg)}
                  </span>
                  , {cell.count}건)
                </p>
              );
            })()}
          </section>
        </>
      )}

      {priceData.length > 0 && (
        <div className="text-xs text-gray-600 text-right">
          {priceData[0]?.date} ~ {priceData[priceData.length - 1]?.date} · {returns.length.toLocaleString()}거래일
        </div>
      )}
    </div>
  );
}
