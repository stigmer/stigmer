"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Play, ExternalLink } from "lucide-react";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  AgentPicker,
  type SelectedAgent,
} from "@/components/agent/AgentPicker";
import {
  ExecutionStream,
  MessageInput,
  useAgentExecution,
  useApproval,
  isTerminalPhase,
} from "@stigmer/agent-execution";
import { cn } from "@stigmer/theme";
import { useActiveOrgSlug } from "@/contexts/org-context";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

// ---------------------------------------------------------------------------
// Page state
// ---------------------------------------------------------------------------

type PageState = "idle" | "ready" | "running" | "completed";

function derivePageState(
  selected: SelectedAgent | null,
  phase: ExecutionPhase,
  hasExecution: boolean,
): PageState {
  if (!selected && !hasExecution) return "idle";
  if (selected && !hasExecution) return "ready";
  if (hasExecution && !isTerminalPhase(phase)) return "running";
  return "completed";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RunAgentPage() {
  const org = useActiveOrgSlug();
  const [selectedAgent, setSelectedAgent] = useState<SelectedAgent | null>(
    null,
  );
  const [sessionId, setSessionId] = useState<string | null>(null);

  const { execution, phase, isConnected, error, start } = useAgentExecution();
  const hasExecution = execution !== null;
  const pageState = derivePageState(selectedAgent, phase, hasExecution);

  const executionId = execution?.metadata?.id ?? "";
  const { submit: submitApproval, isSubmitting: isApprovalSubmitting } =
    useApproval({ executionId });

  // Track the session ID from the first execution's response so follow-up
  // messages create new executions within the same session.
  const captureSessionId = useCallback(() => {
    if (execution?.spec?.sessionId) {
      setSessionId(execution.spec.sessionId);
    }
  }, [execution?.spec?.sessionId]);

  // Capture session ID whenever the execution transitions to a terminal phase.
  if (
    hasExecution &&
    isTerminalPhase(phase) &&
    !sessionId &&
    execution?.spec?.sessionId
  ) {
    captureSessionId();
  }

  const handleRun = useCallback(
    (message: string) => {
      if (!selectedAgent) return;
      start({
        agentId: selectedAgent.id,
        org,
        message,
      });
    },
    [selectedAgent, org, start],
  );

  const handleFollowUp = useCallback(
    (message: string) => {
      if (!selectedAgent) return;
      start({
        agentId: selectedAgent.id,
        org,
        sessionId: sessionId ?? undefined,
        message,
      });
    },
    [selectedAgent, org, sessionId, start],
  );

  const handleApproval = useCallback(
    async (toolCallId: string, action: ApprovalAction, comment?: string) => {
      await submitApproval(toolCallId, action, comment);
    },
    [submitApproval],
  );

  const handleClearAgent = useCallback(() => {
    setSelectedAgent(null);
  }, []);

  const showPicker = pageState === "idle" || pageState === "ready";
  const showInitialInput = pageState === "ready";
  const showExecution = pageState === "running" || pageState === "completed";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Play className="text-primary size-5" />
        <div>
          <h1 className="text-lg font-semibold">Run Agent</h1>
          <p className="text-muted-foreground text-sm">
            Select an agent and start a new execution
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Agent picker + initial message — shown before execution starts */}
        {showPicker && (
          <div className="mx-auto w-full max-w-2xl space-y-6 p-6">
            <AgentPicker
              selected={selectedAgent}
              onSelect={setSelectedAgent}
              onClear={handleClearAgent}
            />

            {showInitialInput && (
              <div className="space-y-3">
                <label className="text-muted-foreground text-sm font-medium">
                  Message
                </label>
                <MessageInput
                  onSend={handleRun}
                  placeholder="What would you like this agent to do?"
                />
              </div>
            )}
          </div>
        )}

        {/* Execution stream — shown once an execution is in progress */}
        {showExecution && (
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Compact agent banner + session link */}
            <AgentBanner
              agent={selectedAgent}
              sessionId={pageState === "completed" ? sessionId : null}
            />

            <ExecutionStream
              execution={execution}
              phase={phase}
              isConnected={isConnected}
              error={error}
              onApproval={handleApproval}
              isApprovalSubmitting={isApprovalSubmitting}
              onSendMessage={
                pageState === "completed" ? handleFollowUp : undefined
              }
              className="flex-1 overflow-hidden"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent banner — compact summary shown during execution
// ---------------------------------------------------------------------------

function AgentBanner({
  agent,
  sessionId,
}: {
  agent: SelectedAgent | null;
  sessionId: string | null;
}) {
  if (!agent) return null;

  return (
    <div
      className={cn(
        "bg-muted/30 flex items-center gap-2 border-b px-4 py-2 text-sm",
      )}
    >
      <span className="font-medium">{agent.name}</span>
      <span className="text-muted-foreground flex-1">
        {agent.qualifiedSlug}
      </span>
      {sessionId && (
        <Link
          href={`/sessions/${sessionId}`}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs transition-colors"
        >
          View session
          <ExternalLink className="size-3" />
        </Link>
      )}
    </div>
  );
}
