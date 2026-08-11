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
    <div className="stg:flex stg:flex-col stg:gap-4 stg:px-3 stg:py-3">
      <section className="stg:flex stg:flex-col stg:gap-1.5">
        <h4 className="stg:text-[11px] stg:font-semibold stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
          Export
        </h4>
        <p className="stg:text-[10px] stg:leading-tight stg:text-[var(--stgm-muted-foreground,#737373)]">
          Save task output to the workflow context for downstream tasks.
          Use <code className="stg:rounded stg:bg-[var(--stgm-muted,#f5f5f5)] stg:px-1 stg:text-[10px]">{"${ . }"}</code> to export the entire output.
        </p>
        <input
          type="text"
          value={value}
          onChange={handleChange}
          onBlur={handleBlur}
          placeholder='e.g., ${ . } or ${ .fieldName }'
          className="stg:w-full stg:rounded-md stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)] stg:px-2 stg:py-1.5 stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)] stg:placeholder:text-[var(--stgm-muted-foreground,#a3a3a3)] stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-[var(--stgm-ring,#3b82f6)]"
        />
      </section>
    </div>
  );
});
