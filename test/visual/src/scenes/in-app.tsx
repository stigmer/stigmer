// The agent page's "In your app" tab, as each viewer and server sees it:
// on a server that signs people in, an admin with everything still to do
// (no admin service account, account creation off, waiting for the first
// person the app signs in), the same admin once all of it is done (an admin
// service account, accounts made as Member, a first app user), and a member
// the server lets do none of it; and on a server that trusts every caller,
// the development chat alone.
//
// The ledger agent's page (scenes/agent.tsx), with the reads the tab adds
// answered: the server's posture, the organization's embedding settings,
// the viewer's permissions and the organization's access list. The address
// the code names is Stigmer Cloud's on a signing-in server and a laptop's on
// a trusting one.
import { clone, create } from "@bufbuild/protobuf";
import type { ConnectRouter } from "@connectrpc/connect";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { OrganizationEmbeddingSchema, OrganizationSpecSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/spec_pb";
import { AgentDetailView } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { LEDGER_AGENT, ORGANIZATION } from "../fixtures.ts";
import { MENU, START_SESSION, agentRoutes } from "./agent.tsx";
import type { Drawing } from "./drawing.ts";

/** Which face of the tab a scene draws. */
export type InAppFace = "todo" | "done" | "member" | "local";

const LINKS = { serviceAccounts: "#/settings/service-accounts", embedding: "#/settings/org-embedding" };

/** An access-list entry: a person, a service account or an app user, with its direct role. */
function entry(id: string, name: string, mode: IdentityAccountProvisioningMode, role: string) {
  return {
    principal: { kind: "identity_account", id, name, email: "", identityOrigin: { provisioningMode: mode } },
    roles: [{ role: { code: role, name: role }, isInherited: false }],
  };
}

/** The tab on the ledger agent's page, as `face` draws it. */
export function agentInAppScene(face: InAppFace): Drawing {
  const signsIn = face !== "local";
  const done = face === "done";
  const organization = clone(OrganizationSchema, ORGANIZATION);
  organization.spec ??= create(OrganizationSpecSchema, {});
  organization.spec.embedding = create(OrganizationEmbeddingSchema, {
    createAccountsOnSignIn: done,
    signInRole: done ? IamRole.member : IamRole.iam_role_unspecified,
  });
  const access = [
    entry("ida_ada", "Ada Lovelace", IdentityAccountProvisioningMode.direct, "owner"),
    ...(done
      ? [
          entry("ida_backend", "app-backend", IdentityAccountProvisioningMode.service_account, "admin"),
          entry("ida_dana", "Dana Lee", IdentityAccountProvisioningMode.app_user, "member"),
          entry("ida_sam", "Sam Ortiz", IdentityAccountProvisioningMode.app_user, "member"),
        ]
      : []),
  ];
  return {
    inOrganization: true,
    publicBaseUrl: signsIn ? "https://api.stigmer.ai" : "http://localhost:7234",
    routes: (router: ConnectRouter) => {
      agentRoutes(face === "member" ? "reader" : "owner")(router);
      router.service(PlatformQueryController, { getServerInfo: () => ({ authenticationRequired: signsIn, version: "0.1.3" }) });
      router.service(OrganizationQueryController, { listMine: () => samples.organizationList([organization]), get: () => organization });
      router.service(GrantQueryController, {
        // A member may read who has access (every member may) and nothing else here.
        checkMyPermission: (input) => ({ isAuthorized: face !== "member" || input.relation === "can_view_access" }),
        listResourceAccessByPrincipal: () => ({ entries: access }),
      });
    },
    render: () => (
      <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <AgentDetailView
          org={ORGANIZATION.metadata?.slug ?? ""}
          slug={LEDGER_AGENT.metadata?.slug ?? ""}
          editable={face !== "member"}
          primaryAction={START_SESSION}
          actions={MENU}
          inApp={LINKS}
          defaultTab="in-app"
        />
      </div>
    ),
  };
}
