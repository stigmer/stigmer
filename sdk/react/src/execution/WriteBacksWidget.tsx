"use client";

import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { cn } from "@stigmer/theme";
import { useSessionWriteBacks } from "../session/useSessionWriteBacks.js";
import { WriteBackCard } from "./WriteBackCard.js";

/** Props for {@link WriteBacksWidget}. */
export interface WriteBacksWidgetProps {
  /**
   * All executions for the current session — both completed and
   * actively streaming.  The widget aggregates write-backs across
   * every execution, deduplicates by `workspace_entry_name` (latest
   * wins), and sorts alphabetically.
   *
   * Renders nothing when the list is empty or no execution has
   * write-backs.
   */
  readonly executions: readonly AgentExecution[];
  /** Additional CSS classes for the root element. */
  readonly className?: string;
}

/**
 * Right-sidebar widget that surfaces pull requests created by the
 * platform's incremental git write-back workflow.
 *
 * Write-backs from multiple executions are aggregated and
 * deduplicated by `workspace_entry_name` (latest execution wins),
 * presenting the user with a flat list of PRs — one per workspace
 * entry.
 *
 * Returns `null` when no execution has write-backs, matching the
 * conditional-render pattern of {@link ArtifactsWidget} and
 * {@link ExecutionProgress}.
 *
 * All visual properties flow through `--stgm-*` tokens.  Zero
 * Console dependencies.
 *
 * @example
 * ```tsx
 * const conv = useSessionConversation(sessionId, org);
 *
 * <WriteBacksWidget
 *   executions={[
 *     ...conv.completedExecutions,
 *     ...(conv.activeStreamExecution ? [conv.activeStreamExecution] : []),
 *   ]}
 * />
 * ```
 *
 * @see {@link WriteBackCard} — compact card per write-back
 * @see {@link useSessionWriteBacks} — headless session-level write-back aggregation hook
 * @see {@link useWorkspaceWriteBacks} — headless single-execution write-back extraction hook
 */
export function WriteBacksWidget({
  executions,
  className,
}: WriteBacksWidgetProps) {
  const { writeBacks, hasWriteBacks, writeBackCount } =
    useSessionWriteBacks(executions);

  if (!hasWriteBacks) return null;

  return (
    <section aria-label="Pull Requests" className={cn(className)}>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-medium text-foreground">Pull Requests</h3>
        <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-muted px-1.5 text-xs tabular-nums text-muted-foreground">
          {writeBackCount}
        </span>
      </div>

      <div role="list" className="space-y-2">
        {writeBacks.map((entry) => (
          <div key={entry.writeBack.workspaceEntryName} role="listitem">
            <WriteBackCard writeBack={entry.writeBack} />
          </div>
        ))}
      </div>
    </section>
  );
}
