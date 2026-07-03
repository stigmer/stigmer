"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { ExecutionClientFilters } from "./derive-execution-row.js";

// ---------------------------------------------------------------------------
// Phase chip config
// ---------------------------------------------------------------------------

const PHASE_CHIPS: ReadonlyArray<{ phase: ExecutionPhase; label: string }> = [
  { phase: ExecutionPhase.EXECUTION_COMPLETED, label: "Completed" },
  { phase: ExecutionPhase.EXECUTION_FAILED, label: "Failed" },
  { phase: ExecutionPhase.EXECUTION_IN_PROGRESS, label: "Running" },
  { phase: ExecutionPhase.EXECUTION_PENDING, label: "Pending" },
  { phase: ExecutionPhase.EXECUTION_CANCELLED, label: "Cancelled" },
  { phase: ExecutionPhase.EXECUTION_PAUSED, label: "Paused" },
];

// ---------------------------------------------------------------------------
// Duration preset config
// ---------------------------------------------------------------------------

interface DurationPreset {
  readonly label: string;
  readonly minMs?: number;
  readonly maxMs?: number;
}

const DURATION_PRESETS: readonly DurationPreset[] = [
  { label: "< 1s", maxMs: 1_000 },
  { label: "< 10s", maxMs: 10_000 },
  { label: "< 1m", maxMs: 60_000 },
  { label: "< 10m", maxMs: 600_000 },
  { label: "> 10m", minMs: 600_000 },
];

// ---------------------------------------------------------------------------
// Cost preset config
// ---------------------------------------------------------------------------

interface CostPreset {
  readonly label: string;
  readonly minMicros?: bigint;
  readonly maxMicros?: bigint;
}

const COST_PRESETS: readonly CostPreset[] = [
  { label: "Free", maxMicros: BigInt(0) },
  { label: "< $0.10", maxMicros: BigInt(100_000) },
  { label: "< $1", maxMicros: BigInt(1_000_000) },
  { label: "< $10", maxMicros: BigInt(10_000_000) },
  { label: "> $10", minMicros: BigInt(10_000_000) },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** Props for {@link ExecutionFilterBar}. */
export interface ExecutionFilterBarProps {
  /** Current active filters (controlled). */
  readonly filters: ExecutionClientFilters;
  /** Called when any filter changes. */
  readonly onFiltersChange: (filters: ExecutionClientFilters) => void;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Horizontal filter bar for the execution history table.
 *
 * Renders phase chips, duration presets, cost presets, a "has retries"
 * toggle, and a clear-all button. Each filter maps to an
 * {@link ExecutionClientFilters} field.
 *
 * Fully controlled: the parent owns the filter state.
 *
 * @example
 * ```tsx
 * const [filters, setFilters] = useState<ExecutionClientFilters>({});
 * <ExecutionFilterBar filters={filters} onFiltersChange={setFilters} />
 * ```
 */
export const ExecutionFilterBar = memo(function ExecutionFilterBar({
  filters,
  onFiltersChange,
  className,
}: ExecutionFilterBarProps) {
  const [showMore, setShowMore] = useState(false);

  const activePhases = useMemo(
    () => new Set(filters.phases ?? []),
    [filters.phases],
  );

  const togglePhase = useCallback(
    (phase: ExecutionPhase) => {
      const next = new Set(activePhases);
      if (next.has(phase)) {
        next.delete(phase);
      } else {
        next.add(phase);
      }
      onFiltersChange({
        ...filters,
        phases: next.size > 0 ? [...next] : undefined,
      });
    },
    [activePhases, filters, onFiltersChange],
  );

  const activeDurationIdx = useMemo(() => {
    return DURATION_PRESETS.findIndex(
      (p) =>
        p.minMs === filters.minDurationMs && p.maxMs === filters.maxDurationMs,
    );
  }, [filters.minDurationMs, filters.maxDurationMs]);

  const setDuration = useCallback(
    (idx: number) => {
      if (idx === activeDurationIdx) {
        onFiltersChange({ ...filters, minDurationMs: undefined, maxDurationMs: undefined });
      } else {
        const preset = DURATION_PRESETS[idx];
        onFiltersChange({
          ...filters,
          minDurationMs: preset.minMs,
          maxDurationMs: preset.maxMs,
        });
      }
    },
    [activeDurationIdx, filters, onFiltersChange],
  );

  const activeCostIdx = useMemo(() => {
    return COST_PRESETS.findIndex(
      (p) =>
        p.minMicros === filters.minCostMicros && p.maxMicros === filters.maxCostMicros,
    );
  }, [filters.minCostMicros, filters.maxCostMicros]);

  const setCost = useCallback(
    (idx: number) => {
      if (idx === activeCostIdx) {
        onFiltersChange({ ...filters, minCostMicros: undefined, maxCostMicros: undefined });
      } else {
        const preset = COST_PRESETS[idx];
        onFiltersChange({
          ...filters,
          minCostMicros: preset.minMicros,
          maxCostMicros: preset.maxMicros,
        });
      }
    },
    [activeCostIdx, filters, onFiltersChange],
  );

  const toggleRetries = useCallback(() => {
    onFiltersChange({ ...filters, hasRetries: filters.hasRetries ? undefined : true });
  }, [filters, onFiltersChange]);

  const clearAll = useCallback(() => {
    onFiltersChange({});
  }, [onFiltersChange]);

  const activeCount =
    (activePhases.size > 0 ? 1 : 0) +
    (activeDurationIdx >= 0 ? 1 : 0) +
    (activeCostIdx >= 0 ? 1 : 0) +
    (filters.hasRetries ? 1 : 0) +
    (filters.failedTaskName ? 1 : 0);

  return (
    <div
      role="toolbar"
      aria-label="Execution filters"
      className={cn("flex flex-col gap-2", className)}
    >
      {/* Row 1: Phase chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[11px] font-medium text-[var(--stgm-muted-foreground,#737373)]">
          Status
        </span>
        {PHASE_CHIPS.map(({ phase, label }) => (
          <FilterChip
            key={phase}
            label={label}
            isActive={activePhases.has(phase)}
            onClick={() => togglePhase(phase)}
          />
        ))}

        {!showMore && (
          <button
            type="button"
            onClick={() => setShowMore(true)}
            className="ml-2 text-[11px] font-medium text-[var(--stgm-primary,#6366f1)] hover:underline"
          >
            More filters
          </button>
        )}

        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="ml-auto text-[11px] font-medium text-[var(--stgm-muted-foreground,#737373)] hover:text-[var(--stgm-foreground,#1a1a2e)]"
          >
            Clear all ({activeCount})
          </button>
        )}
      </div>

      {/* Row 2: Additional filters (shown on "More filters") */}
      {showMore && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterGroup label="Duration">
            {DURATION_PRESETS.map((preset, idx) => (
              <FilterChip
                key={preset.label}
                label={preset.label}
                isActive={idx === activeDurationIdx}
                onClick={() => setDuration(idx)}
              />
            ))}
          </FilterGroup>

          <FilterGroup label="Cost">
            {COST_PRESETS.map((preset, idx) => (
              <FilterChip
                key={preset.label}
                label={preset.label}
                isActive={idx === activeCostIdx}
                onClick={() => setCost(idx)}
              />
            ))}
          </FilterGroup>

          <FilterChip
            label="Has retries"
            isActive={!!filters.hasRetries}
            onClick={toggleRetries}
          />
        </div>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function FilterChip({
  label,
  isActive,
  onClick,
}: {
  readonly label: string;
  readonly isActive: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={cn(
        "rounded-full px-2.5 py-0.5 text-[11px] font-medium transition-colors",
        "border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--stgm-ring,#6366f1)]",
        isActive
          ? "border-transparent bg-[var(--stgm-primary,#6366f1)] text-[var(--stgm-primary-foreground,#fff)]"
          : "border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] text-[var(--stgm-foreground,#1a1a2e)] hover:bg-[var(--stgm-accent,#f5f5f5)]",
      )}
    >
      {label}
    </button>
  );
}

function FilterGroup({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="mr-0.5 text-[11px] font-medium text-[var(--stgm-muted-foreground,#737373)]">
        {label}
      </span>
      {children}
    </div>
  );
}
