"use client";

import { useEffect } from "react";
import { useResolveAgentExecutionSession } from "@stigmer/react";
import { WorkflowExecutionDetailPage } from "@/domain/workflow/WorkflowExecutionDetailPage";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";
import { useSessionNavigation } from "@/domain/session/session-navigation";

export async function generateStaticParams() {
  return [{ id: "__placeholder__" }];
}

/**
 * Unified execution route that auto-detects the execution type from
 * the ID prefix and renders the appropriate viewer.
 *
 * - `wex_*` IDs render the WorkflowExecutionViewer
 * - `aex_*` IDs resolve to their parent session and navigate there
 */
export default function ExecutionRoute() {
  const id = useStaticRouteParam("id");
  const { navigateToSession } = useSessionNavigation();

  const isAgentExecution = id?.startsWith("aex_") ?? false;
  const { sessionId } = useResolveAgentExecutionSession(isAgentExecution ? id : null);

  useEffect(() => {
    if (sessionId) {
      navigateToSession(sessionId);
    }
  }, [sessionId, navigateToSession]);

  if (!id || isAgentExecution) return null;

  return <WorkflowExecutionDetailPage executionId={id} />;
}
