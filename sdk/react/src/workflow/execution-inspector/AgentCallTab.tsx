"use client";

import { memo } from "react";
import { cn } from "@stigmer/theme";
import type { TaskDetailAgentCall } from "./derive-task-detail";
import { formatMicroUsd, formatTokenCount } from "../format-utils";

export interface AgentCallTabProps {
  readonly agentCall: TaskDetailAgentCall;
  readonly onNavigateToAgentExecution?: (id: string) => void;
  readonly className?: string;
}

export const AgentCallTab = memo(function AgentCallTab({
  agentCall,
  onNavigateToAgentExecution,
  className,
}: AgentCallTabProps) {
  const BZ = BigInt(0);
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
