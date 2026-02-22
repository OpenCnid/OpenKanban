'use client';

export type PipelineFilter = 'all' | 'running' | 'completed' | 'failed';

interface PipelineFiltersProps {
  activeFilter: PipelineFilter;
  onFilterChange: (filter: PipelineFilter) => void;
  counts: Record<PipelineFilter, number>;
}

const filters: { id: PipelineFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'running', label: 'Running' },
  { id: 'completed', label: 'Completed' },
  { id: 'failed', label: 'Failed' },
];

export function PipelineFilters({ activeFilter, onFilterChange, counts }: PipelineFiltersProps) {
  return (
    <div className="flex items-center gap-1">
      {filters.map((filter) => {
        const isActive = activeFilter === filter.id;
        const count = counts[filter.id];
        return (
          <button
            key={filter.id}
            onClick={() => onFilterChange(filter.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium transition-colors ${
              isActive
                ? 'bg-mc-accent/20 text-mc-accent border border-mc-accent/30'
                : 'text-mc-text-secondary hover:text-mc-text hover:bg-mc-bg-tertiary border border-transparent'
            }`}
          >
            {filter.label}
            {count > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                isActive ? 'bg-mc-accent/30' : 'bg-mc-bg-tertiary'
              }`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
