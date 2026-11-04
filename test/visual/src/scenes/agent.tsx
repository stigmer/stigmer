// The agent's page, framed as the console's Library frames a detail page
// (a centred column), with the header acts the web console passes: Start
// session first, then the menu's Copy, Edit YAML, Export and Delete, each
// act that changes the agent declaring the relation it needs, as the web
// host declares them.
//
// Two people look at it: the agent's owner, and a person who may only read
// it. The server answers each one's self-checks (`can_edit`, `can_delete`,
// `can_view_access`) by who they are; the page offers each only the acts
// the server allows: the owner every act and the inline edits, the reader
// Start session, the copies and the exports, on a read-only page.
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { ChannelQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/query_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import type { ListAgentVersionsResponse } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/version_pb";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import type { Vault } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { AgentDetailView, type DetailAction } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { ACCOUNT, LEDGER_AGENT, LEDGER_AGENT_VERSIONS, ORGANIZATION } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";

/** The sub-agent the ledger agent hands receipts to. */
const RECEIPT_MATCHER = samples.agent({
  id: "agt_00000000000000000000000043",
  name: "Receipt matcher",
  slug: "receipt-matcher",
  org: ORGANIZATION.metadata?.id,
  description: "Matches each card transaction to its receipt and flags the ones with none.",
});

/** Who is looking: the agent's owner, or a person the organization lets read it. */
export type AgentViewer = "owner" | "reader";

function inert(): void {}

/** The acts the web console's agent page passes to the view, in its order. */
export const START_SESSION: DetailAction = { id: "start-session", label: "Start session", onAction: inert };
export const MENU: readonly DetailAction[] = [
  { id: "copy-id", label: "Copy ID", group: "clipboard", onAction: inert },
  { id: "copy-slug", label: "Copy slug", group: "clipboard", onAction: inert },
  { id: "edit-yaml", label: "Edit YAML", group: "export", requires: "can_edit", onAction: inert },
  { id: "export-yaml", label: "Export YAML", group: "export", onAction: inert },
  { id: "export-json", label: "Export JSON", group: "export", onAction: inert },
  { id: "download-yaml", label: "Download YAML", group: "export", onAction: inert },
  { id: "delete", label: "Delete", variant: "destructive", group: "danger", requires: "can_delete", onAction: inert },
];

/** The agent a page shows, its versions, its channels and the vaults they bind: the ledger agent's, with none, unless a scene names others. */
export interface AgentPage {
  readonly agent?: Agent;
  readonly versions?: ListAgentVersionsResponse;
  readonly channels?: readonly Channel[];
  readonly vaults?: readonly Vault[];
}

/** The calls the agent's page makes, answered for `viewer`. */
export function agentRoutes(viewer: AgentViewer, { agent = LEDGER_AGENT, versions = LEDGER_AGENT_VERSIONS, channels = [], vaults = [] }: AgentPage = {}) {
  return (router: ConnectRouter) => {
    router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
    router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
    router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: viewer === "owner" }) });
    router.service(AgentQueryController, {
      getByReference: (input) => (input.slug === RECEIPT_MATCHER.metadata?.slug ? RECEIPT_MATCHER : agent),
      get: () => agent,
      listVersions: () => versions,
    });
    router.service(EnvironmentQueryController, { list: () => ({ entries: [] }) });
    router.service(ChannelQueryController, {
      listByAgent: () => ({ entries: [...channels] }),
      list: () => ({ entries: [...channels] }),
    });
    router.service(PlatformQueryController, { getServerInfo: () => ({}) });
    router.service(VaultQueryController, {
      list: () => ({ entries: [...vaults] }),
      getByReference: (input) => {
        const vault = vaults.find((candidate) => candidate.metadata?.slug === input.slug);
        if (vault === undefined) throw new ConnectError(`no vault ${input.slug}`, Code.NotFound);
        return vault;
      },
      getMine: () => {
        throw new ConnectError("no My vault yet", Code.NotFound);
      },
    });
  };
}

/** The ledger agent's page, as `viewer` sees it in the console. */
export function agentProfileScene(viewer: AgentViewer): Drawing {
  const org = ORGANIZATION.metadata?.slug ?? "";
  const slug = LEDGER_AGENT.metadata?.slug ?? "";
  return {
    inOrganization: true,
    routes: agentRoutes(viewer),
    render: () => (
      <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <AgentDetailView org={org} slug={slug} editable primaryAction={START_SESSION} actions={MENU} />
      </div>
    ),
  };
}
