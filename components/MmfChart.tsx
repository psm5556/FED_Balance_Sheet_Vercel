'use client';
import { useRef, useState, useEffect } from 'react';
import type { IciMmfPoint } from '@/lib/types';

interface MmfChartProps {
  data: IciMmfPoint[];
  height?: number;
}

const M = { top: 24, right: 16, bottom: 44, left: 82 };

function fmtT(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}T`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}B`;
  return `$${v.toFixed(0)}M`;
}

function fmtDate(d: string): string {
  const [y, mo, dy] = d.split('-');
  return `${mo}/${dy}/${y.slice(2)}`;
}

interface TooltipState {
  svgX: number;
  point: IciMmfPoint;
  idx: number;
}

export default function MmfChart({ data, height = 300 }: MmfChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(600);
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      setWidth(Math.floor(entries[0].contentRect.width));
    });
    obs.observe(containerRef.current);
    setWidth(containerRef.current.clientWidth || 600);
    return () => obs.disconnect();
  }, []);

  if (!data.length) return null;

  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const n = sorted.length;
  const innerW = Math.max(10, width - M.left - M.right);
  const innerH = Math.max(10, height - M.top - M.bottom);

  const yMax = Math.max(...sorted.map(d => d.total)) * 1.04;
  const yScale = (v: number) => innerH - (v / yMax) * innerH;
  const xOf = (i: number) => (i / (n - 1)) * innerW;

  // ── Stacked area paths ────────────────────────────────────────────────────
  // Government area: 0 → government
  const govTop = sorted.map((d, i) => `${xOf(i).toFixed(1)},${yScale(d.government).toFixed(1)}`);
  const govPath = [
    `M ${xOf(0).toFixed(1)},${yScale(0).toFixed(1)}`,
    ...govTop.map(p => `L ${p}`),
    `L ${xOf(n - 1).toFixed(1)},${yScale(0).toFixed(1)}`,
    'Z',
  ].join(' ');

  // Prime area: government → government + prime (stacked)
  const primeTopPts = sorted.map((d, i) => ({
    x: xOf(i),
    y: yScale(d.government + d.prime),
  }));
  const primeBasePts = sorted.map((d, i) => ({
    x: xOf(i),
    y: yScale(d.government),
  }));
  const primePath = [
    `M ${primeBasePts[0].x.toFixed(1)},${primeBasePts[0].y.toFixed(1)}`,
    ...primeTopPts.map(p => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    ...primeBasePts.slice().reverse().map(p => `L ${p.x.toFixed(1)},${p.y.toFixed(1)}`),
    'Z',
  ].join(' ');

  // Total All line
  const linePath = sorted.map((d, i) =>
    `${i === 0 ? 'M' : 'L'} ${xOf(i).toFixed(1)},${yScale(d.total).toFixed(1)}`
  ).join(' ');

  // ── Y axis ticks ──────────────────────────────────────────────────────────
  const Y_TICKS = 5;
  const yTickVals = Array.from({ length: Y_TICKS }, (_, i) => (yMax / (Y_TICKS - 1)) * i);

  // ── X axis labels ─────────────────────────────────────────────────────────
  const xLabelStep = Math.max(1, Math.floor(n / 7));
  const xLabels = sorted.map((d, i) => ({ d, i })).filter(({ i }) => i % xLabelStep === 0 || i === n - 1);

  // ── Mouse interaction ─────────────────────────────────────────────────────
  const handleMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const svgX = e.clientX - rect.left - M.left;
    const idx = Math.max(0, Math.min(n - 1, Math.round((svgX / innerW) * (n - 1))));
    setTooltip({ svgX, point: sorted[idx], idx });
  };

  const tooltipLeft = tooltip
    ? tooltip.svgX > innerW / 2
      ? undefined
      : tooltip.svgX + M.left + 12
    : undefined;
  const tooltipRight = tooltip
    ? tooltip.svgX > innerW / 2
      ? width - (tooltip.svgX + M.left) + 12
      : undefined
    : undefined;

  return (
    <div ref={containerRef} style={{ position: 'relative', height }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="govGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4ade80" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#4ade80" stopOpacity="0.45" />
          </linearGradient>
          <linearGradient id="primeGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fb923c" stopOpacity="0.80" />
            <stop offset="100%" stopColor="#fb923c" stopOpacity="0.50" />
          </linearGradient>
        </defs>

        <g transform={`translate(${M.left},${M.top})`}>
          {/* Grid + Y axis labels */}
          {yTickVals.map((v, i) => (
            <g key={i} transform={`translate(0,${yScale(v).toFixed(1)})`}>
              <line x1={0} x2={innerW} stroke="rgba(75,75,75,0.35)" strokeWidth={1} />
              <text x={-8} y={4} textAnchor="end" fill="#9ca3af" fontSize={10}>
                {fmtT(v)}
              </text>
            </g>
          ))}

          {/* Stacked areas */}
          <path d={govPath} fill="url(#govGrad)" />
          <path d={primePath} fill="url(#primeGrad)" />

          {/* Total All line */}
          <path d={linePath} fill="none" stroke="#64b5f6" strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />

          {/* Crosshair & dot */}
          {tooltip && (
            <>
              <line
                x1={xOf(tooltip.idx)} x2={xOf(tooltip.idx)}
                y1={0} y2={innerH}
                stroke="rgba(255,255,255,0.2)" strokeWidth={1} strokeDasharray="3,3"
              />
              <circle
                cx={xOf(tooltip.idx)} cy={yScale(tooltip.point.total)}
                r={4} fill="#64b5f6" stroke="#0e1117" strokeWidth={1.5}
              />
            </>
          )}

          {/* Invisible hit area */}
          <rect
            x={0} y={0} width={innerW} height={innerH}
            fill="transparent"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTooltip(null)}
          />

          {/* X axis baseline + labels */}
          <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="#374151" />
          {xLabels.map(({ d, i }) => (
            <text key={d.date} x={xOf(i)} y={innerH + 14}
              textAnchor="middle" fill="#9ca3af" fontSize={9}>
              {fmtDate(d.date)}
            </text>
          ))}
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          style={{
            position: 'absolute',
            top: M.top + 4,
            ...(tooltipLeft !== undefined ? { left: tooltipLeft } : { right: tooltipRight }),
            pointerEvents: 'none',
          }}
          className="bg-gray-800/95 border border-gray-600 rounded p-2.5 text-xs text-white shadow-lg z-10 min-w-[180px]"
        >
          <div className="text-gray-400 mb-1.5 font-medium">{fmtDate(tooltip.point.date)}</div>
          <div className="space-y-1">
            <div className="flex justify-between gap-4">
              <span style={{ color: '#64b5f6' }}>Total All</span>
              <span className="font-mono font-semibold">{fmtT(tooltip.point.total)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span style={{ color: '#4ade80' }}>Government</span>
              <span className="font-mono">{fmtT(tooltip.point.government)}</span>
            </div>
            <div className="flex justify-between gap-4">
              <span style={{ color: '#fb923c' }}>Prime</span>
              <span className="font-mono">{fmtT(tooltip.point.prime)}</span>
            </div>
            <div className="border-t border-gray-600 pt-1 flex justify-between gap-4 text-gray-400">
              <span>Gov %</span>
              <span className="font-mono">{((tooltip.point.government / tooltip.point.total) * 100).toFixed(1)}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
