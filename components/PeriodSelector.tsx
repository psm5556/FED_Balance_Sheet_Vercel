import clsx from 'clsx';

interface Period {
  label: string;
  days: number | null;
}

interface PeriodSelectorProps {
  options: Period[];
  selected: number | null;
  onChange: (days: number | null) => void;
  className?: string;
}

export default function PeriodSelector({
  options,
  selected,
  onChange,
  className = '',
}: PeriodSelectorProps) {
  return (
    <div className={clsx('flex flex-wrap gap-1', className)}>
      {options.map(opt => (
        <button
          key={opt.label}
          onClick={() => onChange(opt.days)}
          className={clsx(
            'px-3 py-1 text-sm rounded font-medium transition-colors',
            selected === opt.days
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
