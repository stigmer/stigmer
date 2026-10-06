import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useOrg, OperationalDashboard } from "@stigmer/react";

export default function DashboardPage() {
  const { activeOrg } = useOrg();
  const org = activeOrg?.metadata?.id ?? "";
  const navigate = useNavigate();

  const handleFailedRunClick = useCallback(
    (id: string) => {
      navigate(`/runs/${id}`);
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

      <OperationalDashboard org={org} onFailedRunClick={handleFailedRunClick} />
    </div>
  );
}
