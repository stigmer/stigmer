"use client";

import { useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { AlertCircle, MessageSquare, Loader2 } from "lucide-react";
import { Breadcrumb } from "@/components/layout/Breadcrumb";
import { ErrorMessage } from "@/components/ui/error-message";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ApprovalAction } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import {
  ExecutionStream,
  MessageEntry,
  HumanMessageBubble,
  MessageInput,
  useAgentExecution,
  useApproval,
  buildSubAgentIndex,
  isTerminalPhase,
} from "@stigmer/agent-execution";
import { useSession } from "@/hooks/sessions/useSession";
import { useSessionExecutions } from "@/hooks/sessions/useSessionExecutions";
import { Separator } from "@/components/ui/separator";
import { formatRelativeTime } from "@/lib/time";

// ---------------------------------------------------------------------------
// Page state
// ---------------------------------------------------------------------------

type PageState = "loading" | "error" | "history" | "streaming";

function derivePageState(
  isLoading: boolean,
  error: Error | null,
  livePhase: ExecutionPhase,
  hasLiveExecution: boolean,
): PageState {
  if (isLoading) return "loading";
  if (error) return "error";
  if (hasLiveExecution && !isTerminalPhase(livePhase)) return "streaming";
  return "history";
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();

  const {
    data: session,
    isLoading: isSessionLoading,
    error: sessionQueryError,
    refetch: refetchSession,
  } = useSession(id);

  const {
    data: executionList,
    isLoading: isExecutionsLoading,
    error: executionsQueryError,
    refetch: refetchExecutions,
  } = useSessionExecutions(id);

  const executions = executionList?.entries ?? [];
  const lastExecution =
    executions.length > 0 ? executions[executions.length - 1] : null;
  const lastPhase =
    lastExecution?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
  const activeExecution =
    lastExecution && !isTerminalPhase(lastPhase) ? lastExecution : null;
  const pastExecutions = activeExecution ? executions.slice(0, -1) : executions;

  const queryError = sessionQueryError ?? executionsQueryError ?? null;

  const activeExecutionId = activeExecution?.metadata?.id;

  const {
    execution: liveExecution,
    phase: livePhase,
    isConnected,
    error: streamError,
    start,
  } = useAgentExecution(
    activeExecutionId ? { executionId: activeExecutionId } : undefined,
  );

  const effectiveExecution = liveExecution ?? activeExecution;
  const effectivePhase = liveExecution
    ? livePhase
    : (activeExecution?.status?.phase ??
      ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED);
  const hasLiveExecution = effectiveExecution !== null;

  const executionId = effectiveExecution?.metadata?.id ?? "";
  const { submit: submitApproval, isSubmitting: isApprovalSubmitting } =
    useApproval({ executionId });

  const isDataLoading = isSessionLoading || isExecutionsLoading;
  const combinedError =
    queryError ?? (streamError ? new Error(streamError) : null);
  const pageState = derivePageState(
    isDataLoading,
    combinedError,
    effectivePhase,
    hasLiveExecution && !isTerminalPhase(effectivePhase),
  );

  const retryQueries = useCallback(() => {
    refetchSession();
    refetchExecutions();
  }, [refetchSession, refetchExecutions]);

  const sessionId = session?.metadata?.id ?? id;
  const displayName =
    session?.spec?.subject || session?.metadata?.name || "Session";

  const handleFollowUp = useCallback(
    (message: string) => {
      start({
        sessionId,
        message,
        org: session?.metadata?.org ?? "",
      });
    },
    [sessionId, session?.metadata?.org, start],
  );

  const handleApproval = useCallback(
    async (toolCallId: string, action: ApprovalAction, comment?: string) => {
      await submitApproval(toolCallId, action, comment);
    },
    [submitApproval],
  );

  return (
    <div className="flex h-full flex-col">
      {/* ── Header ── */}
      <div className="space-y-1 border-b px-6 py-4">
        <Breadcrumb
          items={[
            { label: "Sessions", href: "/sessions" },
            { label: displayName },
          ]}
        />
        <h1 className="truncate text-lg font-semibold">{displayName}</h1>
        {session?.status?.audit?.specAudit?.createdAt && (
          <p className="text-muted-foreground text-sm">
            Started{" "}
            {formatRelativeTime(session.status.audit.specAudit.createdAt)}
          </p>
        )}
      </div>

      {/* ── Content ── */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {pageState === "loading" && (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="text-muted-foreground size-6 animate-spin" />
          </div>
        )}

        {pageState === "error" && (
          <div className="p-6">
            <ErrorMessage error={combinedError} retry={retryQueries} />
          </div>
        )}

        {(pageState === "history" || pageState === "streaming") && (
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
              <div className="space-y-4 p-6">
                {/* ── Past executions: read-only conversation thread ── */}
                {pastExecutions.map((exec, execIndex) => (
                  <PastExecutionThread
                    key={exec.metadata?.id ?? execIndex}
                    execution={exec}
                    showSeparator={execIndex > 0}
                  />
                ))}

                {/* ── Separator before active/streaming execution ── */}
                {pastExecutions.length > 0 && hasLiveExecution && (
                  <ExecutionBoundary />
                )}

                {/* ── Active execution: live stream ── */}
                {hasLiveExecution && (
                  <ExecutionStream
                    execution={effectiveExecution}
                    phase={effectivePhase}
                    isConnected={isConnected}
                    error={streamError}
                    onApproval={handleApproval}
                    isApprovalSubmitting={isApprovalSubmitting}
                    className="min-h-0"
                  />
                )}

                {/* ── Empty session ── */}
                {pastExecutions.length === 0 && !hasLiveExecution && (
                  <div className="flex flex-col items-center gap-3 py-12 text-center">
                    <MessageSquare className="text-muted-foreground/30 size-8" />
                    <p className="text-muted-foreground text-sm">
                      No messages in this session yet
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* ── Follow-up input ── */}
            {pageState === "history" && (
              <div className="border-t p-4">
                <MessageInput
                  onSend={handleFollowUp}
                  placeholder="Continue the conversation..."
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Past execution thread — read-only message rendering
// ---------------------------------------------------------------------------

function PastExecutionThread({
  execution,
  showSeparator,
}: {
  execution: AgentExecution;
  showSeparator: boolean;
}) {
  const messages = execution.status?.messages ?? [];
  const phase =
    execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;

  const subAgentIndex = useMemo(
    () => buildSubAgentIndex(execution),
    [execution],
  );

  return (
    <>
      {showSeparator && <ExecutionBoundary />}

      {/* Initial user message when messages array doesn't contain a HUMAN entry */}
      {messages.length === 0 && execution.spec?.message && (
        <HumanMessageBubble content={execution.spec.message} />
      )}

      {messages.map((msg, index) => (
        <MessageEntry key={index} message={msg} subAgentIndex={subAgentIndex} />
      ))}

      {/* Execution error */}
      {execution.status?.error && isTerminalPhase(phase) && (
        <div className="border-destructive/30 bg-destructive/5 text-destructive flex items-start gap-2 rounded-lg border p-3 text-sm">
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <p>{execution.status.error}</p>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Execution boundary separator
// ---------------------------------------------------------------------------

function ExecutionBoundary() {
  return (
    <div className="flex items-center gap-3 py-2">
      <Separator className="flex-1" />
      <span className="text-muted-foreground/50 text-xs">continued</span>
      <Separator className="flex-1" />
    </div>
  );
}
