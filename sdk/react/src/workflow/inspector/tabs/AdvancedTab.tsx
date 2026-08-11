"use client";

import { memo, useCallback } from "react";
import type { WorkflowGraphNode } from "../../workflow-graph-model.js";

/** Props for {@link AdvancedTab}. */
export interface AdvancedTabProps {
  readonly node: WorkflowGraphNode;
  readonly otherTaskNames: readonly string[];
  readonly kindString: string;
  readonly onUpdateFlow: (nodeId: string, thenTarget: string | undefined) => void;
}

const BRANCHING_KINDS = new Set(["switch_case", "human_input"]);

/**
 * Advanced tab — flow control and raw task metadata.
 *
 * Shows the `flow.then` directive (hidden for branching kinds whose routing
 * is managed by the Configure tab's specialized editors).
 *
 * @since T10 (Inspector Panel Refactor)
 */
export const AdvancedTab = memo(function AdvancedTab({
  node,
  otherTaskNames,
  kindString,
  onUpdateFlow,
}: AdvancedTabProps) {
  const isBranching = BRANCHING_KINDS.has(kindString);
  const currentFlow = node.flow?.then ?? "";

  const handleFlowChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onUpdateFlow(node.id, e.target.value || undefined);
    },
    [node.id, onUpdateFlow],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-4 stg:px-3 stg:py-3">
      {!isBranching && (
        <section className="stg:flex stg:flex-col stg:gap-1.5">
          <h4 className="stg:text-[11px] stg:font-semibold stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
            Flow control
          </h4>
          <p className="stg:text-[10px] stg:leading-tight stg:text-[var(--stgm-muted-foreground,#737373)]">
            Override the default sequential execution order.
          </p>
          <select
            value={currentFlow}
            onChange={handleFlowChange}
            className="stg:w-full stg:rounded-md stg:border stg:border-[var(--stgm-border,#d4d4d8)] stg:bg-[var(--stgm-background,#fff)] stg:px-2 stg:py-1.5 stg:text-xs stg:text-[var(--stgm-foreground,#1a1a2e)] stg:focus:outline-none stg:focus:ring-1 stg:focus:ring-[var(--stgm-ring,#3b82f6)]"
          >
            <option value="">Next (implicit sequential)</option>
            <option value="end">End workflow</option>
            {otherTaskNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </section>
      )}

      {isBranching && (
        <p className="stg:text-xs stg:text-[var(--stgm-muted-foreground,#737373)]">
          Flow routing for this task is managed through its branch configuration in the Configure tab.
        </p>
      )}

      <section className="stg:flex stg:flex-col stg:gap-1.5">
        <h4 className="stg:text-[11px] stg:font-semibold stg:uppercase stg:tracking-wide stg:text-[var(--stgm-muted-foreground,#737373)]">
          Task metadata
        </h4>
        <div className="stg:flex stg:flex-col stg:gap-1 stg:text-[11px]">
          <MetadataRow label="ID" value={node.id} />
          <MetadataRow label="Kind" value={kindString} />
          <MetadataRow label="Category" value={node.category} />
          {node.export?.as && <MetadataRow label="Exports as" value={node.export.as} />}
          {node.flow?.then && <MetadataRow label="Then" value={node.flow.then} />}
        </div>
      </section>
    </div>
  );
});

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="stg:flex stg:items-baseline stg:gap-2">
      <span className="stg:shrink-0 stg:text-[var(--stgm-muted-foreground,#737373)]">{label}:</span>
      <span className="stg:min-w-0 stg:break-all stg:font-mono stg:text-[var(--stgm-foreground,#1a1a2e)]">{value}</span>
    </div>
  );
}
