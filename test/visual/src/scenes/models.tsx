// The scenes of a new person's way to a first answer: Models & providers in
// each face a provider card takes (an admin with nothing connected, two
// providers connected, a laptop, a member), the launcher ready and in its
// connect step for each of those faces, its first question (asked in an
// organization where nothing has run, an example picked before and after a
// key, and the key step's two check answers after a save: refused in the
// check's words, and saved but not checked), and the model picker marking the
// models that cannot run here.
//
// Every scene answers the server's readiness from fixtures.ts, the person's
// organizations (`modelsRoutes`, which the story's console moment reuses), the key list, the billing permission and the person's
// account; the launcher's scenes answer the calls its flow and composer make
// too (`launcherRoutes`): no Environments, no My vault yet, a server that
// predates the server-info fields.
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { AgentSchema } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/query_pb";
import { FileSchema } from "@stigmer/apis/ai/stigmer/agentic/file/v1/api_pb";
import { FileCommandController } from "@stigmer/apis/ai/stigmer/agentic/file/v1/command_pb";
import { RunQueryController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/query_pb";
import {
  ProviderKeyCheck,
  ProviderKeySchema,
  type ProviderKey,
} from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/api_pb";
import { ProviderKeyCommandController } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/command_pb";
import { EnvironmentQueryController } from "@stigmer/apis/ai/stigmer/agentic/environment/v1/query_pb";
import { VaultQueryController } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/query_pb";
import { ProviderKeyQueryController } from "@stigmer/apis/ai/stigmer/billing/providerkey/v1/query_pb";
import { GrantQueryController } from "@stigmer/apis/ai/stigmer/iam/grant/v1/query_pb";
import { IdentityAccountQueryController } from "@stigmer/apis/ai/stigmer/iam/identityaccount/v1/query_pb";
import {
  ProviderAvailability,
  type GetModelReadinessOutput,
} from "@stigmer/apis/ai/stigmer/platform/v1/model_readiness_pb";
import { PlatformQueryController } from "@stigmer/apis/ai/stigmer/platform/v1/server_info_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { OrganizationQueryController } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/query_pb";
import { RunCommandController } from "@stigmer/apis/ai/stigmer/agentic/run/v1/command_pb";
import { ErrorInfoSchema } from "@stigmer/apis/google/rpc/error_details_pb";
import { ModelSelector, ModelsHub, NewSessionViewer, SessionInspector, useModelReadiness } from "@stigmer/react-sdk";
import { samples } from "@stigmer/react-sdk/test";
import { ACCOUNT, NOTHING_ON_THE_RUNNER, NO_RUNS, ORGANIZATION, readiness } from "../fixtures.ts";
import type { Drawing } from "./drawing.ts";

const ORG_ID = ORGANIZATION.metadata?.id ?? "";

function inert(): void {}

/** Who is looking at a cloud organization: an admin may add keys, a member may not. */
export type Viewer = "admin" | "member";

/**
 * The calls every scene here makes: the organizations, readiness, the key
 * list, the permission, the account. The organization is the samples' unless
 * a scene names its own (the story's integrator), under the same id.
 */
export function modelsRoutes(
  answer: GetModelReadinessOutput,
  keys: readonly ProviderKey[],
  viewer: Viewer,
  organization: Organization = ORGANIZATION,
) {
  return (router: ConnectRouter) => {
    router.service(OrganizationQueryController, { listMine: () => samples.organizationList([organization]) });
    router.service(PlatformQueryController, { getModelReadiness: () => answer });
    router.service(ProviderKeyQueryController, { list: () => ({ entries: [...keys], nextPageToken: "" }) });
    router.service(GrantQueryController, { checkMyPermission: () => ({ isAuthorized: viewer === "admin" }) });
    router.service(IdentityAccountQueryController, { whoAmI: () => ACCOUNT });
  };
}

/** The calls the launcher's flow and composer make beyond `modelsRoutes`, answered as for a new person. */
export function launcherRoutes(answer: GetModelReadinessOutput, viewer: Viewer) {
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

/** The launcher on Stigmer Cloud or a laptop, with readiness as given, framed as the console frames it (with the inspector). */
export function launcherScene(answer: GetModelReadinessOutput, viewer: Viewer, local = false): Drawing {
  return {
    deploymentMode: local ? "local" : undefined,
    inOrganization: true,
    routes: launcherRoutes(answer, viewer),
    render: () => (
      <div style={{ height: "calc(100vh - 48px)" }}>
        <NewSessionViewer org={ORG_ID} onSessionCreated={inert} autoFocus={false} inspector={<SessionInspector />} />
      </div>
    ),
  };
}

/** A run the server refuses with a reason, as Stigmer Cloud refuses one: its words, the reason, and what the reason names. */
export function runRefusal(message: string, reason: string, metadata: Record<string, string>): ConnectError {
  return new ConnectError(message, Code.FailedPrecondition, undefined, [{ desc: ErrorInfoSchema, value: { domain: "stigmer.ai", reason, metadata } }]);
}

/** The launcher, ready, whose first message the server refuses as `refusal` says: the scene types it and sends it. */
export function launcherRefusedScene(refusal: ConnectError): Drawing {
  return {
    inOrganization: true,
    routes: (router: ConnectRouter) => {
      launcherRoutes(ANTHROPIC_ONLY, "admin")(router);
      router.service(RunCommandController, {
        create: () => {
          throw refusal;
        },
      });
    },
    render: () => (
      <div style={{ height: "calc(100vh - 48px)" }}>
        <NewSessionViewer org={ORG_ID} onSessionCreated={inert} autoFocus={false} inspector={<SessionInspector />} />
      </div>
    ),
  };
}

/** Stigmer Cloud's words for a key its provider refuses (its provider-key save's refusal). */
export const KEY_REJECTED_WORDS = "Anthropic rejected this key. Check that it is a valid, active API key and try again.";

/**
 * How the scene's server answers a key save: refused as Cloud refuses a key
 * the provider rejects, or saved without the provider answering the check
 * (readiness then serves, and the key list holds the unchecked key).
 */
export type KeySave = "rejected" | "unchecked";

/**
 * The launcher as the console draws it for a newcomer: the first question,
 * in an organization where nothing has run, for an admin. A pick makes the
 * example's agent (the create answers it as made), the composer reads that
 * agent back by its name, and the sample uploads. `keySave` says how a key
 * saved in the key step is answered.
 */
export function launcherFirstQuestionScene(answer: GetModelReadinessOutput, keySave?: KeySave): Drawing {
  return {
    inOrganization: true,
    routes: (router: ConnectRouter) => {
      launcherRoutes(answer, "admin")(router);
      if (keySave !== undefined) {
        let current = answer;
        let keys: ProviderKey[] = [];
        router.service(PlatformQueryController, { getModelReadiness: () => current, getServerInfo: () => ({}) });
        router.service(ProviderKeyQueryController, { list: () => ({ entries: keys, nextPageToken: "" }) });
        router.service(ProviderKeyCommandController, {
          set: (input) => {
            if (keySave === "rejected") throw new ConnectError(KEY_REJECTED_WORDS, Code.InvalidArgument);
            const saved = create(ProviderKeySchema, {
              org: ORG_ID,
              provider: input.provider,
              keyHint: input.apiKey.slice(-4),
              check: ProviderKeyCheck.unchecked,
            });
            keys = [saved];
            current = ANTHROPIC_ONLY;
            return saved;
          },
        });
      }
      router.service(RunQueryController, { getRunSummary: () => NO_RUNS });
      const made = (name: string, slug: string) =>
        create(AgentSchema, { metadata: { id: `agt_${slug}`, org: ORG_ID, name, slug }, spec: { description: "", instructions: "" } });
      router.service(AgentCommandController, { create: (agent) => made(agent.metadata?.name ?? "", agent.metadata?.slug ?? "") });
      router.service(AgentQueryController, { getByReference: (ref) => made("Variance Reporter", ref.slug) });
      router.service(FileCommandController, {
        upload: (input) =>
          create(FileSchema, {
            metadata: { id: `fil_${input.filename}`, org: ORG_ID, name: input.filename },
            spec: { filename: input.filename, mimeType: input.mimeType },
          }),
      });
    },
    render: () => (
      <div style={{ height: "calc(100vh - 48px)" }}>
        <NewSessionViewer org={ORG_ID} onSessionCreated={inert} autoFocus={false} inspector={<SessionInspector />} firstQuestion />
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
