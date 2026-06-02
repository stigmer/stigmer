"use client";

import { memo, useCallback, useState, useMemo } from "react";
import type { WorkflowGraphNode } from "../../workflow-graph-model";
import type { InspectorMutations } from "../types";

export interface IterationTabProps {
  readonly node: WorkflowGraphNode;
  readonly mutations: InspectorMutations;
}

const ERROR_POLICY_OPTIONS = [
  { value: "FOR_EACH_FAIL_FAST", label: "Fail fast", description: "Stop on first error, cancel in-flight iterations" },
  { value: "FOR_EACH_CONTINUE", label: "Continue", description: "Continue remaining iterations, collect failures in output" },
  { value: "FOR_EACH_SKIP", label: "Skip", description: "Skip failed items silently, exclude from output" },
] as const;

/**
 * Iteration tab for for_each nodes.
 *
 * Displays:
 * - Variable name (each)
 * - Collection expression (in)
 * - Concurrency (max_parallelism)
 * - Batch size (when parallel)
 * - Error policy (on_error)
 * - Nested tasks (do block, read-only listing)
 *
 * @since T09 (Branch Management UX)
 */
export const IterationTab = memo(function IterationTab({
  node,
  mutations,
}: IterationTabProps) {
  const config = node.config as Record<string, unknown>;

  const currentValues = useMemo(() => ({
    each: (config.each as string) || "",
    in: (config.in as string) || "",
    max_parallelism: (config.max_parallelism as number) || 0,
    batch_size: (config.batch_size as number) || 0,
    on_error: (config.on_error as string) || "FOR_EACH_FAIL_FAST",
  }), [config.each, config.in, config.max_parallelism, config.batch_size, config.on_error]);

  const nestedTasks = useMemo(() => {
    const raw = config.do;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t): t is Record<string, unknown> => t != null && typeof t === "object")
      .map((t) => ({
        name: (t.name as string) || "unnamed",
        kind: (t.kind as string) || "unknown",
      }));
  }, [config.do]);

  const [each, setEach] = useState(currentValues.each);
  const [inExpr, setInExpr] = useState(currentValues.in);
  const [parallelism, setParallelism] = useState(currentValues.max_parallelism);
  const [batchSize, setBatchSize] = useState(currentValues.batch_size);
  const [onError, setOnError] = useState(currentValues.on_error);

  const commitField = useCallback(
    (field: string, value: string | number) => {
      mutations.onUpdateForEachConfig?.(node.id, { [field]: value });
    },
    [mutations, node.id],
  );

  const handleEachBlur = useCallback(() => {
    const trimmed = each.trim();
    if (trimmed && trimmed !== currentValues.each) {
      commitField("each", trimmed);
    }
  }, [each, currentValues.each, commitField]);

  const handleInBlur = useCallback(() => {
    const trimmed = inExpr.trim();
    if (trimmed && trimmed !== currentValues.in) {
      commitField("in", trimmed);
    }
  }, [inExpr, currentValues.in, commitField]);

  const handleParallelismBlur = useCallback(() => {
    if (parallelism !== currentValues.max_parallelism) {
      commitField("max_parallelism", parallelism);
    }
  }, [parallelism, currentValues.max_parallelism, commitField]);

  const handleBatchSizeBlur = useCallback(() => {
    if (batchSize !== currentValues.batch_size) {
      commitField("batch_size", batchSize);
    }
  }, [batchSize, currentValues.batch_size, commitField]);

  const handleErrorPolicyChange = useCallback(
    (value: string) => {
      setOnError(value);
      commitField("on_error", value);
    },
    [commitField],
  );

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* Variable name */}
      <div>
        <label className="mb-1 block text-[10px] font-medium text-[var(--stgm-muted-foreground,#737373)]">
          Item variable name
        </label>
        <input
          type="text"
          value={each}
          onChange={(e) => setEach(e.target.value)}
          onBlur={handleEachBlur}
          onKeyDown={(e) => { if (e.key === "Enter") handleEachBlur(); }}
          className="w-full rounded border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] px-2 py-1.5 text-xs font-mono text-[var(--stgm-foreground,#1a1a2e)] outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
          placeholder="item"
        />
        <p className="mt-0.5 text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
          Access as <code className="font-mono">{"${"}$data.{each || "item"}{"}"}</code> in nested tasks
        </p>
      </div>

      {/* Collection expression */}
      <div>
        <label className="mb-1 block text-[10px] font-medium text-[var(--stgm-muted-foreground,#737373)]">
          Collection expression
        </label>
        <input
          type="text"
          value={inExpr}
          onChange={(e) => setInExpr(e.target.value)}
          onBlur={handleInBlur}
          onKeyDown={(e) => { if (e.key === "Enter") handleInBlur(); }}
          className="w-full rounded border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] px-2 py-1.5 text-xs font-mono text-[var(--stgm-foreground,#1a1a2e)] outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
          placeholder="${ $data.items }"
        />
      </div>

      {/* Concurrency */}
      <div>
        <label className="mb-1 block text-[10px] font-medium text-[var(--stgm-muted-foreground,#737373)]">
          Concurrency (max_parallelism)
        </label>
        <input
          type="number"
          min={0}
          value={parallelism}
          onChange={(e) => setParallelism(Math.max(0, parseInt(e.target.value) || 0))}
          onBlur={handleParallelismBlur}
          className="w-full rounded border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
        />
        <p className="mt-0.5 text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
          {parallelism === 0 ? "Sequential execution (one at a time)" : `Up to ${parallelism} iterations in parallel`}
        </p>
      </div>

      {/* Batch size — only visible when parallel */}
      {parallelism > 0 && (
        <div>
          <label className="mb-1 block text-[10px] font-medium text-[var(--stgm-muted-foreground,#737373)]">
            Batch size
          </label>
          <input
            type="number"
            min={0}
            value={batchSize}
            onChange={(e) => setBatchSize(Math.max(0, parseInt(e.target.value) || 0))}
            onBlur={handleBatchSizeBlur}
            className="w-full rounded border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
          />
          <p className="mt-0.5 text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
            {batchSize === 0 ? "No batching — all items available for parallel execution" : `Process ${batchSize} items per batch`}
          </p>
        </div>
      )}

      {/* Error policy */}
      {parallelism > 0 && (
        <fieldset>
          <legend className="text-[10px] font-medium text-[var(--stgm-muted-foreground,#737373)] mb-1.5">
            Error policy
          </legend>
          <div className="flex flex-col gap-1.5">
            {ERROR_POLICY_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-start gap-2 text-[11px] text-[var(--stgm-foreground,#1a1a2e)] cursor-pointer"
              >
                <input
                  type="radio"
                  name={`error-policy-${node.id}`}
                  value={opt.value}
                  checked={onError === opt.value}
                  onChange={() => handleErrorPolicyChange(opt.value)}
                  className="mt-0.5 h-3 w-3 accent-[var(--stgm-primary,#6366f1)]"
                />
                <span>
                  <span className="font-medium">{opt.label}</span>
                  <br />
                  <span className="text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
                    {opt.description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {/* Nested tasks */}
      <section>
        <h3 className="text-xs font-semibold text-[var(--stgm-foreground,#1a1a2e)] mb-1.5">
          Loop body ({nestedTasks.length} {nestedTasks.length === 1 ? "task" : "tasks"})
        </h3>
        {nestedTasks.length === 0 ? (
          <p className="text-[11px] text-[var(--stgm-muted-foreground,#737373)]">
            No tasks in loop body.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {nestedTasks.map((task, idx) => (
              <div
                key={`${task.name}-${idx}`}
                className="flex items-center gap-2 rounded border border-[var(--stgm-border,#e5e5e5)] px-2 py-1"
              >
                <span className="text-[10px] font-mono text-[var(--stgm-muted-foreground,#737373)]">
                  {task.kind}
                </span>
                <span className="text-[11px] text-[var(--stgm-foreground,#1a1a2e)] truncate">
                  {task.name}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
});
