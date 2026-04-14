import clsx from 'clsx';

interface MetricCardProps {
  label: string;
  value: string;
  delta?: string;
  deltaColor?: string;
  description?: string;
  className?: string;
  valueColor?: string;
}

export default function MetricCard({
  label,
  value,
  delta,
  deltaColor,
  description,
  className = '',
  valueColor,
}: MetricCardProps) {
  return (
    <div className={clsx('bg-gray-900 border border-gray-700 rounded-lg p-4', className)}>
      <div className="text-xs text-gray-400 mb-1 truncate">{label}</div>
      <div
        className="text-xl font-bold truncate"
        style={{ color: valueColor ?? 'white' }}
      >
        {value}
      </div>
      {delta && (
        <div className="text-xs mt-1 truncate" style={{ color: deltaColor ?? '#9ca3af' }}>
          {delta}
        </div>
      )}
      {description && (
        <div className="text-xs text-gray-500 mt-1 truncate">{description}</div>
      )}
    </div>
  );
}
