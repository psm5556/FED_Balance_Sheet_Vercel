import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import useSWR from 'swr';
import clsx from 'clsx';
import PeriodSelector from './PeriodSelector';
import type { FredObservation, BalanceSheetRow, IciMmfResponse } from '@/lib/types';
import { SERIES_INFO, PERIOD_OPTIONS } from '@/lib/constants';
import {
  formatNumber, formatChange, getFredLink, periodDaysAgo, today, quarterLabel,
} from '@/lib/utils';

const TvChart = dynamic(() => import('./TvChart'), { ssr: false });

const fetcher = (url: string) => fetch(url).then(r => r.json());

// ── Series fetch ──────────────────────────────────────────────────────────
function useFredSeries(
  seriesId: string,
  startDate: string,
  endDate: string,
  enabled: boolean,
  limit?: number
) {
  const params = new URLSearchParams({ series_id: seriesId });
  if (limit) {
    params.set('limit', String(limit));
  } else {
    params.set('start_date', startDate);
    params.set('end_date', endDate);
  }
  return useSWR<{ data: FredObservation[] }>(
    enabled ? `/api/fred?${params}` : null,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 1800000 }
  );
}

// ── Balance sheet table ───────────────────────────────────────────────────
function BalanceSheetTable({ rows }: { rows: BalanceSheetRow[] }) {
  const headers = ['분류', '항목', '설명', '현재 날짜', '현재 값', '이전 날짜', '이전 값', '변화', '유동성 영향', '출처'];
  let prevCategory = '';

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-700">
      <table className="w-full text-sm border-collapse min-w-[900px]">
        <thead>
          <tr className="bg-gray-800">
            {headers.map(h => (
              <th key={h} className="px-3 py-3 text-left text-gray-200 font-semibold whitespace-nowrap">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => {
            const isNewCategory = row.category !== prevCategory;
            if (isNewCategory) prevCategory = row.category;
            const changeColor = row.changeNum > 0 ? '#4ade80' : row.changeNum < 0 ? '#f87171' : 'white';
            const liquidityColor =
              row.liquidityImpact.includes('↑') ? '#4ade80' :
              row.liquidityImpact.includes('↓') ? '#f87171' : '#fbbf24';
            const indent = row.name.startsWith('  ㄴ');
            const bgColor = row.highlight ? 'rgba(80,76,0,0.4)' : 'transparent';
            const borderStyle = row.highlight ? '2px solid rgba(255,215,0,0.4)' : 'none';

            return (
              <>
                {isNewCategory && idx > 0 && (
                  <tr key={`sep-${idx}`}>
                    <td colSpan={10} className="h-2 bg-gray-950" />
                  </tr>
                )}
                <tr
                  key={row.name}
                  style={{ backgroundColor: bgColor, outline: borderStyle }}
                  className="border-b border-gray-800 hover:bg-gray-800/40 transition-colors"
                >
                  <td className="px-3 py-2.5 text-gray-400 font-medium text-xs whitespace-nowrap">
                    {row.category}
                  </td>
                  <td className={clsx('px-3 py-2.5 text-white', indent && 'pl-8')}>
                    {row.name.trim()}
                  </td>
                  <td className="px-3 py-2.5 text-gray-300 text-xs">{row.description}</td>
                  <td className="px-3 py-2.5 text-blue-400 text-xs text-center whitespace-nowrap">
                    {row.currentDate}
                  </td>
                  <td className="px-3 py-2.5 text-white text-right font-mono">{row.currentValue}</td>
                  <td className="px-3 py-2.5 text-gray-400 text-xs text-center whitespace-nowrap">
                    {row.prevDate}
                  </td>
                  <td className="px-3 py-2.5 text-white text-right font-mono">{row.prevValue}</td>
                  <td className="px-3 py-2.5 text-right font-bold font-mono" style={{ color: changeColor }}>
                    {row.change}
                  </td>
                  <td className="px-3 py-2.5 text-xs font-medium whitespace-nowrap" style={{ color: liquidityColor }}>
                    {row.liquidityImpact}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {row.seriesId === 'ICI_MMF' ? (
                      <a
                        href="https://www.ici.org/research/stats/mmf"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 text-xs whitespace-nowrap"
                      >
                        🔗 ICI.org
                      </a>
                    ) : (
                      <a
                        href={getFredLink(row.seriesId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300 text-xs whitespace-nowrap"
                      >
                        🔗 {row.seriesId}
                      </a>
                    )}
                  </td>
                </tr>
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────
interface AllSeriesData {
  [name: string]: { summary?: FredObservation[]; chart?: FredObservation[] };
}

export default function BalanceSheetTab() {
  const [periodDays, setPeriodDays] = useState<number | null>(365);
  const startDate = periodDays ? periodDaysAgo(periodDays) : '2006-01-01';
  const endDate = today();

  const [allData, setAllData] = useState<AllSeriesData>({});
  const [loadingCount, setLoadingCount] = useState(0);

  const fetchAll = useCallback(async () => {
    const names = Object.keys(SERIES_INFO);
    setLoadingCount(names.length);
    const results: AllSeriesData = {};

    await Promise.all(
      names.map(async name => {
        const info = SERIES_INFO[name];

        // ── ICI MMF (non-FRED source) ──────────────────────────────────
        if (info.apiSource === 'ici') {
          try {
            const r = await fetch('/api/mmf-ici');
            const json: IciMmfResponse = await r.json();
            if (json.data?.length) {
              // Filter chart data by date range
              const chartData = json.data
                .filter(p => p.date >= startDate && p.date <= endDate)
                .map(p => ({ date: p.date, value: p.value }));
              // Summary: last 10 in descending order
              const summary = [...json.data]
                .sort((a, b) => b.date.localeCompare(a.date))
                .slice(0, 10)
                .map(p => ({ date: p.date, value: p.value }));
              results[name] = { summary, chart: chartData };
            } else {
              results[name] = {};
            }
          } catch {
            results[name] = {};
          }
          setLoadingCount(c => c - 1);
          return;
        }

        // ── Standard FRED fetch ────────────────────────────────────────
        const summaryP = new URLSearchParams({ series_id: info.id, limit: '10' });
        const summaryRes = await fetch(`/api/fred?${summaryP}`);
        const summaryJson = await summaryRes.json();

        let chartData: FredObservation[] | undefined;
        if (info.showChart) {
          const chartP = new URLSearchParams({
            series_id: info.id, start_date: startDate, end_date: endDate,
          });
          const chartRes = await fetch(`/api/fred?${chartP}`);
          const chartJson = await chartRes.json();
          chartData = chartJson.data;
        }

        results[name] = { summary: summaryJson.data, chart: chartData };
        setLoadingCount(c => c - 1);
      })
    );

    setAllData(results);
  }, [startDate, endDate]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Build table rows
  const rows: BalanceSheetRow[] = Object.entries(SERIES_INFO)
    .sort(([, a], [, b]) => a.order - b.order)
    .map(([name, info]) => {
      const data = allData[name]?.summary ?? [];
      if (data.length >= 2) {
        const curr = data[0];
        const prev = data[1];
        const change = curr.value - prev.value;
        const isQ = info.isQuarterly;
        return {
          category: info.category,
          name: isQ ? `${name} 🔶` : name,
          seriesId: info.id,
          description: info.description,
          currentDate: isQ ? quarterLabel(curr.date) : curr.date,
          currentValue: formatNumber(curr.value),
          prevDate: isQ ? quarterLabel(prev.date) : prev.date,
          prevValue: formatNumber(prev.value),
          change: formatChange(change),
          changeNum: change,
          liquidityImpact: info.liquidityImpact,
          highlight: info.highlight,
          order: info.order,
        };
      }
      return {
        category: info.category,
        name: info.isQuarterly ? `${name} 🔶` : name,
        seriesId: info.id,
        description: info.description,
        currentDate: 'N/A', currentValue: 'N/A',
        prevDate: 'N/A', prevValue: 'N/A',
        change: 'N/A', changeNum: 0,
        liquidityImpact: info.liquidityImpact,
        highlight: info.highlight,
        order: info.order,
      };
    });

  const isLoading = loadingCount > 0;

  // Chart names
  const chartEntries = Object.entries(SERIES_INFO).filter(([, info]) => info.showChart);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-4">
        <div>
          <h2 className="text-xl font-bold text-white">Fed Balance Sheet</h2>
          <p className="text-xs text-gray-400 mt-0.5">Weekly Changes · Unit: $M (Millions)</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-gray-400">차트 기간:</span>
          <PeriodSelector
            options={PERIOD_OPTIONS}
            selected={periodDays}
            onChange={setPeriodDays}
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 text-sm text-gray-400">
          <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          데이터 로딩 중… ({loadingCount}개 남음)
        </div>
      )}

      {/* Table */}
      {rows.length > 0 && (
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h3 className="text-base font-semibold text-white">Fed Balance Sheet 데이터</h3>
            <span className="text-xs text-yellow-400">🔶 = 분기별 업데이트</span>
          </div>
          <BalanceSheetTable rows={rows} />
        </div>
      )}

      {/* Trend charts grid */}
      {chartEntries.length > 0 && (
        <div>
          <h3 className="text-base font-semibold text-white mb-3">
            주요 항목 추이
            <span className="text-xs text-gray-400 ml-2 font-normal">
              {startDate} ~ {endDate}
            </span>
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {chartEntries.map(([name, info]) => {
              const raw = allData[name]?.chart ?? [];
              const data = raw
                .slice()
                .sort((a, b) => a.date.localeCompare(b.date))
                .map(d => ({ time: d.date, value: d.value }));

              return (
                <div key={name} className="bg-gray-900 rounded-lg p-4 border border-gray-700">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-medium text-white truncate">{name.trim()}</h4>
                    {info.apiSource === 'ici' ? (
                      <a
                        href="https://www.ici.org/research/stats/mmf"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300 shrink-0 ml-2"
                      >
                        ICI.org ↗
                      </a>
                    ) : (
                      <a
                        href={getFredLink(info.id)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-400 hover:text-blue-300 shrink-0 ml-2"
                      >
                        {info.id} ↗
                      </a>
                    )}
                  </div>
                  {data.length > 0 ? (
                    <TvChart
                      series={[{
                        type: 'area',
                        data,
                        color: '#64b5f6',
                        topColor: 'rgba(100,181,246,0.25)',
                        bottomColor: 'rgba(100,181,246,0.02)',
                        lineWidth: 2,
                      }]}
                      height={220}
                    />
                  ) : (
                    <div className="h-[220px] flex items-center justify-center text-gray-500 text-sm">
                      {isLoading ? '로딩 중...' : '데이터 없음'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-white mb-2">💰 자산 항목 (Assets)</h4>
          <ul className="text-xs text-gray-300 space-y-1">
            <li><strong className="text-gray-100">총자산</strong>: 연준 대차대조표의 전체 자산 규모</li>
            <li><strong className="text-gray-100">연준 보유 증권</strong>: 국채와 MBS 매입으로 유동성 공급</li>
            <li><strong className="text-gray-100">SRF (상설레포)</strong>: 은행이 담보를 제공하고 연준으로부터 단기 자금 조달</li>
            <li><strong className="text-gray-100">대출</strong>: 연준이 금융기관에 제공하는 긴급 유동성</li>
          </ul>
        </div>
        <div className="bg-gray-900 border border-gray-700 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-white mb-2">💳 부채 항목 (Liabilities)</h4>
          <ul className="text-xs text-gray-300 space-y-1">
            <li><strong className="text-gray-100">지급준비금</strong>: 은행들이 연준에 예치한 초과 준비금</li>
            <li><strong className="text-gray-100">TGA</strong>: 미 재무부가 연준에 보관하는 현금 (증가 시 유동성 ↓)</li>
            <li><strong className="text-gray-100">RRP (역레포)</strong>: MMF 등이 초단기로 연준에 자금 예치 (증가 시 유동성 ↓)</li>
            <li><strong className="text-gray-100">MMF</strong>: 머니마켓펀드 총 자산 규모 <em>(분기별 업데이트)</em></li>
          </ul>
        </div>
      </div>

      <p className="text-xs text-gray-500 text-right">
        데이터 출처: Federal Reserve Economic Data (FRED)
      </p>
    </div>
  );
}
