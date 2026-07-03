"use client";

import { memo, useCallback, useMemo, useState } from "react";
import type { WorkflowGraphNode } from "../../workflow-graph-model.js";
import type { InspectorMutations } from "../types.js";

export interface CatchTabProps {
  readonly node: WorkflowGraphNode;
  readonly mutations: InspectorMutations;
}

/**
 * Catch tab for try_catch nodes.
 *
 * Displays:
 * - Protected tasks list (try block, read-only)
 * - Catch configuration (error variable, compensate toggle)
 * - Catch tasks list
 * - Remove catch handler action
 *
 * @since T09 (Branch Management UX)
 */
export const CatchTab = memo(function CatchTab({ node, mutations }: CatchTabProps) {
  const config = node.config as Record<string, unknown>;

  const tryTasks = useMemo(() => {
    const raw = config.try;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((t): t is Record<string, unknown> => t != null && typeof t === "object")
      .map((t) => ({
        name: (t.name as string) || "unnamed",
        kind: (t.kind as string) || "unknown",
      }));
  }, [config.try]);

  const catchBlock = useMemo(() => {
    const raw = config.catch;
    if (!raw || typeof raw !== "object") return null;
    const block = raw as Record<string, unknown>;
    return {
      as: (block.as as string) || "error",
      compensate: block.compensate === true,
      tasks: Array.isArray(block.do)
        ? (block.do as Record<string, unknown>[])
            .filter((t): t is Record<string, unknown> => t != null && typeof t === "object")
            .map((t) => ({
              name: (t.name as string) || "unnamed",
              kind: (t.kind as string) || "unknown",
            }))
        : [],
    };
  }, [config.catch]);

  const [errorVar, setErrorVar] = useState(catchBlock?.as ?? "error");

  const handleErrorVarBlur = useCallback(() => {
    const trimmed = errorVar.trim();
    if (trimmed && trimmed !== catchBlock?.as) {
      mutations.onUpdateCatchConfig?.(node.id, { as: trimmed });
    }
  }, [errorVar, catchBlock?.as, mutations, node.id]);

  const handleCompensateToggle = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      mutations.onUpdateCatchConfig?.(node.id, { compensate: e.target.checked });
    },
    [mutations, node.id],
  );

  const handleRemoveCatch = useCallback(() => {
    mutations.onRemoveCatchBlock?.(node.id);
  }, [mutations, node.id]);

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      {/* Protected (try) tasks */}
      <section>
        <h3 className="text-xs font-semibold text-[var(--stgm-foreground,#1a1a2e)] mb-1.5">
          Protected tasks ({tryTasks.length})
        </h3>
        {tryTasks.length === 0 ? (
          <p className="text-[11px] text-[var(--stgm-muted-foreground,#737373)]">
            No tasks in the try block.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {tryTasks.map((task, idx) => (
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

      {/* Catch configuration */}
      {catchBlock ? (
        <section>
          <h3 className="text-xs font-semibold text-[var(--stgm-foreground,#1a1a2e)] mb-1.5">
            Catch handler
          </h3>

          <div className="flex flex-col gap-2.5">
            {/* Error variable */}
            <div>
              <label className="mb-1 block text-[10px] font-medium text-[var(--stgm-muted-foreground,#737373)]">
                Error variable name
              </label>
              <input
                type="text"
                value={errorVar}
                onChange={(e) => setErrorVar(e.target.value)}
                onBlur={handleErrorVarBlur}
                onKeyDown={(e) => { if (e.key === "Enter") handleErrorVarBlur(); }}
                className="w-full rounded border border-[var(--stgm-border,#e5e5e5)] bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] px-2 py-1.5 text-xs font-mono text-[var(--stgm-foreground,#1a1a2e)] outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
                placeholder="error"
              />
              <p className="mt-0.5 text-[10px] text-[var(--stgm-muted-foreground,#737373)]">
                Access in catch block as <code className="font-mono">${"${"}$context.{errorVar}{"}"}</code>
              </p>
            </div>

            {/* Compensate toggle */}
            <label className="flex items-center gap-2 text-[11px] text-[var(--stgm-foreground,#1a1a2e)] cursor-pointer">
              <input
                type="checkbox"
                checked={catchBlock.compensate}
                onChange={handleCompensateToggle}
                className="h-3 w-3 accent-[var(--stgm-primary,#6366f1)]"
              />
              Run compensation before catch block
            </label>

            {/* Catch tasks */}
            <div>
              <h4 className="text-[10px] font-medium text-[var(--stgm-muted-foreground,#737373)] mb-1">
                Catch tasks ({catchBlock.tasks.length})
              </h4>
              {catchBlock.tasks.length === 0 ? (
                <p className="text-[10px] text-[var(--stgm-muted-foreground,#737373)] italic">
                  No tasks in catch block
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {catchBlock.tasks.map((task, idx) => (
                    <div
                      key={`${task.name}-${idx}`}
                      className="flex items-center gap-2 rounded border border-dashed border-[var(--stgm-border,#e5e5e5)] px-2 py-1"
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
            </div>

            {/* Remove handler */}
            <button
              type="button"
              onClick={handleRemoveCatch}
              className="mt-1 w-full rounded border border-[var(--stgm-destructive,#ef4444)]/30 px-2 py-1.5 text-[11px] font-medium text-[var(--stgm-destructive,#ef4444)] transition-colors hover:bg-[var(--stgm-destructive,#ef4444)]/10"
            >
              Remove catch handler
            </button>
          </div>
        </section>
      ) : (
        <section>
          <p className="text-[11px] text-[var(--stgm-muted-foreground,#737373)]">
            No catch handler configured. Add one using the + button on the node.
          </p>
        </section>
      )}
    </div>
  );
});
