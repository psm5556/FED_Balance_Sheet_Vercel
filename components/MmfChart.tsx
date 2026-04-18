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
  x: number;
  y: number;
  point: IciMmfPoint;
  side: 'left' | 'right';
}

export default function MmfChart({ data, height = 280 }: MmfChartProps) {
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
  const innerW = Math.max(10, width - M.left - M.right);
  const innerH = Math.max(10, height - M.top - M.bottom);

  const yMax = Math.max(...sorted.map(d => d.total)) * 1.05;
  const yScale = (v: number) => innerH - (v / yMax) * innerH;

  const n = sorted.length;
  const bandW = innerW / n;
  const barW = Math.max(1, bandW * 0.75);
  const xCenter = (i: number) => (i + 0.5) * bandW;

  // Y axis ticks
  const Y_TICKS = 5;
  const yTickVals = Array.from({ length: Y_TICKS }, (_, i) =>
    (yMax / (Y_TICKS - 1)) * i
  );

  // X axis: show ~7 evenly spaced labels
  const xLabelCount = Math.min(7, n);
  const xLabelStep = Math.max(1, Math.floor(n / xLabelCount));
  const xLabels = sorted
    .map((d, i) => ({ d, i }))
    .filter(({ i }) => i % xLabelStep === 0 || i === n - 1);

  // SVG line path for Total All
  const linePts = sorted.map((d, i) => `${xCenter(i).toFixed(1)},${yScale(d.total).toFixed(1)}`);
  const linePath = `M ${linePts.join(' L ')}`;

  const handleMouseMove = (e: React.MouseEvent<SVGGElement>) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const svgX = e.clientX - rect.left - M.left;
    const idx = Math.max(0, Math.min(n - 1, Math.floor(svgX / bandW)));
    const pt = sorted[idx];
    const side = svgX > innerW / 2 ? 'left' : 'right';
    setTooltip({ x: xCenter(idx) + M.left, y: M.top, point: pt, side });
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', height }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        <g transform={`translate(${M.left},${M.top})`}>

          {/* Grid + Y axis */}
          {yTickVals.map((v, i) => (
            <g key={i} transform={`translate(0,${yScale(v).toFixed(1)})`}>
              <line x1={0} x2={innerW} stroke="rgba(75,75,75,0.35)" strokeWidth={1} />
              <text x={-8} y={4} textAnchor="end" fill="#9ca3af" fontSize={10}>
                {fmtT(v)}
              </text>
            </g>
          ))}

          {/* Stacked bars */}
          {sorted.map((d, i) => {
            const cx = xCenter(i);
            const x = cx - barW / 2;
            const govH = (d.government / yMax) * innerH;
            const primeH = (d.prime / yMax) * innerH;
            const govY = innerH - govH;
            const primeY = govY - primeH;
            return (
              <g key={d.date}>
                <rect x={x} y={govY} width={barW} height={Math.max(0, govH)}
                  fill="rgba(74,222,128,0.65)" />
                <rect x={x} y={primeY} width={barW} height={Math.max(0, primeH)}
                  fill="rgba(251,146,60,0.75)" />
              </g>
            );
          })}

          {/* Total All line — drawn above bars */}
          <path d={linePath} fill="none" stroke="#64b5f6" strokeWidth={2.5} strokeLinejoin="round" />

          {/* Invisible hit areas for tooltip */}
          <rect
            x={0} y={0} width={innerW} height={innerH}
            fill="transparent"
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setTooltip(null)}
          />

          {/* Hover crosshair dot */}
          {tooltip && (() => {
            const idx = sorted.findIndex(d => d.date === tooltip.point.date);
            const cx = xCenter(idx);
            const cy = yScale(tooltip.point.total);
            return (
              <circle cx={cx} cy={cy} r={4} fill="#64b5f6" stroke="#0e1117" strokeWidth={1.5} />
            );
          })()}

          {/* X axis labels */}
          <line x1={0} x2={innerW} y1={innerH} y2={innerH} stroke="#374151" />
          {xLabels.map(({ d, i }) => (
            <text
              key={d.date}
              x={xCenter(i)} y={innerH + 14}
              textAnchor="middle" fill="#9ca3af" fontSize={9}
            >
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
            top: tooltip.y,
            ...(tooltip.side === 'right'
              ? { left: tooltip.x + 10 }
              : { right: width - tooltip.x + 10 }),
            pointerEvents: 'none',
          }}
          className="bg-gray-800 border border-gray-600 rounded p-2 text-xs text-white shadow-lg z-10 min-w-[170px]"
        >
          <div className="text-gray-400 mb-1 font-medium">{fmtDate(tooltip.point.date)}</div>
          <div className="flex justify-between gap-4">
            <span style={{ color: '#64b5f6' }}>Total All</span>
            <span className="font-mono">{fmtT(tooltip.point.total)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span style={{ color: '#4ade80' }}>Government</span>
            <span className="font-mono">{fmtT(tooltip.point.government)}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span style={{ color: '#fb923c' }}>Prime</span>
            <span className="font-mono">{fmtT(tooltip.point.prime)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
