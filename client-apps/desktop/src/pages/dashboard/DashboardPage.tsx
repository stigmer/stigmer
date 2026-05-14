import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  useOrg,
  OperationalDashboard,
  CostByWorkflowChart,
  ExecutionTrendChart,
  useWorkflowDashboardSummary,
  type DashboardFailedRun,
} from "@stigmer/react";

export default function DashboardPage() {
  const { activeOrg } = useOrg();
  const org = activeOrg?.metadata?.slug ?? "";
  const orgId = activeOrg?.metadata?.id;
  const navigate = useNavigate();

  const { summary: workflowSummary, isLoading: workflowSummaryLoading } =
    useWorkflowDashboardSummary({ org, refetchInterval: 60_000 });

  const handleApprovalClick = useCallback(
    (executionId: string) => {
      navigate(`/executions/${executionId}`);
    },
    [navigate],
  );

  const handleFailedRunClick = useCallback(
    (id: string, _type: DashboardFailedRun["type"]) => {
      navigate(`/executions/${id}`);
    },
    [navigate],
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8">
        <h1 className="text-xl font-semibold text-foreground">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Operational overview across your organization.
        </p>
      </div>

      <OperationalDashboard
        org={org}
        orgId={orgId}
        onApprovalClick={handleApprovalClick}
        onFailedRunClick={handleFailedRunClick}
        className="mb-8"
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <CostByWorkflowChart
            breakdowns={workflowSummary?.costByWorkflow ?? []}
            isLoading={workflowSummaryLoading}
          />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <ExecutionTrendChart
            summary={workflowSummary ?? null}
            isLoading={workflowSummaryLoading}
          />
        </div>
      </div>
    </div>
  );
}
