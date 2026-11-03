// The environments page's screens (docs/guides/environments/set-up-an-environment.mdx):
// the New environment form filled by the scene's acts with the page's own
// data-science Environment; the data team's Agent after its Environment
// section names it; and a conversation on that Agent with its run settings
// open from the composer, whose Environment row says which one it got and
// why.
//
// The server here runs conversations in sandboxes it starts, which limit
// networking and install packages, as the page's reader needs.
import { clone, create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { EnvironmentSource } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { SessionStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/status_pb";
import { SessionSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import { AgentDetailView, EnvironmentForm } from "@stigmer/react-sdk";
import { samples, scenarios } from "@stigmer/react-sdk/test";
import { DATA_ANALYST, DATA_SCIENCE } from "../docs-fixtures.ts";
import { ACCOUNT, ORGANIZATION } from "../fixtures.ts";
import { agentRoutes, MENU, START_SESSION } from "./agent.tsx";
import type { Drawing } from "./drawing.ts";
import { sessionDrawing, sessionRoutes } from "./session.tsx";

const ORG_SLUG = ORGANIZATION.metadata?.slug ?? "";

/** A server whose conversations run in sandboxes it starts, which limit networking and install packages. */
const SANDBOXED = { environments: { applies: true, limitedNetworking: true, packages: true } };

function environmentRoutes(router: ConnectRouter): void {
  router.service(EnvironmentQueryController, {
    list: () => ({ entries: [DATA_SCIENCE] }),
    get: () => DATA_SCIENCE,
    getByReference: () => DATA_SCIENCE,
  });
}

/** New environment, as the console's Library → Environments → New environment draws it; the scene's acts fill it. */
export function environmentNewScene(): Drawing {
  return {
    inOrganization: true,
    routes: (router) => {
      router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
      router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
      router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: true }) });
      router.service(PlatformQueryController, { getServerInfo: () => SANDBOXED });
    },
    render: () => (
      <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <EnvironmentForm org={ORG_SLUG} onCancel={() => {}} />
      </div>
    ),
  };
}

/** The data team's Agent's page after its Environment section names data-science, as an admin sees it. */
export function agentEnvironmentScene(): Drawing {
  const page = agentRoutes("owner", { agent: DATA_ANALYST });
  return {
    inOrganization: true,
    routes: (router) => {
      page(router);
      environmentRoutes(router);
    },
    render: () => (
      <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <AgentDetailView org={ORG_SLUG} slug={DATA_ANALYST.metadata?.slug ?? ""} editable primaryAction={START_SESSION} actions={MENU} />
      </div>
    ),
  };
}

/** A finished conversation on the data team's Agent, which the server put in data-science as the Agent's default. */
export function runSettingsScene(): Drawing {
  const finished = scenarios.finished;
  const session = clone(SessionSchema, finished.session ?? samples.session());
  session.status ??= create(SessionStatusSchema);
  session.status.environment = create(ApiResourceReferenceSchema, {
    org: session.metadata?.org ?? "",
    kind: ApiResourceKind.environment,
    slug: DATA_SCIENCE.metadata?.slug ?? "",
  });
  session.status.environmentSource = EnvironmentSource.AGENT;
  const replay = { ...finished, session };
  const drawing = sessionDrawing(replay, { inspector: true });
  return {
    ...drawing,
    routes: sessionRoutes(replay, { agent: DATA_ANALYST }),
  };
}
