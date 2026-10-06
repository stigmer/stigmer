"use client";

import { useCallback, useEffect, useState } from "react";
import {
  WorkflowRunViewer,
  useResolveAgentRunSession,
  useActiveOrgId,
  useOrgSlugForId,
  ManageAccessButton,
} from "@stigmer/react";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { useSessionNavigation } from "@/domain/session/session-navigation";

interface WorkflowExecutionDetailPageProps {
  readonly executionId: string;
  readonly org?: string;
}

/**
 * Console page shell for the workflow run viewer.
 *
 * Thin wrapper around `WorkflowRunViewer` from `@stigmer/react`
 * that wires Console-specific concerns:
 * - `onNavigateToAgentRun` → resolves aex_* to session ID, then
 *   navigates via SessionNavigationProvider
 * - `onNavigateToWorkflowEditor` → navigates to workflow detail page
 *   with the suggested YAML (for AI diagnosis "Apply Fix")
 * - `org` → sourced from the active organization context so the
 *   Diagnose button appears on failed runs
 *
 * The viewer component handles all data fetching, streaming, and rendering.
 */
export function WorkflowRunDetailPage({
  executionId,
  org: orgProp,
}: WorkflowExecutionDetailPageProps) {
  const { navigateToSession } = useSessionNavigation();
  const orgId = useActiveOrgId();
  const org = orgProp ?? orgId;
  const slugForOrg = useOrgSlugForId();

  const [pendingAgentExecutionId, setPendingAgentExecutionId] = useState<string | null>(null);

  const { sessionId, isLoading: isResolving } = useResolveAgentRunSession(pendingAgentExecutionId);

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
      const targetOrg = slugForOrg(org ?? "");
      // Hard load: the library detail route is dynamic, and in static
      // export the router cannot soft-navigate across zones to a
      // non-pre-rendered dynamic route (see library-navigation.tsx).
      window.location.href = `/library/workflows/${targetOrg}/${workflowSlug}`;
    },
    [org, slugForOrg],
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
      {/* key={executionId} remounts the viewer on run switch so all
          per-execution state (streamed events, selected task, comparison,
          graph fit/follow) resets cleanly — the `key` reset pattern the
          session viewer uses. FetchCacheProvider + useFetch cacheKey keep
          metadata instant on revisits, so the remount does not flash. */}
      <WorkflowRunViewer
        key={executionId}
        runId={executionId}
        org={org}
        onNavigateToAgentRun={handleNavigateToAgentExecution}
        onNavigateToWorkflowEditor={handleNavigateToWorkflowEditor}
        headerActions={
          <ManageAccessButton
            resource={{
              kind: ApiResourceKind.workflow_run,
              kindString: "workflow_run",
              id: executionId,
              org: orgId,
            }}
          />
        }
        nodesDraggable
      />
    </div>
  );
}
