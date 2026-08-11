"use client";

// Changes facet for the workflow execution panel's activity rail.
// Domain: workflow. Deliberate naming divergence from the SESSION's Changes
// tab (which shows git write-backs — the session renders file diffs inline in
// its transcript): the workflow has no transcript, so here "Changes" is the
// execution-level net file-diff rollup across all AGENT_CALL tasks.

import { useMemo } from "react";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { toFileDiffEntry } from "../../execution/deriveExecutionFileChanges.js";
import { DiffFileList } from "../../version-history/DiffFileList.js";

/** Props for {@link WorkflowChangesTab}. */
export interface WorkflowChangesTabProps {
  /** Net file changes across all tasks (from `useWorkflowExecutionFileChanges`). */
  readonly fileChanges: readonly FileChange[];
  /** `true` while the first child-execution fetches are in flight (no data yet). */
  readonly isLoading?: boolean;
  /** `true` while later fetches are in flight and the current list is stale. */
  readonly isRefetching?: boolean;
  /** Fetch error, or `null`. Partial results still render below the notice. */
  readonly error?: Error | null;
  /**
   * Tab path of the active file-change diff document, or `null` — drives the
   * list's active-row highlight so it tracks the open editor tab.
   */
  readonly activePath?: string | null;
  /** Single click / Enter / Space: open the change's diff as an editor-pane tab. */
  readonly onOpen: (change: FileChange) => void;
}

/**
 * Changes facet for the workflow execution panel (a
 * `useWorkflowExecutionRailViews` rail view): a VS Code Source Control-style
 * dense file list of the execution's net file changes across ALL agent-call
 * tasks — path, M/A/D badge, `+N -N` — one row per changed file.
 *
 * Clicking a row opens that file's diff in the editor pane
 * (`FileChangeDiff` as a virtual document); the active tab highlights its
 * row. Rows reuse the shared `DiffFileList`, and the `+N -N` counts come from
 * the shared `toFileDiffEntry` projection — the same numbers the session's
 * `FileChangesView` shows for the same capture.
 *
 * Freshness contract (from the data hook): the list refreshes at task
 * boundaries, not token-by-token while an agent is mid-run — surfaced
 * honestly via the "Updating…" status line instead of pretending to be live.
 */
export function WorkflowChangesTab({
  fileChanges,
  isLoading = false,
  isRefetching = false,
  error = null,
  activePath = null,
  onOpen,
}: WorkflowChangesTabProps) {
  const entries = useMemo(
    () => fileChanges.map(toFileDiffEntry),
    [fileChanges],
  );

  // The rollup keys one net change per path, so path → change lookup is total.
  const changeByPath = useMemo(
    () => new Map(fileChanges.map((c) => [c.path || c.absolutePath, c])),
    [fileChanges],
  );

  if (isLoading) {
    return (
      <div
        role="status"
        className="stg:flex stg:flex-col stg:items-center stg:justify-center stg:px-4 stg:py-8 stg:text-center"
      >
        <p className="stg:text-xs stg:text-muted-foreground">Loading file changes…</p>
      </div>
    );
  }

  if (fileChanges.length === 0) {
    return (
      <div className="stg:flex stg:flex-col stg:gap-2 stg:px-4 stg:py-8 stg:text-center">
        {error && <ErrorNotice error={error} />}
        <p className="stg:text-xs stg:text-muted-foreground">
          No file changes yet. Files edited by agent tasks will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="stg:flex stg:flex-col stg:gap-2">
      {error && (
        <div className="stg:px-2 stg:pt-2">
          <ErrorNotice error={error} />
        </div>
      )}

      <DiffFileList
        files={entries}
        selectedPath={activePath}
        onSelect={(path) => {
          const change = changeByPath.get(path);
          if (change) onOpen(change);
        }}
      />

      {isRefetching && (
        <p role="status" className="stg:px-3 stg:pb-2 stg:text-[0.65rem] stg:text-muted-foreground-faint">
          Updating…
        </p>
      )}
    </div>
  );
}

/**
 * A failed child fetch never blanks the facet — partial results render and
 * the failure is named (DD-006: what happened + what it means).
 */
function ErrorNotice({ error }: { readonly error: Error }) {
  return (
    <div
      role="alert"
      className="stg:rounded-md stg:border stg:border-border stg:bg-muted-subtle stg:px-3 stg:py-2 stg:text-left stg:text-xs stg:text-destructive"
    >
      Some task changes could not be loaded: {error.message}
    </div>
  );
}
