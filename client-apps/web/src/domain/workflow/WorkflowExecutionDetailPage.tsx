"use client";

import { useCallback, useEffect, useState } from "react";
import {
  WorkflowExecutionViewer,
  useResolveAgentExecutionSession,
  useActiveOrgSlug,
  useActiveOrgId,
  SharePanel,
  PermissionGate,
} from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { Button } from "@/domain/_shared/ui/button";
import { useSessionNavigation } from "@/domain/session/session-navigation";

interface WorkflowExecutionDetailPageProps {
  readonly executionId: string;
  readonly org?: string;
}

/**
 * Console page shell for the workflow execution viewer.
 *
 * Thin wrapper around `WorkflowExecutionViewer` from `@stigmer/react`
 * that wires Console-specific concerns:
 * - `onNavigateToAgentExecution` → resolves aex_* to session ID, then
 *   navigates via SessionNavigationProvider
 * - `onNavigateToWorkflowEditor` → navigates to workflow detail page
 *   with the suggested YAML (for AI diagnosis "Apply Fix")
 * - `org` → sourced from the active organization context so the
 *   Diagnose button appears on failed executions
 *
 * The viewer component handles all data fetching, streaming, and rendering.
 */
export function WorkflowExecutionDetailPage({
  executionId,
  org: orgProp,
}: WorkflowExecutionDetailPageProps) {
  const { navigateToSession } = useSessionNavigation();
  const activeOrg = useActiveOrgSlug();
  const org = orgProp ?? activeOrg;

  const [pendingAgentExecutionId, setPendingAgentExecutionId] = useState<string | null>(null);

  const { sessionId, isLoading: isResolving } = useResolveAgentExecutionSession(pendingAgentExecutionId);

  useEffect(() => {
    if (sessionId) {
      navigateToSession(sessionId);
    }
  }, [sessionId, navigateToSession]);

  const handleNavigateToAgentExecution = useCallback(
    (agentExecutionId: string) => {
      setPendingAgentExecutionId(agentExecutionId);
    },
    [],
  );

  const handleNavigateToWorkflowEditor = useCallback(
    (_yaml: string, workflowSlug: string) => {
      const targetOrg = org ?? "";
      window.location.href = `/workflows/${targetOrg}/${workflowSlug}`;
    },
    [org],
  );

  return (
    <div className="relative flex h-full w-full flex-col">
      {isResolving && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-50 flex justify-center">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-md">
            <div className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
            Navigating to session…
          </div>
        </div>
      )}
      {/* key={executionId} remounts the viewer on execution switch so all
          per-execution state (streamed events, selected task, comparison,
          graph fit/follow) resets cleanly — the DD-014 pattern used by the
          session viewer. FetchCacheProvider + useFetch cacheKey keep
          metadata instant on revisits, so the remount does not flash. */}
      <WorkflowExecutionViewer
        key={executionId}
        executionId={executionId}
        org={org}
        onNavigateToAgentExecution={handleNavigateToAgentExecution}
        onNavigateToWorkflowEditor={handleNavigateToWorkflowEditor}
        headerActions={<ShareActions executionId={executionId} />}
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
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowSharePanel((v) => !v)}
        aria-label="Share execution"
        aria-expanded={showSharePanel}
      >
        Share
      </Button>
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
