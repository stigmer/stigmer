import { useCallback, useEffect, useState } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import {
  WorkflowExecutionViewer,
  useResolveAgentExecutionSession,
  useActiveOrgId,
  SharePanel,
  PermissionGate,
} from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

export default function WorkflowExecutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const org = searchParams.get("org") ?? undefined;
  const navigate = useNavigate();
  const [pendingAgentExecutionId, setPendingAgentExecutionId] = useState<string | null>(null);

  const { sessionId, isLoading: isResolving } = useResolveAgentExecutionSession(pendingAgentExecutionId);

  useEffect(() => {
    if (sessionId) {
      navigate(`/sessions/${sessionId}`, { replace: true });
    }
  }, [sessionId, navigate]);

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
      {/* key={id} remounts the viewer on execution switch so all
          per-execution state (streamed events, selected task, comparison,
          graph fit/follow) resets cleanly — the DD-014 pattern used by the
          session viewer. FetchCacheProvider + useFetch cacheKey keep
          metadata instant on revisits, so the remount does not flash. */}
      <WorkflowExecutionViewer
        key={id}
        executionId={id}
        org={org}
        onNavigateToAgentExecution={handleNavigateToAgentExecution}
        onNavigateToWorkflowEditor={handleNavigateToWorkflowEditor}
        headerActions={<ShareActions executionId={id} />}
        nodesDraggable
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Share actions — kept in the client app (DD-004: no Console auth in SDK)
// ---------------------------------------------------------------------------

function ShareActions({ executionId }: { executionId: string }) {
  const [showSharePanel, setShowSharePanel] = useState(false);
  const orgId = useActiveOrgId();

  return (
    <PermissionGate
      resource={{ kind: "workflow_execution", id: executionId }}
      relation="can_grant_access"
    >
      <button
        type="button"
        onClick={() => setShowSharePanel((v) => !v)}
        aria-label="Share execution"
        aria-expanded={showSharePanel}
        className="rounded-md px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent-hover"
      >
        Share
      </button>
      {showSharePanel && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-border bg-popover shadow-lg">
          <SharePanel
            resource={{
              kind: "workflow_execution",
              id: executionId,
              resourceKind: ApiResourceKind.workflow_execution,
            }}
            resourceKindString="workflow_execution"
            resourceKind={ApiResourceKind.workflow_execution}
            orgId={orgId}
            onClose={() => setShowSharePanel(false)}
          />
        </div>
      )}
    </PermissionGate>
  );
}
