// Cloud target: the cloud edition — the TypeScript composition in
// stigmer-cloud — as an external endpoint.
// Domain: conformance targets.
//
// Connect-only by design: the target never boots anything. It reads the
// environment published through the CLOUD_ENV contract by whoever provisioned
// it (stigmer-cloud's readout recipe, or a deployed endpoint's operator) and
// drives it as the primary conformance user over an authenticated gRPC
// transport.
//
// Tenancy is real here, unlike the local targets: each provisioned scope is an
// organization created via the production RPC, whose creation grants the
// primary user ownership (grants) and provisions its billing account —
// sufficient for the Class A (CRUD) domains. A run needs the
// organization's own key for its provider (keyTenancy): the fixture Anthropic
// and OpenAI keys always, and a Cursor key only when the invoking shell
// supplies a real one in CURSOR_API_KEY.

import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { CLOUD_ENV, requireDirectLoginTenant } from "../harness/cloud-env";
import {
  createTransport,
  makeClients,
  type ConformanceClients,
  type PresentingOptions,
} from "../harness/clients";
import { newPrimaryEnforcingLane } from "../harness/enforcing-lane";
import { awaitGrpcReady } from "../harness/grpc-ready";
import { PERSON_TOKEN_TTL_SECONDS, PrimaryPeople } from "../harness/people";
import { moveToTeamPlan } from "../harness/plan-move";
import { freshSubject, optInToMemory } from "../support/identityaccounts";
import { uniqueName } from "../support/naming";
import { createUniqueOrganization } from "../support/organizations";
import type {
  CapabilityFlags,
  DirectLoginTenant,
  EnforcingLane,
  PrivilegedScope,
  StripeWebhookLane,
  TargetProfile,
  TenancyContext,
} from "./target";


function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(
      `${name} is not set: the cloud target is connect-only and expects a provisioned ` +
        "environment. Export the STIGMER_CONFORMANCE_CLOUD_* contract the provisioner prints " +
        "(stigmer-cloud's readout recipe: backend/services/stigmer-server/spike/README.md) " +
        "before running `npm run test:cloud`.",
    );
  }
  return value;
}

/**
 * The provider keys keyTenancy saves on a tenancy, by provider: what the
 * proxy injects upstream for that org's calls.
 */
export const CONFORMANCE_PROVIDER_KEYS: Readonly<Record<"anthropic" | "openai", string>> = {
  anthropic: "sk-ant-conformance-org-key",
  openai: "sk-conformance-openai-org-key",
};

/**
 * The environment variable a real Cursor key is read from: the name the
 * runner's direct mode and the open-source live lanes read. There is no
 * fixture Cursor key: the cloud checks a Cursor key with Cursor itself
 * (`GET /v1/me`) when it is saved, so only a real user API key or team
 * service-account key on a paid Cursor plan can be saved.
 */
export const CURSOR_KEY_ENV = "CURSOR_API_KEY";

/** Why a Cursor arm skips where the target admits no Cursor run. */
export const CURSOR_KEY_SKIP_REASON =
  "the cloud target needs CURSOR_API_KEY: a Cursor run on Stigmer Cloud runs on the organization's own Cursor key";

/** The real Cursor key the invoking shell supplies, or undefined. */
export function conformanceCursorKey(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = env[CURSOR_KEY_ENV]?.trim() ?? "";
  return key === "" ? undefined : key;
}

export class CloudTarget implements TargetProfile {
  readonly name = "cloud";
  // stigmer-cloud's composition declares `cloud` in its first-party unit.
  readonly edition: ServerEdition = ServerEdition.cloud;

  // Read once, at construction, so the capability below and keyTenancy agree.
  private readonly cursorKey = conformanceCursorKey();

  readonly capabilities: CapabilityFlags = {
    multiTenant: true,
    // Many organizations: the Cloud composes no single-organization unit.
    singleOrganization: false,
    // OpenFGA behind the cloud-iam unit: the primary enforces the model, so
    // it IS this target's enforcing lane (enforcingLane below).
    enforcingAuthorizer: true,
    versionTagging: true,
    // Cloud carries the transfer lane over pre-signed R2 URLs — the full
    // mint → PUT → push-by-ref → download-URL pin block runs against this
    // target.
    skillArtifactTransferLane: true,
    // The hermetic cloud env boots Temporal and the composition runs the
    // schedule clock — triggers fire for real.
    routineFiring: true,
    // The cloud-execution runner is an embedded runner bootstrapped as the
    // primary user and acts as itself, narrowed by its own exchange; the
    // cloud's shared-runner shape (the managed sandbox, provisioned per
    // session) is never booted by this harness — see CapabilityFlags.
    runnerActsAsRunCreator: false,
    // GuardReservedLabelsStep rejects reserved-label writes from the ordinary
    // conformance user — the suite pins that rejection where this is false.
    // Operator-lane assertions run through provisionPrivilegedScope
    // (stigmer#547) instead.
    clientReservedLabelWrites: false,
    // The primary conformance user signs in through the environment's tenant
    // as a console person does, so it passes the first-party gate, and opts
    // in to memory on its own account at setup.
    firstPartyMemoryCapture: true,
    // The cloud channel runtime serves installs, conversation participation,
    // and proactive messaging for real — the OSS refusal pins are gated off
    // here (their full behavior needs live provider workspaces; see target.ts).
    channelMessaging: true,
    // The composition admits every run on the organization's own provider
    // keys and refuses a keyless one at create.
    billingGates: true,
    // The primary creates minting service accounts and mints user tokens in
    // the suites that test them; the minter's contract is enforced on every
    // serving-edge request by the user-token verifier and origin guard.
    userTokens: true,
    // Every non-public RPC needs a credential: the composition declares the
    // require-authentication registry point, with the same byte-pinned
    // refusal the open-source chassis gives.
    requiresAuthentication: true,
    // The platform tenant's tokens are verified and their subject resolved to
    // the ida_ at position 1 by the composition's direct-idp verifier.
    directLogin: true,
    // The cloud-iam unit composes the IdentityFederation capability, so the
    // four federation RPCs are served for real; the OSS UNIMPLEMENTED pins
    // gate off here (their positive behavior needs a FederationIssuer
    // fixture — the channelMessaging coverage split, target.ts).
    federatedIdentityAccounts: true,
    // The cloud-iam unit registers every kind's kind_meta roles as the grant
    // scope and wraps its OpenFGA client as the query engine, so per-resource
    // grants are admitted and the tuple-half queries answer.
    perResourceGrants: true,
    authorizationQueries: true,
    accessHistory: "plan-upgrade-required",
    // A newcomer holds nothing until a grant or an invitation.
    membershipOnArrival: false,
    // The Cloud holds no license key: its plans are subscriptions.
    licenseStatus: "absent",
    // The enterprise identity unit, composed with the Cloud's plan gate on
    // teams: a Free organization is refused one, so the team arms run on a
    // tenancy moved to the Team plan (provisionTeamsTenancy). Invitation
    // links and federation issuers ride no plan.
    teams: "plan-gated",
    invitations: true,
    federationIssuers: true,
    // The composition always dials user-supplied addresses strictly.
    outboundEgress: "strict",
    // The three cloud-capability surfaces, all served by the composition (the
    // flag is the edition's contract; the lane address is CLOUD_ENV's).
    billingEngine: true,
    // The plan catalog and subscriptions (the Cloud's subscription engine).
    billingPlans: true,
    sideChannelProxy: true,
    publicLane: true,
    // The sharing unit mints guest tokens by share id.
    guestMinting: true,
    // The readout substrate boots no cloud-mode sandbox lane (target.ts
    // says why the refusal is unobservable here).
    cloudTargetRefusesLocalPrograms: false,
    // A Cursor run needs the organization's own Cursor key, which only a
    // real key in CURSOR_API_KEY can provide (target.ts says why).
    cursorRunsAdmitted: this.cursorKey !== undefined,
    // The readout's runner dials the mock LLM, not the proxy lane, so an
    // execution arm's run is unmetered and counted from its runner's report
    // (target.ts says why; the proxy suite proves the metered read).
    runModelCallsMetered: false,
  };

  private grpcBaseUrl: string | undefined;
  private conformanceClients: ConformanceClients | undefined;
  private operatorClients: ConformanceClients | undefined;
  // The environment's direct-login tenant, which mints every person this
  // target makes; set by setup().
  private tenant: DirectLoginTenant | undefined;
  // The tenancies the primary founds and the people the tenant signs in
  // (harness/people.ts, which the Enterprise target shares).
  private readonly people = new PrimaryPeople({
    founder: () => this.clients(),
    freshToken: async (caller) => {
      if (this.tenant === undefined) {
        throw new Error(`CloudTarget.setup() must be called before ${caller}()`);
      }
      return this.tenant.mint({ subject: freshSubject(), ttlSeconds: PERSON_TOKEN_TTL_SECONDS });
    },
    clientsPresenting: (token) => this.clientsPresenting(token),
  });

  // Present only when the environment carries an operator credential — the
  // hermetic bootstrap always mints one; pre-provisioned/deployed endpoints
  // deliberately never do (the stigmer#547 permanent-skip ruling), so the
  // method itself is absent there and privileged-lane assertions skip.
  provisionPrivilegedScope?: () => Promise<PrivilegedScope>;

  // The platform tenant's signing key (CLOUD_ENV.directLogin*), which the
  // hermetic launcher's own tenant and the composition readout's mock tenant
  // both hand over. setup() requires it, because the target's people sign
  // in through that tenant; a deployed endpoint never hands it over (a real
  // tenant's key is not conformance's to hold), so this target does not run
  // against one at all.
  directLoginTenant?: () => DirectLoginTenant;

  async setup(): Promise<void> {
    this.grpcBaseUrl = requireEnv(CLOUD_ENV.address);
    const token = requireEnv(CLOUD_ENV.token);
    this.conformanceClients = makeClients(createTransport(this.grpcBaseUrl, { bearerToken: token }));
    await awaitGrpcReady(
      this.conformanceClients,
      () =>
        "(cloud environment: the composition is provisioned outside this repository — " +
        "see the provisioner's logs, e.g. stigmer-cloud's readout recipe)",
    );

    const operatorToken = process.env[CLOUD_ENV.operatorToken];
    if (operatorToken !== undefined && operatorToken !== "") {
      this.operatorClients = makeClients(
        createTransport(this.grpcBaseUrl, { bearerToken: operatorToken }),
      );
      this.provisionPrivilegedScope = () => this.createPrivilegedScope();
    }

    // The target's people sign in through the environment's tenant, as a
    // console person does (cloud-env.ts says why), so the tenant is
    // required here, not only by the direct-login suite.
    const tenant = requireDirectLoginTenant();
    this.tenant = tenant;
    this.directLoginTenant = () => tenant;
    // The primary is that console person, and opts in to memory on their own
    // account as such a person does, so the suites that capture memory run
    // past the member half of the double opt-in (firstPartyMemoryCapture).
    await optInToMemory(this.clients());
  }

  // The tenant's issuer, as the environment publishes it: the one the
  // composition reserves for its own sign-in.
  signInIssuer(): string {
    if (this.tenant === undefined) {
      throw new Error("CloudTarget.setup() must be called before signInIssuer()");
    }
    return this.tenant.issuer;
  }

  directLoginUnavailable(): string {
    return (
      `${CLOUD_ENV.directLoginIssuer} is unset — this environment does not hand conformance the platform ` +
      "tenant's signing key (a deployed endpoint's real tenant key is never conformance's to hold), " +
      "so the direct-login lane cannot be driven here"
    );
  }

  // The primary enforces, so the lane is a view over this target's own
  // provisioning: the primary caller founds and owns every tenancy, the
  // environment's tenant signs the people in, and a person's exact role is
  // set by the founder's ordinary grants (harness/enforcing-lane.ts).
  async enforcingLane(): Promise<EnforcingLane> {
    const grpcBaseUrl = this.requireBaseUrl("enforcingLane");
    return newPrimaryEnforcingLane({
      clients: this.clients(),
      provisionTenancy: () => this.provisionTenancy(),
      cleanupTenancy: (context) => this.cleanupTenancy(context),
      provisionIdentity: () => this.provisionIdentity(),
      provisionMember: (tenancy) => this.provisionMember(tenancy),
      organizationIdOf: (tenancy) => this.people.organizationIdOf(tenancy, "enforcingLane"),
      unprovisionedBearer: async () => {
        if (this.tenant === undefined) {
          throw new Error("CloudTarget.setup() must be called before enforcingLane()");
        }
        return this.tenant.mint({ subject: `auth0|${uniqueName("lane-unprovisioned")}` });
      },
      clientsPresenting: (bearerToken, options) => this.clientsPresenting(bearerToken, options),
      managedAgentsBaseUrl: () => grpcBaseUrl,
    });
  }

  // Connect-only: the target spawns nothing, so it cannot boot a sibling in
  // another posture. The cloud's identity lane is the platform tenant's,
  // driven by the direct-login suite through directLoginTenant.
  spawnSiblingUnavailable(): string {
    return (
      "the cloud target is connect-only and spawns no server; its OIDC lane is the platform " +
      "tenant's, driven by the direct-login suite"
    );
  }

  // Platform-operator power grants nothing at org level (the FGA model checks
  // platform capabilities against platform:stigmer only), so the operator
  // creates AND owns the scope's org; cleanup deletes it.
  private async createPrivilegedScope(): Promise<PrivilegedScope> {
    const operatorClients = this.operatorClients;
    if (operatorClients === undefined) {
      throw new Error("CloudTarget.setup() must run before provisionPrivilegedScope()");
    }
    const { id } = await createUniqueOrganization(
      operatorClients.organizationCommand,
      "the operator's privileged scope",
    );
    return {
      clients: operatorClients,
      context: { org: id },
      cleanup: async () => {
        await operatorClients.organizationCommand.delete({ value: id });
      },
    };
  }

  clients(): ConformanceClients {
    if (this.conformanceClients === undefined) {
      throw new Error("CloudTarget.setup() must be called before clients()");
    }
    return this.conformanceClients;
  }

  anonymousClients(): ConformanceClients {
    return makeClients(createTransport(this.requireBaseUrl("anonymousClients")));
  }

  clientsPresenting(bearerToken: string, options: PresentingOptions = {}): ConformanceClients {
    return makeClients(
      createTransport(this.requireBaseUrl("clientsPresenting"), { ...options, bearerToken }),
    );
  }

  // The composition serves the Managed Agents lane on the unified port it
  // serves gRPC on, the one CLOUD_ENV.address names (target.ts).
  managedAgentsBaseUrl(): string {
    return this.requireBaseUrl("managedAgentsBaseUrl");
  }

  private requireBaseUrl(caller: string): string {
    if (this.grpcBaseUrl === undefined) {
      throw new Error(`CloudTarget.setup() must be called before ${caller}()`);
    }
    return this.grpcBaseUrl;
  }

  // The cloud-capability HTTP lanes, read per call from the CLOUD_ENV contract
  // (published before any worker runs; reading late keeps the target
  // constructible in unit tests that never call setup()). Each is required:
  // the flags above promise the lane, so a missing address is an environment
  // bug that must fail the arm, never skip it.
  proxyBaseUrl(): string {
    return requireEnv(CLOUD_ENV.proxyAddress);
  }

  cursorBidiBaseUrl(): string {
    return requireEnv(CLOUD_ENV.cursorBidiAddress);
  }

  publicBaseUrl(): string {
    return requireEnv(CLOUD_ENV.publicAddress);
  }

  stripeWebhook(): StripeWebhookLane {
    return {
      baseUrl: requireEnv(CLOUD_ENV.stripeWebhookAddress),
      signingSecret: requireEnv(CLOUD_ENV.stripeWebhookSecret),
    };
  }

  // The tenancy names its organization by id, as every resource does, and
  // cleanup deletes it by that id.
  provisionTenancy(): Promise<TenancyContext> {
    return this.people.provisionTenancy();
  }

  cleanupTenancy(context: TenancyContext): Promise<void> {
    return this.people.cleanupTenancy(context);
  }

  // On this Class A target provisionTenancy already yields the keyless shape
  // (an org create provisions its billing account and saves no provider
  // key), so the two verbs coincide here; the execution target keys in
  // provisionTenancy and delegates this one. Named separately so a suite can
  // state its precondition — "this org holds NO provider key" — instead of
  // relying on which target it happens to run under.
  provisionKeylessTenancy(): Promise<TenancyContext> {
    return this.provisionTenancy();
  }

  // A tenancy whose organization is on the Team plan, the plan the team
  // lane's gate admits (harness/plan-move.ts says how it moves). The plain
  // tenancy stays on Free, which the billing suites start from.
  async provisionTeamsTenancy(): Promise<TenancyContext> {
    const context = await this.provisionTenancy();
    try {
      await moveToTeamPlan(this.clients(), this.stripeWebhook(), context.org);
    } catch (error) {
      await this.cleanupTenancy(context);
      throw error;
    }
    return context;
  }

  // Saves the fixture keys through the org owner's own ProviderKey.set, the
  // call the console's Provider keys section makes. The key check a save
  // makes reaches the environment's fake upstream, which answers it. The
  // real Cursor key, when the run supplies one, is saved the same way with
  // no base URL; its check reaches Cursor itself.
  async keyTenancy(org: string): Promise<void> {
    for (const [provider, apiKey] of Object.entries(CONFORMANCE_PROVIDER_KEYS)) {
      await this.clients().providerKeyCommand.set({ org, provider, apiKey });
    }
    if (this.cursorKey !== undefined) {
      await this.clients().providerKeyCommand.set({ org, provider: "cursor", apiKey: this.cursorKey });
    }
  }

  // A brand-new console person holding no grants on any org this run
  // provisioned: the outsider for isolation assertions.
  provisionIdentity(): Promise<ConformanceClients> {
    return this.people.provisionIdentity();
  }

  // A brand-new console person granted exactly `member` on the tenancy, as
  // the primary (the org's owner, through the ordinary Grant create).
  // The colleague for within-organization authorization assertions: past the
  // organization-level checks, subject to every resource-level rule.
  provisionMember(tenancy: TenancyContext): Promise<ConformanceClients> {
    return this.people.provisionMember(tenancy);
  }

  async teardown(): Promise<void> {
    // Connect-only: the environment's lifecycle belongs to whoever provisioned
    // it (the cloud global setup for hermetic runs).
    this.grpcBaseUrl = undefined;
    this.conformanceClients = undefined;
    this.operatorClients = undefined;
    this.provisionPrivilegedScope = undefined;
    this.tenant = undefined;
    this.people.forget();
  }
}
