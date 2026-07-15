"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { TaskDetailAgentCall } from "./derive-task-detail.js";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";
import { formatMicroUsd, formatTokenCount } from "../format-utils.js";

/** Props for {@link AgentCallTab}. */
export interface AgentCallTabProps {
  readonly agentCall: TaskDetailAgentCall;
  /** The AGENT_CALL task's name — the transcript tab's identity suffix. */
  readonly taskName: string;
  readonly taskStatus?: DerivedTaskState["status"];
  /**
   * Open the child execution's full transcript in the execution panel —
   * the S4 in-place expansion (primary action).
   */
  readonly onOpenAgentExecution?: (
    childExecutionId: string,
    taskName: string,
  ) => void;
  /** Open the child execution as a standalone page (pop-out escape hatch). */
  readonly onNavigateToAgentExecution?: (id: string) => void;
  readonly className?: string;
}

/**
 * Agent Call tab in the execution inspector — a compact LAUNCHER, not a
 * viewer: at-a-glance stats plus "Open agent execution" (the in-place
 * expansion into the execution panel) and "Open standalone" (host-routed
 * pop-out, DD-004).
 *
 * This deliberately replaced the earlier embedded `MessageThread` thumbnail
 * (`max-h-[50vh]` + double scrollbar): the full transcript now renders in
 * the panel's editor area via `WorkflowAgentExecutionDocument`, which owns
 * the fetch/stream lifecycle. The inspector therefore holds NO child
 * subscription — one launcher serves running and terminal tasks alike.
 */
export const AgentCallTab = memo(function AgentCallTab({
  agentCall,
  taskName,
  taskStatus,
  onOpenAgentExecution,
  onNavigateToAgentExecution,
  className,
}: AgentCallTabProps) {
  const isRunning = taskStatus === "running" || taskStatus === "waiting_approval";
  const hasChildId = !!agentCall.childExecutionId;

  const BZ = BigInt(0);

  // Very-early running state: the child execution has not registered its id
  // yet (agentCallStarted precedes the first progress event that carries it).
  // Nothing to open, so an honest waiting state instead of dead buttons.
  if (isRunning && !hasChildId) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 py-8", className)}>
        <div className="size-5 animate-spin rounded-full border-2 border-muted border-t-primary" />
        <p className="text-xs text-muted-foreground">Waiting for agent to start...</p>
        <p className="text-[11px] text-muted-foreground">{agentCall.agentSlug}</p>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      {/* Identity + live state */}
      <div className="flex items-center gap-2 text-xs">
        <span className="min-w-0 truncate font-medium text-foreground">
          {agentCall.agentSlug}
        </span>
        {isRunning && (
          <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-primary">
            <span className="inline-block size-1.5 animate-pulse rounded-full bg-primary" aria-hidden="true" />
            Running
          </span>
        )}
      </div>

      {/* At-a-glance stats — live progress values while running, the final
          ledger once completed (derive-task-detail sources both). */}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        {agentCall.agentPhase && (
          <>
            <dt className="text-muted-foreground">Phase</dt>
            <dd className="text-foreground">{agentCall.agentPhase}</dd>
          </>
        )}

        {agentCall.messagesCount > 0 && (
          <>
            <dt className="text-muted-foreground">Messages</dt>
            <dd className="tabular-nums text-foreground">{agentCall.messagesCount}</dd>
          </>
        )}

        {agentCall.toolCallsCount > 0 && (
          <>
            <dt className="text-muted-foreground">Tool calls</dt>
            <dd className="tabular-nums text-foreground">{agentCall.toolCallsCount}</dd>
          </>
        )}

        {agentCall.currentToolName && (
          <>
            <dt className="text-muted-foreground">Current tool</dt>
            <dd className="text-foreground">{agentCall.currentToolName}</dd>
          </>
        )}

        {agentCall.tokensConsumed > BZ && (
          <>
            <dt className="text-muted-foreground">Tokens</dt>
            <dd className="tabular-nums text-foreground">{formatTokenCount(agentCall.tokensConsumed)}</dd>
          </>
        )}

        {agentCall.costMicros > BZ && (
          <>
            <dt className="text-muted-foreground">Cost</dt>
            <dd className="tabular-nums text-foreground">{formatMicroUsd(agentCall.costMicros)}</dd>
          </>
        )}
      </dl>

      {agentCall.error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2" role="alert">
          <p className="text-xs text-destructive">{agentCall.error}</p>
        </div>
      )}

      {/* Launch actions — only when the child id exists (a run that predates
          id registration, or an event-empty run without the snapshot
          fallback, has nothing to open). */}
      {hasChildId && (onOpenAgentExecution || onNavigateToAgentExecution) && (
        <div className="flex flex-wrap items-center gap-2">
          {onOpenAgentExecution && (
            <button
              type="button"
              onClick={() =>
                onOpenAgentExecution(agentCall.childExecutionId, taskName)
              }
              className="rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open agent execution
            </button>
          )}
          {onNavigateToAgentExecution && (
            <button
              type="button"
              onClick={() => onNavigateToAgentExecution(agentCall.childExecutionId)}
              className="rounded border border-border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Open standalone
            </button>
          )}
        </div>
      )}
    </div>
  );
});
