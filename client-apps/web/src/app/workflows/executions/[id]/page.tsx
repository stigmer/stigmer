import { WorkflowExecutionDetailPage } from "@/domain/workflow/WorkflowExecutionDetailPage";

export default function ExecutionDetailRoute({
  params,
}: {
  params: { id: string };
}) {
  return <WorkflowExecutionDetailPage executionId={params.id} />;
}
