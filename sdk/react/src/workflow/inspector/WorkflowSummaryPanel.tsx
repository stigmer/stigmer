"use client";

import { memo, useMemo, useState, useCallback } from "react";
import { cn } from "@stigmer/theme";
import type { WorkflowGraphModel, WorkflowGraphBudget, WorkflowGraphEnvVar } from "../workflow-graph-model.js";
import { START_NODE_ID, END_NODE_ID } from "../workflow-graph-model.js";
import { CATEGORY_DISPLAY_NAMES } from "../canvas-constants.js";
import type { TopologyNodeCategory } from "../useWorkflowTopology.js";
import { TruncatedText } from "../../internal/truncated-text.js";

/** Props for {@link WorkflowSummaryPanel}. */
export interface WorkflowSummaryPanelProps {
  /** The current workflow graph model. */
  readonly graph: WorkflowGraphModel;
  /** Validation errors keyed by node ID. */
  readonly validationErrors?: ReadonlyMap<string, readonly string[]>;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * Workflow-level summary shown when no task or edge is selected.
 *
 * Displays workflow identity, environment variables, budget settings,
 * validation issues, and task distribution statistics.
 *
 * @since T10 (Inspector Panel Refactor)
 */
export const WorkflowSummaryPanel = memo(function WorkflowSummaryPanel({
  graph,
  validationErrors,
  className,
}: WorkflowSummaryPanelProps) {
  const { doc } = useMemo(() => ({ doc: graph.document }), [graph.document]);

  const stats = useMemo(() => {
    const tasks = graph.nodes.filter(
      (n) => n.id !== START_NODE_ID && n.id !== END_NODE_ID,
    );
    const byCategory = new Map<TopologyNodeCategory, number>();
    for (const node of tasks) {
      byCategory.set(node.category, (byCategory.get(node.category) ?? 0) + 1);
    }
    return { taskCount: tasks.length, byCategory };
  }, [graph.nodes]);

  const envEntries = useMemo(
    () => (graph.env ? Object.entries(graph.env) : []),
    [graph.env],
  );

  const totalErrors = useMemo(() => {
    if (!validationErrors) return 0;
    let count = 0;
    for (const errors of validationErrors.values()) count += errors.length;
    return count;
  }, [validationErrors]);

  return (
    <div className={cn("stg:flex stg:h-full stg:flex-col stg:overflow-y-auto", className)}>
      {/* Workflow identity */}
      <section className="stg:flex stg:flex-col stg:gap-1.5 stg:px-3 stg:py-3">
        <SectionHeader>Workflow</SectionHeader>
        <h3 className="stg:text-sm stg:font-semibold stg:text-[var(--stgm-foreground,#1a1a2e)]">
          {doc.name}
        </h3>
        <div className="stg:flex stg:flex-wrap stg:gap-1.5 stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)]">
          <span>{doc.namespace}</span>
          <span>·</span>
          <span>v{doc.version}</span>
          <span>·</span>
          <span>DSL {doc.dsl}</span>
        </div>
        {doc.description && (
          <p className="stg:text-xs stg:leading-relaxed stg:text-[var(--stgm-muted-foreground,#737373)]">
            {doc.description}
          </p>
        )}
      </section>

      {/* Validation issues */}
      {totalErrors > 0 && validationErrors && (
        <section className="stg:border-t stg:border-[var(--stgm-border,#e5e5e5)] stg:px-3 stg:py-3">
          <ValidationSection errors={validationErrors} totalCount={totalErrors} />
        </section>
      )}

      {/* Task statistics */}
      <section className="stg:border-t stg:border-[var(--stgm-border,#e5e5e5)] stg:px-3 stg:py-3">
        <SectionHeader>Tasks</SectionHeader>
        <div className="stg:mt-1 stg:flex stg:flex-col stg:gap-1">
          <span className="stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)]">
            {stats.taskCount} task{stats.taskCount !== 1 ? "s" : ""}
          </span>
          {stats.byCategory.size > 0 && (
            <div className="stg:flex stg:flex-wrap stg:gap-1.5">
              {Array.from(stats.byCategory.entries()).map(([cat, count]) => (
                <span
                  key={cat}
                  className="stg:rounded stg:bg-[var(--stgm-muted,#f5f5f5)] stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)]"
                >
                  {CATEGORY_DISPLAY_NAMES[cat as keyof typeof CATEGORY_DISPLAY_NAMES] ?? cat} ({count})
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Environment variables */}
      {envEntries.length > 0 && (
        <section className="stg:border-t stg:border-[var(--stgm-border,#e5e5e5)] stg:px-3 stg:py-3">
          <EnvVarsSection entries={envEntries} />
        </section>
      )}

      {/* Budget */}
      {graph.budget && (
        <section className="stg:border-t stg:border-[var(--stgm-border,#e5e5e5)] stg:px-3 stg:py-3">
          <BudgetSection budget={graph.budget} />
        </section>
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function ValidationSection({
  errors,
  totalCount,
}: {
  errors: ReadonlyMap<string, readonly string[]>;
  totalCount: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <div className="stg:flex stg:flex-col stg:gap-1.5">
      <button
        type="button"
        onClick={toggle}
        className="stg:flex stg:items-center stg:gap-1.5 stg:text-left"
        aria-expanded={expanded}
      >
        <SectionHeader>
          Validation
        </SectionHeader>
        <span className="stg:rounded-full stg:bg-[var(--stgm-destructive,#ef4444)]/10 stg:px-1.5 stg:py-0.5 stg:text-[10px] stg:font-medium stg:text-[var(--stgm-destructive,#ef4444)]">
          {totalCount} issue{totalCount !== 1 ? "s" : ""}
        </span>
      </button>

      {expanded && (
        <ul className="stg:flex stg:flex-col stg:gap-1" role="list">
          {Array.from(errors.entries()).map(([nodeId, nodeErrors]) =>
            nodeErrors.map((error, i) => (
              <li
                key={`${nodeId}-${i}`}
                className="stg:flex stg:items-start stg:gap-1.5 stg:text-[11px]"
              >
                <span className="stg:shrink-0 stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]">
                  {nodeId}:
                </span>
                <span className="stg:text-[var(--stgm-destructive,#ef4444)]">{error}</span>
              </li>
            )),
          )}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Environment variables
// ---------------------------------------------------------------------------

function EnvVarsSection({
  entries,
}: {
  entries: [string, WorkflowGraphEnvVar][];
}) {
  return (
    <div className="stg:flex stg:flex-col stg:gap-1.5">
      <SectionHeader>Environment variables</SectionHeader>
      <div className="stg:flex stg:flex-col stg:gap-1">
        {entries.map(([name, env]) => (
          <div key={name} className="stg:flex stg:items-baseline stg:gap-2 stg:text-[11px]">
            <span className="stg:shrink-0 stg:font-mono stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]">
              {name}
            </span>
            {env.isSecret && (
              <span className="stg:rounded stg:bg-[var(--stgm-warning,#f59e0b)]/10 stg:px-1 stg:text-[9px] stg:font-medium stg:text-[var(--stgm-warning,#f59e0b)]">
                secret
              </span>
            )}
            {env.optional && (
              <span className="stg:text-[var(--stgm-muted-foreground,#737373)]">optional</span>
            )}
            {env.description && (
              <TruncatedText
                text={env.description}
                className="stg:text-[var(--stgm-muted-foreground,#737373)]"
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

function BudgetSection({ budget }: { budget: WorkflowGraphBudget }) {
  const items: { label: string; value: string }[] = [];

  if (budget.maxCostMicros) {
    items.push({ label: "Max cost", value: `$${(budget.maxCostMicros / 1_000_000).toFixed(2)}` });
  }
  if (budget.maxTotalTokens) {
    items.push({ label: "Max tokens", value: budget.maxTotalTokens.toLocaleString() });
  }
  if (budget.maxDurationSeconds) {
    const mins = Math.floor(budget.maxDurationSeconds / 60);
    const secs = budget.maxDurationSeconds % 60;
    items.push({ label: "Max duration", value: mins > 0 ? `${mins}m ${secs}s` : `${secs}s` });
  }
  if (budget.onExceeded) {
    items.push({ label: "On exceeded", value: budget.onExceeded.replace(/_/g, " ") });
  }

  if (items.length === 0) return null;

  return (
    <div className="stg:flex stg:flex-col stg:gap-1.5">
      <SectionHeader>Budget</SectionHeader>
      <div className="stg:flex stg:flex-col stg:gap-1">
        {items.map((item) => (
          <div key={item.label} className="stg:flex stg:items-baseline stg:gap-2 stg:text-[11px]">
            <span className="stg:shrink-0 stg:text-[var(--stgm-muted-foreground,#737373)]">{item.label}:</span>
            <span className="stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)]">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="stg:text-[11px] stg:font-semibold stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
      {children}
    </h4>
  );
}
