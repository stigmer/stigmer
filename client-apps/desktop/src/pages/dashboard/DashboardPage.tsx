import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  WorkflowDashboard,
  CostByWorkflowChart,
  ExecutionTrendChart,
  useWorkflowDashboardSummary,
  useActiveOrgSlug,
} from "@stigmer/react";

export default function DashboardPage() {
  const org = useActiveOrgSlug();
  const navigate = useNavigate();

  const { summary, isLoading: summaryLoading } =
    useWorkflowDashboardSummary({
      org,
      refetchInterval: 60_000,
    });

  const handleExecutionNav = useCallback(
    (executionId: string) => {
      navigate(`/executions/${executionId}`);
    },
    [navigate],
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational overview of workflow executions across your organization.
        </p>
      </div>

      <WorkflowDashboard
        org={org}
        onApprovalClick={handleExecutionNav}
        onFailedRunClick={handleExecutionNav}
        className="mb-8"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <CostByWorkflowChart
            breakdowns={summary?.costByWorkflow ?? []}
            isLoading={summaryLoading}
          />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <ExecutionTrendChart
            summary={summary ?? null}
            isLoading={summaryLoading}
          />
        </div>
      </div>
    </div>
  );
}
