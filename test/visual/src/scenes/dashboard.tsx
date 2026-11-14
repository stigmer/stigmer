// The dashboard: its figures alone, over a busy week's summary; and the
// whole dashboard as the console frames it (a centred column under the
// page's heading) for a busy organization, as a member sees it (the
// figures and failures alone: the journey's card is its admins'), and for one that has run nothing yet, as its admin
// sees it (the journey's card alone, nothing made yet), answered from the
// calls its hooks make. The journey's other states are journey.tsx's.
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { RunSchema, type Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { DashboardKPICards, OperationalDashboard, PageHeader } from "@stigmer/react-sdk";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { sampleDate, samples } from "@stigmer/react-sdk/test";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { BUSY_WEEK_RUNS, BUSY_WEEK_USAGE, DASHBOARD_SUMMARY, EMPTY_USAGE, NO_RUNS, NOTHING_CONNECTED, ORGANIZATION } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";
import { journeyAnswer } from "./journey.tsx";

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
    // The journey is the organization's onboarding: the new organization's
    // admin is answered with nothing done yet; the busy week's member is
    // refused, as the server refuses anyone who is no admin there.
    router.service(OrganizationQueryController, {
      listMine: () => samples.organizationList([ORGANIZATION]),
      get: () => ORGANIZATION,
      getOnboarding: () => {
        if (week === "busy") throw new ConnectError("unauthorized to read this organization's onboarding", Code.PermissionDenied);
        return journeyAnswer({ agents: [], readiness: NOTHING_CONNECTED, ran: false, changed: false });
      },
    });
    router.service(RunQueryController, {
      getRunSummary: () => (week === "busy" ? BUSY_WEEK_RUNS : NO_RUNS),
      getOrgUsageReport: () => (week === "busy" ? BUSY_WEEK_USAGE : EMPTY_USAGE),
      list: () => samples.runList(failedRuns(week)),
    });
    router.service(PlatformQueryController, { getModelReadiness: () => NOTHING_CONNECTED });
    // The busy week's viewer is a member, no admin and here one who may not
    // make agents; the new organization's is its admin, with no agent made yet.
    router.service(GrantQueryController, {
      checkMyPermission: (input) => ({ isAuthorized: week === "new-org" || (input.relation !== "can_create_agent" && input.relation !== "can_edit") }),
    });
    router.service(AgentQueryController, { list: () => ({ entries: [], nextPageToken: "" }) });
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
          <PageHeader title="Dashboard" description="What your organization's agents did this week." />
        </div>
        <OperationalDashboard
          org={ORG_ID}
          firstStepLinks={{ connectProvider: "/models", createAgent: "/library/agents/new", startSession: "/" }}
        />
      </div>
    ),
  };
}
