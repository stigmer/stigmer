"use client";

import { memo, useState, useCallback } from "react";
import type { WorkflowGraphNode } from "../../workflow-graph-model.js";

/** Props for {@link DataTab}. */
export interface DataTabProps {
  readonly node: WorkflowGraphNode;
  readonly onUpdateExport: (nodeId: string, exportAs: string | undefined) => void;
}

/**
 * Data tab — manages export expressions and data mapping for a task.
 *
 * Shows the `export.as` expression field, which determines how task
 * output is saved to the workflow context for downstream consumption.
 *
 * @since T10 (Inspector Panel Refactor)
 */
export const DataTab = memo(function DataTab({
  node,
  onUpdateExport,
}: DataTabProps) {
  const [value, setValue] = useState(node.export?.as ?? "");

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setValue(e.target.value);
    },
    [],
  );

  const handleBlur = useCallback(() => {
    const trimmed = value.trim();
    onUpdateExport(node.id, trimmed || undefined);
  }, [value, node.id, onUpdateExport]);

  return (
    <div className="flex flex-col gap-4 px-3 py-3">
      <section className="flex flex-col gap-1.5">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--stgm-muted-foreground,#737373)]">
          Export
        </h4>
        <p className="text-[10px] leading-tight text-[var(--stgm-muted-foreground,#737373)]">
          Save task output to the workflow context for downstream tasks.
          Use <code className="rounded bg-[var(--stgm-muted,#f5f5f5)] px-1 text-[10px]">{"${ . }"}</code> to export the entire output.
        </p>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder='e.g., ${ . } or ${ .fieldName }'
          className="w-full rounded-md border border-[var(--stgm-border,#d4d4d8)] bg-[var(--stgm-background,#fff)] px-2 py-1.5 text-xs text-[var(--stgm-foreground,#1a1a2e)] placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] focus:outline-none focus:ring-1 focus:ring-[var(--stgm-ring,#3b82f6)]"
        />
      </section>
    </div>
  );
});
