// The scenes of a new person's way to a first answer: Models & providers in
// each face a provider card takes (an admin with nothing connected, two
// providers connected, a laptop, a member), the launcher ready and in its
// connect step for each of those faces, and the model picker marking the
// models that cannot run here.
//
// Every scene answers the server's readiness from fixtures.ts, the person's
// organizations, the key list, the billing permission and the person's
// account; the launcher's scenes answer the calls its flow and composer make
// too (`launcherRoutes`): no Environments, no My vault yet, a server that
// predates the server-info fields.
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import type { ProviderKey } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { ProviderKeyQueryController } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountSchema } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import {
  ProviderAvailability,
  type GetModelReadinessOutput,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { ModelSelector, ModelsHub, NewSessionViewer, useModelReadiness } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { NOTHING_ON_THE_RUNNER, ORGANIZATION, readiness } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";

const ORG_ID = ORGANIZATION.metadata?.id ?? "";

function inert(): void {}

/** Who is looking at a cloud organization: an admin may add keys, a member may not. */
type Viewer = "admin" | "member";

/** The person's own account, with no default models chosen. */
const ACCOUNT = create(IdentityAccountSchema, {
  metadata: { id: "ia-ada", name: "Ada Lovelace", slug: "ada", org: ORG_ID },
  spec: { idpId: "auth0|ada", email: "ada@acme.example" },
});

/** The calls every scene here makes: the organizations, readiness, the key list, the permission, the account. */
function modelsRoutes(answer: GetModelReadinessOutput, keys: readonly ProviderKey[], viewer: Viewer) {
  return (router: ConnectRouter) => {
    router.service(OrganizationQueryController, { listMine: () => samples.organizationList([ORGANIZATION]) });
    router.service(PlatformQueryController, { getModelReadiness: () => answer });
    router.service(ProviderKeyQueryController, { list: () => ({ entries: [...keys], nextPageToken: "" }) });
    router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: viewer === "admin" }) });
    router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
  };
}

/** The calls the launcher's flow and composer make beyond `modelsRoutes`, answered as for a new person. */
function launcherRoutes(answer: GetModelReadinessOutput, viewer: Viewer) {
  return (router: ConnectRouter) => {
    modelsRoutes(answer, [], viewer)(router);
    router.service(OrganizationQueryController, {
      listMine: () => samples.organizationList([ORGANIZATION]),
      get: () => ORGANIZATION,
    });
    router.service(PlatformQueryController, { getModelReadiness: () => answer, getServerInfo: () => ({}) });
    router.service(EnvironmentQueryController, { list: () => ({ entries: [] }) });
    router.service(VaultQueryController, {
      getMine: () => {
        throw new ConnectError("no My vault yet", Code.NotFound);
      },
    });
  };
}

/** Models & providers on Stigmer Cloud, for an admin or a member. */
export function modelsHubScene(answer: GetModelReadinessOutput, keys: readonly ProviderKey[], viewer: Viewer): Drawing {
  return {
    inOrganization: true,
    routes: modelsRoutes(answer, keys, viewer),
    render: () => <HubPage />,
  };
}

/** Models & providers on a laptop whose runner has no key. */
export function modelsHubLocalScene(): Drawing {
  return {
    deploymentMode: "local",
    inOrganization: true,
    routes: modelsRoutes(NOTHING_ON_THE_RUNNER, [], "admin"),
    render: () => <HubPage />,
  };
}

/** Two providers connected: Anthropic by the organization's own key, OpenAI by its parent's. */
export const CONNECTED = readiness({
  anthropic: ProviderAvailability.served_by_organization,
  openai: ProviderAvailability.served_by_parent_organization,
});

/** The hub framed as the console frames it: a centred column. */
function HubPage() {
  return (
    <div style={{ maxWidth: "56rem", margin: "0 auto", padding: "2rem 1.5rem" }}>
      <ModelsHub org={ORG_ID} />
    </div>
  );
}

/** The launcher on Stigmer Cloud or a laptop, with readiness as given. */
export function launcherScene(answer: GetModelReadinessOutput, viewer: Viewer, local = false): Drawing {
  return {
    deploymentMode: local ? "local" : undefined,
    inOrganization: true,
    routes: launcherRoutes(answer, viewer),
    render: () => (
      <div style={{ height: "calc(100vh - 48px)" }}>
        <NewSessionViewer org={ORG_ID} onSessionCreated={inert} autoFocus={false} />
      </div>
    ),
  };
}

/** Anthropic connected, so every model in the registry fixture but OpenAI's runs. */
export const ANTHROPIC_ONLY = readiness({
  anthropic: ProviderAvailability.served_by_organization,
  openai: ProviderAvailability.missing_from_organization,
});

/** OpenAI connected and Anthropic not: OpenAI's model runs, Anthropic's need a key. */
export const OPENAI_ONLY = readiness({
  anthropic: ProviderAvailability.missing_from_organization,
  openai: ProviderAvailability.served_by_organization,
});

/** The model picker on the Stigmer engine with OpenAI served and Anthropic missing; the case opens it. */
export function modelSelectorNotReadyScene(): Drawing {
  return {
    inOrganization: true,
    routes: modelsRoutes(OPENAI_ONLY, [], "admin"),
    render: () => <PickerWithReadiness />,
  };
}

function PickerWithReadiness() {
  const { readinessOf } = useModelReadiness(ORG_ID);
  return (
    <ModelSelector value="claude-sonnet-4.6" onValueChange={inert} initialHarness="stigmer" readinessOf={readinessOf} />
  );
}
