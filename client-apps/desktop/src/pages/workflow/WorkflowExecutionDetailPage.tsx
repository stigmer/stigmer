import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { WorkflowExecutionViewer, useResolveAgentExecutionSession, useWorkflowExecution } from "@stigmer/react";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { useRunner } from "../../hooks/EmbeddedRunnerContext";

const TERMINAL_PHASES = new Set([
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
]);

export default function WorkflowExecutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const org = searchParams.get("org") ?? undefined;
  const navigate = useNavigate();
  const [pendingAgentExecutionId, setPendingAgentExecutionId] = useState<string | null>(null);
  const { removeWorkflowExecution } = useRunner();
  const { execution } = useWorkflowExecution(id ?? "");
  const cleanedUpRef = useRef(false);

  const { sessionId, isLoading: isResolving } = useResolveAgentExecutionSession(pendingAgentExecutionId);

  useEffect(() => {
    if (sessionId) {
      navigate(`/sessions/${sessionId}`, { replace: true });
    }
  }, [sessionId, navigate]);

  useEffect(() => {
    const phase = execution?.status?.phase;
    if (id && phase && TERMINAL_PHASES.has(phase) && !cleanedUpRef.current) {
      cleanedUpRef.current = true;
      removeWorkflowExecution(id).catch((err) =>
        console.warn("[runner] Failed to remove workflow execution from runner:", err),
      );
    }
  }, [id, execution?.status?.phase, removeWorkflowExecution]);

  const handleNavigateToAgentExecution = useCallback(
    (agentExecutionId: string) => {
      setPendingAgentExecutionId(agentExecutionId);
    },
    [],
  );

  const handleNavigateToWorkflowEditor = useCallback(
    (_yaml: string, workflowSlug: string) => {
      const targetOrg = org ?? "";
      navigate(`/workflows/${targetOrg}/${workflowSlug}`);
    },
    [navigate, org],
  );

  if (!id) return null;

  return (
    <div className="flex h-[calc(100vh-var(--header-height,0px))] flex-col">
      {isResolving && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-50 flex justify-center">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-md">
            <div className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
            Navigating to session…
          </div>
        </div>
      )}
      <WorkflowExecutionViewer
        executionId={id}
        org={org}
        onNavigateToAgentExecution={handleNavigateToAgentExecution}
        onNavigateToWorkflowEditor={handleNavigateToWorkflowEditor}
      />
    </div>
  );
}
