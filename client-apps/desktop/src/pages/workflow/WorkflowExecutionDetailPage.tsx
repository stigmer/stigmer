import { useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { WorkflowExecutionViewer } from "@stigmer/react";

export default function WorkflowExecutionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const handleNavigateToAgentExecution = useCallback(
    (agentExecutionId: string) => {
      navigate(`/sessions/${agentExecutionId}`);
    },
    [navigate],
  );

  if (!id) return null;

  return (
    <div className="flex h-[calc(100vh-var(--header-height,0px))] flex-col">
      <WorkflowExecutionViewer
        executionId={id}
        onNavigateToAgentExecution={handleNavigateToAgentExecution}
      />
    </div>
  );
}
