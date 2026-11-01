// The dashboard: its figures alone, over a busy week's summary; and the
// whole dashboard as the console frames it (a centred column under the
// page's heading) for a busy organization and for one that has run nothing
// yet, answered from the calls its hooks make.
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import type { ConnectRouter } from "@connectrpc/connect";
import { RunSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { DashboardKPICards, OperationalDashboard } from "@stigmer/react-sdk";
import { sampleDate, samples } from "@stigmer/react-sdk/test";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { BUSY_WEEK_RUNS, BUSY_WEEK_USAGE, DASHBOARD_SUMMARY, EMPTY_USAGE, NO_RUNS, ORGANIZATION } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";

const ORG_ID = ORGANIZATION.metadata?.id ?? "";

export function dashboardScene(): Drawing {
  return { render: () => <DashboardKPICards summary={DASHBOARD_SUMMARY} isLoading={false} /> };
}

/** Which week the dashboard shows: a busy one, or an organization's first, with nothing run. */
export type DashboardWeek = "busy" | "new-org";

/** One failed run: what it was asked, the agent that ran it, why it failed, and when, `hoursAgo` before the samples' instant. */
function failedRun(id: string, name: string, agentId: string, error: string, hoursAgo: number): Run {
  const run = samples.run({ id, phase: RunPhase.RUN_FAILED, agentId });
  return create(RunSchema, {
    metadata: { id, name, org: ORG_ID },
    spec: run.spec,
    status: {
      phase: RunPhase.RUN_FAILED,
      error,
      agentId,
      audit: { specAudit: { createdAt: timestampFromDate(sampleDate(-hoursAgo * 3_600_000)) } },
    },
  });
}

/** The week's failed runs: two of the busy week's four on the first page, none for a new organization. */
function failedRuns(week: DashboardWeek): Run[] {
  if (week === "new-org") return [];
  return [
    failedRun("run_00000000000000000000000101", "Match the July receipts to the card statement", "receipt-matcher", "The card statement export was empty", 3),
    failedRun("run_00000000000000000000000102", "Reconcile the payroll clearing account", "ledger-reviewer", "The ledger server refused the read: its token expired", 27),
  ];
}

function dashboardRoutes(week: DashboardWeek) {
  return (router: ConnectRouter) => {
    router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
    router.service(RunQueryController, {
      getRunSummary: () => (week === "busy" ? BUSY_WEEK_RUNS : NO_RUNS),
      getOrgUsageReport: () => (week === "busy" ? BUSY_WEEK_USAGE : EMPTY_USAGE),
      list: () => samples.runList(failedRuns(week)),
    });
  };
}

/** The dashboard page, as the web console draws it. */
export function dashboardPageScene(week: DashboardWeek): Drawing {
  return {
    inOrganization: true,
    routes: dashboardRoutes(week),
    render: () => (
      <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ marginBottom: "2rem" }}>
          <h1 className="stg:text-xl stg:font-semibold stg:text-foreground">Dashboard</h1>
          <p className="stg:mt-1 stg:text-sm stg:text-muted-foreground">Operational overview across your organization.</p>
        </div>
        <OperationalDashboard org={ORG_ID} />
      </div>
    ),
  };
}
