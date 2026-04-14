'use client';
import { useEffect, useRef, useMemo } from 'react';
import {
  createChart,
  ColorType,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type LineSeriesPartialOptions,
  type AreaSeriesPartialOptions,
  type HistogramSeriesPartialOptions,
} from 'lightweight-charts';

export interface PriceLine {
  price: number;
  color: string;
  label?: string;
  style?: 'solid' | 'dashed' | 'dotted';
}

export interface SeriesConfig {
  type: 'line' | 'area' | 'histogram' | 'baseline';
  data: { time: string; value: number }[];
  color?: string;
  lineWidth?: number;
  name?: string;
  priceScaleId?: string;
  topColor?: string;
  bottomColor?: string;
  priceLines?: PriceLine[];
  lastValueVisible?: boolean;
}

interface TvChartProps {
  series: SeriesConfig[];
  height?: number;
  className?: string;
  rightScaleLabel?: string;
  leftScaleLabel?: string;
  rightScaleVisible?: boolean;
  leftScaleVisible?: boolean;
  /** Price band zones: [{y0, y1, color}] rendered as horizontal band */
  bands?: { y0: number; y1: number; color: string }[];
}

const LINE_STYLES: Record<string, number> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
};

export default function TvChart({
  series,
  height = 400,
  className = '',
  rightScaleVisible = true,
  leftScaleVisible = false,
}: TvChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<'Line' | 'Area' | 'Histogram' | 'Baseline'>[]>([]);

  // stable series identity by JSON - avoids unnecessary re-renders
  const seriesKey = useMemo(() => JSON.stringify(series.map(s => ({
    type: s.type, len: s.data.length, color: s.color, scaleId: s.priceScaleId,
  }))), [series]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0e1117' },
        textColor: '#d1d5db',
        fontSize: 12,
      },
      grid: {
        vertLines: { color: 'rgba(75,75,75,0.3)' },
        horzLines: { color: 'rgba(75,75,75,0.3)' },
      },
      rightPriceScale: {
        visible: rightScaleVisible,
        borderColor: '#374151',
      },
      leftPriceScale: {
        visible: leftScaleVisible,
        borderColor: '#374151',
      },
      timeScale: {
        borderColor: '#374151',
        timeVisible: false,
      },
      crosshair: { mode: 1 },
      width: containerRef.current.clientWidth,
      height,
    });

    chartRef.current = chart;

    // Handle resize
    const observer = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({ width: containerRef.current.clientWidth });
      }
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRefs.current = [];
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [height, rightScaleVisible, leftScaleVisible]);

  // Update series data when it changes
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Remove old series
    for (const s of seriesRefs.current) {
      try { chart.removeSeries(s); } catch { /* ignore */ }
    }
    seriesRefs.current = [];

    for (const cfg of series) {
      const sorted = [...cfg.data].sort((a, b) => a.time.localeCompare(b.time));
      const tvData = sorted.map(p => ({ time: p.time as Time, value: p.value }));

      let s: ISeriesApi<'Line' | 'Area' | 'Histogram' | 'Baseline'>;

      const scaleId = cfg.priceScaleId ?? 'right';

      if (cfg.type === 'area') {
        const opts: AreaSeriesPartialOptions = {
          lineColor: cfg.color ?? '#60a5fa',
          topColor: cfg.topColor ?? (cfg.color ? `${cfg.color}40` : 'rgba(96,165,250,0.25)'),
          bottomColor: cfg.bottomColor ?? 'rgba(96,165,250,0.02)',
          lineWidth: (cfg.lineWidth ?? 2) as 1 | 2 | 3 | 4,
          priceScaleId: scaleId,
          lastValueVisible: cfg.lastValueVisible ?? true,
        };
        s = chart.addAreaSeries(opts);
      } else if (cfg.type === 'histogram') {
        const opts: HistogramSeriesPartialOptions = {
          color: cfg.color ?? '#26a69a',
          priceScaleId: scaleId,
          lastValueVisible: cfg.lastValueVisible ?? true,
        };
        s = chart.addHistogramSeries(opts);
      } else if (cfg.type === 'baseline') {
        s = chart.addBaselineSeries({
          baseValue: { type: 'price', price: 0 },
          topLineColor: '#22c55e',
          topFillColor1: 'rgba(34,197,94,0.2)',
          topFillColor2: 'rgba(34,197,94,0.0)',
          bottomLineColor: '#ef4444',
          bottomFillColor1: 'rgba(239,68,68,0.0)',
          bottomFillColor2: 'rgba(239,68,68,0.2)',
          priceScaleId: scaleId,
          lastValueVisible: cfg.lastValueVisible ?? true,
        });
      } else {
        // line
        const opts: LineSeriesPartialOptions = {
          color: cfg.color ?? '#60a5fa',
          lineWidth: (cfg.lineWidth ?? 2) as 1 | 2 | 3 | 4,
          priceScaleId: scaleId,
          lastValueVisible: cfg.lastValueVisible ?? true,
        };
        s = chart.addLineSeries(opts);
      }

      s.setData(tvData);

      // Add price lines
      if (cfg.priceLines) {
        for (const pl of cfg.priceLines) {
          s.createPriceLine({
            price: pl.price,
            color: pl.color,
            lineWidth: 1,
            lineStyle: LINE_STYLES[pl.style ?? 'dashed'],
            axisLabelVisible: true,
            title: pl.label ?? '',
          });
        }
      }

      seriesRefs.current.push(s);
    }

    if (seriesRefs.current.length > 0) {
      chart.timeScale().fitContent();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seriesKey]);

  return <div ref={containerRef} className={className} style={{ height }} />;
}
