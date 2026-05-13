"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { WorkflowExecutionViewer } from "@stigmer/react";

interface WorkflowExecutionDetailPageProps {
  readonly executionId: string;
}

/**
 * Console page shell for the workflow execution viewer.
 *
 * Thin wrapper around `WorkflowExecutionViewer` from `@stigmer/react`
 * that wires Console-specific concerns:
 * - `onNavigateToAgentExecution` → Next.js router navigation to session page
 *
 * The viewer component handles all data fetching, streaming, and rendering.
 */
export function WorkflowExecutionDetailPage({
  executionId,
}: WorkflowExecutionDetailPageProps) {
  const router = useRouter();

  const handleNavigateToAgentExecution = useCallback(
    (agentExecutionId: string) => {
      router.push(`/sessions?execution=${agentExecutionId}`);
    },
    [router],
  );

  return (
    <div className="-mx-6 -my-8 flex h-[calc(100vh-var(--header-height,64px))] flex-col">
      <WorkflowExecutionViewer
        executionId={executionId}
        onNavigateToAgentExecution={handleNavigateToAgentExecution}
      />
    </div>
  );
}
