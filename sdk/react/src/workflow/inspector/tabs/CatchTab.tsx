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
    <div className="stg:flex stg:flex-col stg:gap-4 stg:px-3 stg:py-3">
      {/* Protected (try) tasks */}
      <section>
        <h3 className="stg:text-xs stg:font-semibold stg:text-[var(--stgm-foreground,#1a1a2e)] stg:mb-1.5">
          Protected tasks ({tryTasks.length})
        </h3>
        {tryTasks.length === 0 ? (
          <p className="stg:text-[11px] stg:text-[var(--stgm-muted-foreground,#737373)]">
            No tasks in the try block.
          </p>
        ) : (
          <div className="stg:flex stg:flex-col stg:gap-1">
            {tryTasks.map((task, idx) => (
              <div
                key={`${task.name}-${idx}`}
                className="stg:flex stg:items-center stg:gap-2 stg:rounded stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:px-2 stg:py-1"
              >
                <span className="stg:text-[10px] stg:font-mono stg:text-[var(--stgm-muted-foreground,#737373)]">
                  {task.kind}
                </span>
                <span className="stg:text-[11px] stg:text-[var(--stgm-foreground,#1a1a2e)] stg:truncate">
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
          <h3 className="stg:text-xs stg:font-semibold stg:text-[var(--stgm-foreground,#1a1a2e)] stg:mb-1.5">
            Catch handler
          </h3>

          <div className="stg:flex stg:flex-col stg:gap-2.5">
            {/* Error variable */}
            <div>
              <label className="stg:mb-1 stg:block stg:text-[10px] stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)]">
                Error variable name
              </label>
              <input
                type="text"
                value={errorVar}
                onChange={(e) => setErrorVar(e.target.value)}
                onBlur={handleErrorVarBlur}
                onKeyDown={(e) => { if (e.key === "Enter") handleErrorVarBlur(); }}
                className="stg:w-full stg:rounded stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-input-bg,var(--stgm-background,#fff))] stg:px-2 stg:py-1.5 stg:text-xs stg:font-mono stg:text-[var(--stgm-foreground,#1a1a2e)] stg:outline-none stg:focus:ring-1 stg:focus:ring-[var(--stgm-ring,#3b82f6)]"
                placeholder="error"
              />
              <p className="stg:mt-0.5 stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)]">
                Access in catch block as <code className="stg:font-mono">${"${"}$context.{errorVar}{"}"}</code>
              </p>
            </div>

            {/* Compensate toggle */}
            <label className="stg:flex stg:items-center stg:gap-2 stg:text-[11px] stg:text-[var(--stgm-foreground,#1a1a2e)] stg:cursor-pointer">
              <input
                type="checkbox"
                checked={catchBlock.compensate}
                onChange={handleCompensateToggle}
                className="stg:h-3 stg:w-3 stg:accent-[var(--stgm-primary,#6366f1)]"
              />
              Run compensation before catch block
            </label>

            {/* Catch tasks */}
            <div>
              <h4 className="stg:text-[10px] stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)] stg:mb-1">
                Catch tasks ({catchBlock.tasks.length})
              </h4>
              {catchBlock.tasks.length === 0 ? (
                <p className="stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)] stg:italic">
                  No tasks in catch block
                </p>
              ) : (
                <div className="stg:flex stg:flex-col stg:gap-1">
                  {catchBlock.tasks.map((task, idx) => (
                    <div
                      key={`${task.name}-${idx}`}
                      className="stg:flex stg:items-center stg:gap-2 stg:rounded stg:border stg:border-dashed stg:border-[var(--stgm-border,#e5e5e5)] stg:px-2 stg:py-1"
                    >
                      <span className="stg:text-[10px] stg:font-mono stg:text-[var(--stgm-muted-foreground,#737373)]">
                        {task.kind}
                      </span>
                      <span className="stg:text-[11px] stg:text-[var(--stgm-foreground,#1a1a2e)] stg:truncate">
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
              className="stg:mt-1 stg:w-full stg:rounded stg:border stg:border-[var(--stgm-destructive,#ef4444)]/30 stg:px-2 stg:py-1.5 stg:text-[11px] stg:font-medium stg:text-[var(--stgm-destructive,#ef4444)] stg:transition-colors stg:hover:bg-[var(--stgm-destructive,#ef4444)]/10"
            >
              Remove catch handler
            </button>
          </div>
        </section>
      ) : (
        <section>
          <p className="stg:text-[11px] stg:text-[var(--stgm-muted-foreground,#737373)]">
            No catch handler configured. Add one using the + button on the node.
          </p>
        </section>
      )}
    </div>
  );
});
