"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../../internal/tooltip.js";
import type { WorkflowGraphNode, WorkflowGraphModel } from "../../workflow-graph-model.js";
import type { InspectorMutations } from "../types.js";

export interface BranchesTabProps {
  readonly node: WorkflowGraphNode;
  readonly graph: WorkflowGraphModel;
  readonly mutations: InspectorMutations;
  readonly kindString: string;
}

/**
 * Branches tab for switch_case and fork nodes.
 *
 * - switch_case: shows case listing with conditions, default marking, reorder, remove
 * - fork: shows branch listing, join policy toggle, reorder, remove
 *
 * @since T09 (Branch Management UX)
 */
export const BranchesTab = memo(function BranchesTab({
  node,
  graph,
  mutations,
  kindString,
}: BranchesTabProps) {
  if (kindString === "switch_case") {
    return (
      <SwitchCaseBranches node={node} graph={graph} mutations={mutations} />
    );
  }

  if (kindString === "fork") {
    return <ForkBranches node={node} mutations={mutations} />;
  }

  return null;
});

// ---------------------------------------------------------------------------
// Switch Case branches
// ---------------------------------------------------------------------------

function SwitchCaseBranches({
  node,
  graph,
  mutations,
}: {
  node: WorkflowGraphNode;
  graph: WorkflowGraphModel;
  mutations: InspectorMutations;
}) {
  const config = node.config as Record<string, unknown>;
  const cases = useMemo(() => {
    const raw = config.cases;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((c): c is Record<string, unknown> => c != null && typeof c === "object")
      .map((c) => ({
        name: (c.name as string) || "",
        when: (c.when as string) || "",
        then: (c.then as string) || "",
      }));
  }, [config.cases]);

  const edges = graph.edges.filter((e) => e.source === node.id && e.sourceHandle?.startsWith("case_"));

  const handleRemove = useCallback(
    (caseName: string) => {
      mutations.onRemoveSwitchCase?.(node.id, caseName);
    },
    [mutations, node.id],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0 || !mutations.onReorderSwitchCases) return;
      const newOrder = cases.map((c) => c.name);
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      mutations.onReorderSwitchCases(node.id, newOrder);
    },
    [cases, mutations, node.id],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= cases.length - 1 || !mutations.onReorderSwitchCases) return;
      const newOrder = cases.map((c) => c.name);
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      mutations.onReorderSwitchCases(node.id, newOrder);
    },
    [cases, mutations, node.id],
  );

  return (
    <div className="stg:flex stg:flex-col stg:gap-3 stg:px-3 stg:py-3">
      <div className="stg:flex stg:items-center stg:justify-between">
        <h3 className="stg:text-xs stg:font-semibold stg:text-[var(--stgm-foreground,#1a1a2e)]">
          Cases ({cases.length})
        </h3>
      </div>

      {cases.length === 0 ? (
        <p className="stg:text-[11px] stg:text-[var(--stgm-muted-foreground,#737373)]">
          No cases defined. Add a case to create conditional branches.
        </p>
      ) : (
        <div className="stg:flex stg:flex-col stg:gap-1.5">
          {cases.map((caseEntry, idx) => {
            const isDefault = !caseEntry.when;
            const targetEdge = edges.find((e) => e.sourceHandle === `case_${caseEntry.name}`);
            return (
              <div
                key={caseEntry.name}
                className={cn(
                  "stg:group/case stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:border stg:px-2 stg:py-1.5",
                  isDefault
                    ? "stg:border-dashed stg:border-[var(--stgm-border,#e5e5e5)] stg:bg-[var(--stgm-muted,#f5f5f5)]"
                    : "stg:border-[var(--stgm-border,#e5e5e5)]",
                )}
              >
                {/* Reorder controls */}
                <div className="stg:flex stg:flex-col stg:gap-0.5 stg:opacity-0 stg:group-hover/case:opacity-100 stg:transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleMoveUp(idx)}
                    disabled={idx === 0}
                    className="stg:text-[var(--stgm-muted-foreground,#737373)] stg:disabled:opacity-30 stg:hover:text-[var(--stgm-foreground,#1a1a2e)]"
                    aria-label={`Move ${caseEntry.name} up`}
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
                      <path d="M4 1L1 5h6L4 1z" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveDown(idx)}
                    disabled={idx === cases.length - 1}
                    className="stg:text-[var(--stgm-muted-foreground,#737373)] stg:disabled:opacity-30 stg:hover:text-[var(--stgm-foreground,#1a1a2e)]"
                    aria-label={`Move ${caseEntry.name} down`}
                  >
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
                      <path d="M4 7L1 3h6L4 7z" />
                    </svg>
                  </button>
                </div>

                {/* Case info */}
                <div className="stg:min-w-0 stg:flex-1">
                  <div className="stg:flex stg:items-center stg:gap-1.5">
                    <span className="stg:text-[11px] stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)] stg:truncate">
                      {caseEntry.name}
                    </span>
                    {isDefault && (
                      <span className="stg:shrink-0 stg:rounded-sm stg:bg-[var(--stgm-muted,#f5f5f5)] stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:px-1 stg:py-px stg:text-[9px] stg:font-medium stg:text-[var(--stgm-muted-foreground,#737373)]">
                        default
                      </span>
                    )}
                  </div>
                  {caseEntry.when && (
                    <p className="stg:mt-0.5 stg:text-[10px] stg:font-mono stg:text-[var(--stgm-muted-foreground,#737373)] stg:truncate">
                      {caseEntry.when}
                    </p>
                  )}
                  {targetEdge && (
                    <p className="stg:mt-0.5 stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)]">
                      → {targetEdge.target}
                    </p>
                  )}
                </div>

                {/* Remove button */}
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <button
                        type="button"
                        onClick={() => handleRemove(caseEntry.name)}
                        className="stg:shrink-0 stg:opacity-0 stg:group-hover/case:opacity-100 stg:transition-opacity stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:text-[var(--stgm-destructive,#ef4444)]"
                        aria-label={`Remove case ${caseEntry.name}`}
                      />
                    }
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </TooltipTrigger>
                  <TooltipContent side="top">Remove case</TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fork branches
// ---------------------------------------------------------------------------

function ForkBranches({
  node,
  mutations,
}: {
  node: WorkflowGraphNode;
  mutations: InspectorMutations;
}) {
  const config = node.config as Record<string, unknown>;
  const branches = useMemo(() => {
    const raw = config.branches;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((b): b is Record<string, unknown> => b != null && typeof b === "object")
      .map((b) => ({
        name: (b.name as string) || "",
        taskCount: Array.isArray(b.do) ? b.do.length : 0,
      }));
  }, [config.branches]);

  const compete = config.compete === true;

  const handleSetCompete = useCallback(
    (value: boolean) => {
      mutations.onSetForkCompete?.(node.id, value);
    },
    [mutations, node.id],
  );

  const handleRemove = useCallback(
    (branchName: string) => {
      mutations.onRemoveForkBranch?.(node.id, branchName);
    },
    [mutations, node.id],
  );

  const handleMoveUp = useCallback(
    (index: number) => {
      if (index <= 0 || !mutations.onReorderForkBranches) return;
      const newOrder = branches.map((b) => b.name);
      [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
      mutations.onReorderForkBranches(node.id, newOrder);
    },
    [branches, mutations, node.id],
  );

  const handleMoveDown = useCallback(
    (index: number) => {
      if (index >= branches.length - 1 || !mutations.onReorderForkBranches) return;
      const newOrder = branches.map((b) => b.name);
      [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
      mutations.onReorderForkBranches(node.id, newOrder);
    },
    [branches, mutations, node.id],
  );

  const [renamingIdx, setRenamingIdx] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = useCallback((idx: number, currentName: string) => {
    setRenamingIdx(idx);
    setRenameValue(currentName);
  }, []);

  const commitRename = useCallback(() => {
    if (renamingIdx === null) return;
    const oldName = branches[renamingIdx]?.name;
    const trimmed = renameValue.trim();
    if (oldName && trimmed && trimmed !== oldName && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
      mutations.onRenameForkBranch?.(node.id, oldName, trimmed);
    }
    setRenamingIdx(null);
  }, [renamingIdx, renameValue, branches, mutations, node.id]);

  return (
    <div className="stg:flex stg:flex-col stg:gap-3 stg:px-3 stg:py-3">
      {/* Join policy */}
      <fieldset>
        <legend className="stg:text-xs stg:font-semibold stg:text-[var(--stgm-foreground,#1a1a2e)] stg:mb-1.5">
          Join policy
        </legend>
        <div className="stg:flex stg:flex-col stg:gap-1.5">
          <label className="stg:flex stg:items-center stg:gap-2 stg:text-[11px] stg:text-[var(--stgm-foreground,#1a1a2e)] stg:cursor-pointer">
            <input
              type="radio"
              name={`join-policy-${node.id}`}
              checked={!compete}
              onChange={() => handleSetCompete(false)}
              className="stg:h-3 stg:w-3 stg:accent-[var(--stgm-primary,#6366f1)]"
            />
            Wait for all branches
          </label>
          <label className="stg:flex stg:items-center stg:gap-2 stg:text-[11px] stg:text-[var(--stgm-foreground,#1a1a2e)] stg:cursor-pointer">
            <input
              type="radio"
              name={`join-policy-${node.id}`}
              checked={compete}
              onChange={() => handleSetCompete(true)}
              className="stg:h-3 stg:w-3 stg:accent-[var(--stgm-primary,#6366f1)]"
            />
            Race mode (first branch wins)
          </label>
        </div>
      </fieldset>

      {/* Branch listing */}
      <div>
        <h3 className="stg:text-xs stg:font-semibold stg:text-[var(--stgm-foreground,#1a1a2e)] stg:mb-1.5">
          Parallel branches ({branches.length})
        </h3>

        <div className="stg:flex stg:flex-col stg:gap-1.5">
          {branches.map((branch, idx) => (
            <div
              key={branch.name}
              className="stg:group/branch stg:flex stg:items-center stg:gap-2 stg:rounded-md stg:border stg:border-[var(--stgm-border,#e5e5e5)] stg:px-2 stg:py-1.5"
            >
              {/* Reorder */}
              <div className="stg:flex stg:flex-col stg:gap-0.5 stg:opacity-0 stg:group-hover/branch:opacity-100 stg:transition-opacity">
                <button
                  type="button"
                  onClick={() => handleMoveUp(idx)}
                  disabled={idx === 0}
                  className="stg:text-[var(--stgm-muted-foreground,#737373)] stg:disabled:opacity-30 stg:hover:text-[var(--stgm-foreground,#1a1a2e)]"
                  aria-label={`Move ${branch.name} up`}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
                    <path d="M4 1L1 5h6L4 1z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveDown(idx)}
                  disabled={idx === branches.length - 1}
                  className="stg:text-[var(--stgm-muted-foreground,#737373)] stg:disabled:opacity-30 stg:hover:text-[var(--stgm-foreground,#1a1a2e)]"
                  aria-label={`Move ${branch.name} down`}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
                    <path d="M4 7L1 3h6L4 7z" />
                  </svg>
                </button>
              </div>

              {/* Branch info */}
              <div className="stg:min-w-0 stg:flex-1">
                {renamingIdx === idx ? (
                  <input
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingIdx(null);
                    }}
                    autoFocus
                    className="stg:w-full stg:rounded stg:border stg:border-[var(--stgm-ring,#3b82f6)] stg:bg-[var(--stgm-background,#fff)] stg:px-1 stg:py-0.5 stg:text-[11px] stg:text-[var(--stgm-foreground,#1a1a2e)] stg:outline-none"
                  />
                ) : (
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <span
                          className="stg:text-[11px] stg:font-medium stg:text-[var(--stgm-foreground,#1a1a2e)] stg:truncate stg:block stg:cursor-text"
                          onDoubleClick={() => startRename(idx, branch.name)}
                        />
                      }
                    >
                      {branch.name}
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      Double-click to rename
                    </TooltipContent>
                  </Tooltip>
                )}
                <span className="stg:text-[10px] stg:text-[var(--stgm-muted-foreground,#737373)]">
                  {branch.taskCount} {branch.taskCount === 1 ? "task" : "tasks"}
                </span>
              </div>

              {/* Remove — disabled if only 2 branches. The tooltip trigger is
                  a wrapper span so the "why is this disabled" explanation
                  stays hoverable (disabled buttons never receive pointer
                  events). */}
              <Tooltip>
                <TooltipTrigger render={<span className="stg:inline-flex stg:shrink-0" />}>
                  <button
                    type="button"
                    onClick={() => handleRemove(branch.name)}
                    disabled={branches.length <= 2}
                    className="stg:shrink-0 stg:opacity-0 stg:group-hover/branch:opacity-100 stg:transition-opacity stg:text-[var(--stgm-muted-foreground,#737373)] stg:hover:text-[var(--stgm-destructive,#ef4444)] stg:disabled:opacity-30 stg:disabled:cursor-not-allowed"
                    aria-label={`Remove branch ${branch.name}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                      <path d="M3 3l6 6M9 3l-6 6" />
                    </svg>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {branches.length <= 2
                    ? "Fork requires at least 2 branches"
                    : "Remove branch"}
                </TooltipContent>
              </Tooltip>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
