"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ExternalLink, Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import {
  ExecutionStream,
  MessageInput,
  useAgentExecution,
  useApproval,
  isTerminalPhase,
} from "@stigmer/react/agent-execution";
import { cn } from "@stigmer/theme";
import { useDraftAgent } from "@/hooks/agents/useDraftAgent";
import { useActiveOrgSlug } from "@/contexts/org-context";
import { Button } from "@/components/ui/button";
import type { DraftConfig } from "@/config/draft";

// ---------------------------------------------------------------------------
// State machine
// ---------------------------------------------------------------------------

type DraftState = "resolving" | "ready" | "running" | "completed" | "error";

function deriveDraftState(
  isResolving: boolean,
  agentError: string | null,
  agent: Agent | null,
  hasExecution: boolean,
  phase: ExecutionPhase,
): DraftState {
  if (agentError) return "error";
  if (isResolving || !agent) return "resolving";
  if (!hasExecution) return "ready";
  if (!isTerminalPhase(phase)) return "running";
  return "completed";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DraftPage({ config }: { config: DraftConfig }) {
  const org = useActiveOrgSlug();
  const {
    agent,
    isResolving,
    error: agentError,
    retry,
  } = useDraftAgent(config.agentSlug);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const {
    execution,
    phase,
    isConnected,
    error: executionError,
    start,
  } = useAgentExecution();

  const hasExecution = execution !== null;
  const state = deriveDraftState(
    isResolving,
    agentError,
    agent,
    hasExecution,
    phase,
  );

  const executionId = execution?.metadata?.id ?? "";
  const { submit: submitApproval, isSubmitting: isApprovalSubmitting } =
    useApproval({ executionId });

  // Capture session ID from the first execution response so follow-up
  // messages create new executions within the same session.
  const captureSessionId = useCallback(() => {
    if (execution?.spec?.sessionId) {
      setSessionId(execution.spec.sessionId);
    }
  }, [execution?.spec?.sessionId]);

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
      if (!agent?.metadata?.id) return;
      start({
        agentId: agent.metadata.id,
        org,
        message,
      });
    },
    [agent, org, start],
  );

  const handleFollowUp = useCallback(
    (message: string) => {
      if (!agent?.metadata?.id) return;
      start({
        agentId: agent.metadata.id,
        org,
        sessionId: sessionId ?? undefined,
        message,
      });
    },
    [agent, org, sessionId, start],
  );

  const handleApproval = useCallback(
    async (toolCallId: string, action: ApprovalAction, comment?: string) => {
      await submitApproval(toolCallId, action, comment);
    },
    [submitApproval],
  );

  const Icon = config.icon;
  const showInput = state === "resolving" || state === "ready";
  const showExecution = state === "running" || state === "completed";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b px-6 py-4">
        <Icon className="text-primary size-5" />
        <div>
          <h1 className="text-lg font-semibold">{config.title}</h1>
          <p className="text-muted-foreground text-sm">{config.description}</p>
        </div>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Error: system agent not found */}
        {state === "error" && (
          <div className="mx-auto w-full max-w-2xl p-6">
            <div className="border-destructive/30 bg-destructive/5 flex items-start gap-3 rounded-lg border p-4">
              <AlertCircle className="text-destructive mt-0.5 size-5 shrink-0" />
              <div className="flex-1 space-y-2">
                <p className="text-destructive text-sm font-medium">
                  Unable to resolve system agent
                </p>
                <p className="text-muted-foreground text-sm">
                  The <span className="font-mono">{config.agentSlug}</span>{" "}
                  agent could not be found. Ensure the Stigmer seedpack has been
                  applied to the platform.
                </p>
                <Button variant="outline" size="sm" onClick={retry}>
                  <RefreshCw className="mr-1.5 size-3.5" />
                  Retry
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Resolving + Ready: message input */}
        {showInput && (
          <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
            {/* Agent resolution status */}
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              {state === "resolving" ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>
                    Resolving{" "}
                    <span className="font-mono">{config.agentSlug}</span>...
                  </span>
                </>
              ) : (
                <>
                  <span className="size-1.5 rounded-full bg-green-500" />
                  <span>{agent?.metadata?.name ?? config.agentSlug}</span>
                </>
              )}
            </div>

            <MessageInput
              onSend={handleRun}
              disabled={state === "resolving"}
              placeholder={config.inputPlaceholder}
            />
          </div>
        )}

        {/* Running + Completed: execution stream */}
        {showExecution && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <SystemAgentBanner
              agent={agent}
              agentSlug={config.agentSlug}
              sessionId={state === "completed" ? sessionId : null}
            />

            <ExecutionStream
              execution={execution}
              phase={phase}
              isConnected={isConnected}
              error={executionError}
              onApproval={handleApproval}
              isApprovalSubmitting={isApprovalSubmitting}
              onSendMessage={state === "completed" ? handleFollowUp : undefined}
              className="flex-1 overflow-hidden"
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// System agent banner — compact summary shown during execution
// ---------------------------------------------------------------------------

function SystemAgentBanner({
  agent,
  agentSlug,
  sessionId,
}: {
  agent: Agent | null;
  agentSlug: string;
  sessionId: string | null;
}) {
  const name = agent?.metadata?.name ?? agentSlug;

  return (
    <div
      className={cn(
        "bg-muted/30 flex items-center gap-2 border-b px-4 py-2 text-sm",
      )}
    >
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground text-xs">System Agent</span>
      <span className="flex-1" />
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
