"use client";

import { memo, useMemo } from "react";
import { cn } from "@stigmer/theme";
import type { TaskDetailAgentCall } from "./derive-task-detail.js";
import type { DerivedTaskState } from "../../internal/store/workflow-execution-event-store.js";
import { formatMicroUsd, formatTokenCount } from "../format-utils.js";
import { useExecutionStream } from "../../execution/useExecutionStream.js";
import { useConversationStoreRef } from "../../internal/store/index.js";
import { MessageThread } from "../../execution/MessageThread.js";

export interface AgentCallTabProps {
  readonly agentCall: TaskDetailAgentCall;
  readonly taskStatus?: DerivedTaskState["status"];
  readonly isTabActive?: boolean;
  readonly onNavigateToAgentExecution?: (id: string) => void;
  readonly className?: string;
}

/**
 * Agent Call tab in the execution inspector.
 *
 * When the task is running and childExecutionId is known, subscribes to
 * the child AgentExecution stream and renders a live MessageThread.
 * When complete or ID is unavailable, shows a static summary.
 *
 * Subscription lifecycle follows DD-LIVE-006: only subscribes when the tab
 * is active and the task is running. Unsubscribes on unmount or deactivation.
 */
export const AgentCallTab = memo(function AgentCallTab({
  agentCall,
  taskStatus,
  isTabActive = true,
  onNavigateToAgentExecution,
  className,
}: AgentCallTabProps) {
  const isRunning = taskStatus === "running" || taskStatus === "waiting_approval";
  const hasChildId = !!agentCall.childExecutionId;
  const shouldSubscribe = isTabActive && isRunning && hasChildId;

  const effectiveId = shouldSubscribe ? agentCall.childExecutionId : null;
  const store = useConversationStoreRef();
  const { execution: streamExecution, isStreaming, isConnecting, error: streamError } =
    useExecutionStream(effectiveId, { store });

  const emptyExecutions = useMemo(() => [] as const, []);

  const BZ = BigInt(0);

  if (isRunning && hasChildId) {
    return (
      <div className={cn("flex flex-col gap-2", className)}>
        {/* Stream status bar */}
        <div className="flex items-center gap-2 text-[11px]">
          {isConnecting && (
            <span className="text-muted-foreground">Connecting to agent stream...</span>
          )}
          {isStreaming && (
            <span className="text-primary">
              <span className="mr-1 inline-block size-1.5 animate-pulse rounded-full bg-primary" />
              Live
            </span>
          )}
          {streamError && (
            <span className="text-destructive">Stream error</span>
          )}
          <span className="ml-auto text-muted-foreground">{agentCall.agentSlug}</span>
        </div>

        {/* Live message transcript */}
        <div className="min-h-0 flex-1 overflow-y-auto rounded border border-border">
          <MessageThread
            executions={emptyExecutions}
            activeStreamExecution={streamExecution ?? undefined}
            className="max-h-[50vh]"
          />
        </div>

        {/* Navigation link */}
        {onNavigateToAgentExecution && (
          <button
            type="button"
            onClick={() => onNavigateToAgentExecution(agentCall.childExecutionId)}
            className="self-start rounded border border-border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-muted"
          >
            Open Full Session
          </button>
        )}
      </div>
    );
  }

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
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted-foreground">Agent</dt>
        <dd className="font-medium text-foreground">{agentCall.agentSlug}</dd>

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

      {onNavigateToAgentExecution && agentCall.childExecutionId && (
        <button
          type="button"
          onClick={() => onNavigateToAgentExecution(agentCall.childExecutionId)}
          className="self-start rounded border border-border px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-muted"
        >
          View Agent Execution
        </button>
      )}
    </div>
  );
});
