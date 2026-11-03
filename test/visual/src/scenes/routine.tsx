// The routines page's screens (docs/guides/routines/run-an-agent-on-a-schedule.mdx),
// framed as the console's Library frames a page (a centred column): the New
// routine form, filled by the scene's acts with the page's own example; the
// routine it makes, switched off, offering Enable & run now; and its History
// tab after that first run.
//
// Ada makes the routine in the gallery's organization; its Agent is the one
// the agents page prints, and every value the page names comes from
// docs-examples.ts.
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { FileQueryController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/query_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { RoutineQueryController } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/query_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { RoutineDetailView, RoutineForm } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import type { ReactElement } from "react";
import { firstRunHistory, VARIANCE_REPORTER, varianceRoutine } from "../docs-fixtures.ts";
import { ACCOUNT, ORGANIZATION } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";

const ORG_SLUG = ORGANIZATION.metadata?.slug ?? "";

/** The console's Library column, as agent.tsx frames the agent's page. */
function libraryColumn(page: ReactElement): ReactElement {
  return <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>{page}</div>;
}

/** The calls every routine screen makes: who is looking, their organization, the routine and its Agent. */
function routineRoutes(enabled: boolean) {
  return (router: ConnectRouter) => {
    router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
    router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
    router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: true }) });
    router.service(AgentQueryController, {
      getByReference: () => VARIANCE_REPORTER,
      get: () => VARIANCE_REPORTER,
      list: () => ({ entries: [VARIANCE_REPORTER] }),
    });
    router.service(FileQueryController, { list: () => ({ entries: [] }) });
    router.service(RoutineQueryController, {
      getByReference: () => varianceRoutine(enabled),
      get: () => varianceRoutine(enabled),
      listFires: () => (enabled ? firstRunHistory() : { entries: [] }),
    });
    router.service(EnvironmentQueryController, { list: () => ({ entries: [] }) });
    router.service(PlatformQueryController, { getServerInfo: () => ({}) });
    router.service(VaultQueryController, {
      list: () => ({ entries: [] }),
      getMine: () => {
        throw new ConnectError("no My vault yet", Code.NotFound);
      },
    });
  };
}

/** New routine, as the console's Library → Routines → New routine draws it; the scene's acts fill it. */
export function routineNewScene(): Drawing {
  return {
    inOrganization: true,
    routes: routineRoutes(false),
    render: () => libraryColumn(<RoutineForm org={ORG_SLUG} onCancel={() => {}} />),
  };
}

/** The routine's page: switched off as made, or on with its first run in History. */
export function routineDetailScene(state: "disabled" | "history"): Drawing {
  return {
    inOrganization: true,
    routes: routineRoutes(state === "history"),
    render: () =>
      libraryColumn(
        <RoutineDetailView
          org={ORG_SLUG}
          slug={varianceRoutine(false).metadata?.slug ?? ""}
          editable
          defaultTab={state === "history" ? "history" : undefined}
          onNavigateToAgent={() => {}}
          onNavigateToRun={() => {}}
        />,
      ),
  };
}
