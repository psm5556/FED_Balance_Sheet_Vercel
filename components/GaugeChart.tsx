interface ColorStop {
  from: number;
  to: number;
  color: string;
  label?: string;
}

interface GaugeChartProps {
  value: number;
  min?: number;
  max?: number;
  colorStops: ColorStop[];
  title?: string;
  subtitle?: string;
  size?: number;
}

function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function describeArc(cx: number, cy: number, r: number, startDeg: number, endDeg: number) {
  const start = polarToXY(cx, cy, r, startDeg);
  const end = polarToXY(cx, cy, r, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

// Gauge spans from -135° to +135° (270° total)
const START_DEG = -135;
const END_DEG = 135;
const TOTAL_DEG = END_DEG - START_DEG;

export default function GaugeChart({
  value,
  min = 0,
  max = 100,
  colorStops,
  title,
  subtitle,
  size = 220,
}: GaugeChartProps) {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.42;
  const innerR = size * 0.30;
  const needleR = size * 0.38;

  const range = max - min;

  // Needle angle
  const pct = Math.max(0, Math.min(1, (value - min) / range));
  const needleAngle = START_DEG + pct * TOTAL_DEG;
  const needleTip = polarToXY(cx, cy, needleR, needleAngle);
  const needleLeft = polarToXY(cx, cy, size * 0.04, needleAngle - 90);
  const needleRight = polarToXY(cx, cy, size * 0.04, needleAngle + 90);

  // Active color
  const activeStop = colorStops.find(s => value >= s.from && value < s.to)
    ?? colorStops[colorStops.length - 1];

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.7}`}>
        {/* Background track */}
        <path
          d={describeArc(cx, cy, (outerR + innerR) / 2, START_DEG, END_DEG)}
          fill="none"
          stroke="#1e1e2e"
          strokeWidth={outerR - innerR}
          strokeLinecap="butt"
        />

        {/* Colored segments */}
        {colorStops.map((stop, i) => {
          const segStart = START_DEG + ((stop.from - min) / range) * TOTAL_DEG;
          const segEnd   = START_DEG + ((Math.min(stop.to, max) - min) / range) * TOTAL_DEG;
          return (
            <path
              key={i}
              d={describeArc(cx, cy, (outerR + innerR) / 2, segStart, segEnd)}
              fill="none"
              stroke={stop.color}
              strokeWidth={outerR - innerR}
              strokeLinecap="butt"
              opacity={0.35}
            />
          );
        })}

        {/* Active segment (full opacity) */}
        {(() => {
          const segStart = START_DEG + ((activeStop.from - min) / range) * TOTAL_DEG;
          const segEnd   = START_DEG + ((Math.min(activeStop.to, max) - min) / range) * TOTAL_DEG;
          return (
            <path
              d={describeArc(cx, cy, (outerR + innerR) / 2, segStart, segEnd)}
              fill="none"
              stroke={activeStop.color}
              strokeWidth={outerR - innerR}
              strokeLinecap="butt"
            />
          );
        })()}

        {/* Needle */}
        <polygon
          points={`${needleTip.x},${needleTip.y} ${needleLeft.x},${needleLeft.y} ${needleRight.x},${needleRight.y}`}
          fill={activeStop.color}
          opacity={0.95}
        />
        <circle cx={cx} cy={cy} r={size * 0.045} fill={activeStop.color} />

        {/* Center value */}
        <text
          x={cx}
          y={cy * 0.85}
          textAnchor="middle"
          fill="white"
          fontSize={size * 0.14}
          fontWeight="bold"
          fontFamily="system-ui, sans-serif"
        >
          {value.toFixed(1)}
        </text>
      </svg>

      {title && (
        <div className="text-center mt-1">
          <div className="text-sm font-semibold" style={{ color: activeStop.color }}>
            {title}
          </div>
          {subtitle && (
            <div className="text-xs text-gray-400 mt-0.5">{subtitle}</div>
          )}
        </div>
      )}
    </div>
  );
}
