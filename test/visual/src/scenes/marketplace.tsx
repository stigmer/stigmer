// The marketplace, framed as the console frames it (a centred column under
// the page's heading), reading the official catalogue at the server's
// release (marketplace.ts) for an organization that has installed one of
// its plugins.
//
// Two people browse it: an admin, who may install, and a member, whom the
// server refuses (installing a plugin is `can_create_plugin`, an admin's).
// Each self-check is answered by who is looking: the admin sees Install and
// the Upload tile, the member the same cards saying "Ask an admin to
// install".
import type { ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { PluginQueryController } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/query_pb";
import { PluginSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import { PluginListSchema } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/io_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { GetServerInfoOutputSchema, PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { MarketplaceCatalog, PageHeader } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { countedFetch } from "../fake-server.ts";
import { ORGANIZATION } from "../fixtures.ts";
import { catalogueFetch, SERVER_RELEASE } from "../marketplace.ts";
import type { Drawing } from "./drawing.ts";

const ORG_ID = ORGANIZATION.metadata?.id ?? "";

/** Who is browsing: an admin, who may install, or a member, who may not. */
export type MarketplaceViewer = "admin" | "member";

/** The plugin the organization already holds, so one card says Installed. */
const INSTALLED = create(PluginSchema, { metadata: { id: "plg_linear", slug: "linear", name: "Linear", org: ORG_ID } });

function marketplaceRoutes(viewer: MarketplaceViewer) {
  return (router: ConnectRouter) => {
    router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]), get: () => ORGANIZATION });
    router.service(PlatformQueryController, {
      getServerInfo: () => create(GetServerInfoOutputSchema, { version: SERVER_RELEASE }),
    });
    router.service(PluginQueryController, { list: () => create(PluginListSchema, { entries: [INSTALLED], nextPageToken: "" }) });
    router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: viewer === "admin" }) });
  };
}

/** The marketplace page, as the web console draws it. */
export function marketplaceScene(viewer: MarketplaceViewer): Drawing {
  const fetchImpl = countedFetch(catalogueFetch());
  return {
    inOrganization: true,
    routes: marketplaceRoutes(viewer),
    render: () => (
      <div style={{ maxWidth: "64rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
        <div style={{ marginBottom: "1.5rem" }}>
          <PageHeader
            title="Marketplace"
            description={`Plugins for ${ORGANIZATION.metadata?.slug ?? ""}'s agents: tools, skills and whole agents, from Stigmer's catalogue or one you add.`}
          />
        </div>
        <MarketplaceCatalog org={ORG_ID} fetchImpl={fetchImpl} />
      </div>
    ),
  };
}
