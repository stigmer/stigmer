"use client";

import { useCallback, useEffect, useState } from "react";
import { WorkflowExecutionViewer, useResolveAgentExecutionSession } from "@stigmer/react";
import { useSessionNavigation } from "@/domain/session/session-navigation";

interface WorkflowExecutionDetailPageProps {
  readonly executionId: string;
}

/**
 * Console page shell for the workflow execution viewer.
 *
 * Thin wrapper around `WorkflowExecutionViewer` from `@stigmer/react`
 * that wires Console-specific concerns:
 * - `onNavigateToAgentExecution` → resolves aex_* to session ID, then
 *   navigates via SessionNavigationProvider
 *
 * The viewer component handles all data fetching, streaming, and rendering.
 */
export function WorkflowExecutionDetailPage({
  executionId,
}: WorkflowExecutionDetailPageProps) {
  const { navigateToSession } = useSessionNavigation();
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

  return (
    <div className="-mx-6 -my-8 flex h-[calc(100vh-var(--header-height,64px))] flex-col">
      {isResolving && (
        <div className="pointer-events-none absolute inset-x-0 top-4 z-50 flex justify-center">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2 text-sm text-muted-foreground shadow-md">
            <div className="size-4 animate-spin rounded-full border-2 border-muted border-t-primary" />
            Navigating to session…
          </div>
        </div>
      )}
      <WorkflowExecutionViewer
        executionId={executionId}
        onNavigateToAgentExecution={handleNavigateToAgentExecution}
      />
    </div>
  );
}
