/**
 * The compile-proof fake extension (sub-project 20260826.09/O1, DD-005).
 *
 * This module typechecks a consumer-shaped composition against the
 * @stigmer/server exports map ALONE — every server import below is the
 * bare package name, resolved through the exports map to dist. If a needed
 * type or function is missing from the blessed surface, THIS file fails to
 * compile: the exports map's completeness is enforced by tsc, not by
 * review memory. Deep imports are deliberately absent; a consumer need
 * that cannot be expressed here is a seam request to OSS.
 *
 * It exercises every extension point a consumer can touch today: the
 * seven-point unit shape (services, workers, edition, authorizer,
 * verifiers, status hooks, the O5 driver kinds, and gate-step
 * registrations into the O4-declared slot names — a misspelled slot fails
 * THIS compile via the GateSlotName union), a gate-step body built from
 * the pipeline primitives, the store-fault idiom, the 20260911.11
 * identity-account seams (the store PORT, the federation capability, and
 * a verifier converging on the exported subject-resolution rule), and the
 * compose entry itself. It is never executed — the runtime behavior is pinned by the
 * server's own extension suite; execution here would need real
 * infrastructure for no additional proof.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage, DescMethod } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ConnectRouter } from "@connectrpc/connect";

import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import {
  ChannelConversationListSchema,
  ChannelConversationSchema,
  ConversationMediaDownloadUrlSchema,
  ConversationTimelineSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_io_pb";
import { InitiateChannelInstallOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/io_pb";
import {
  ChannelTemplatesSchema,
  MessagingChannelsSchema,
  SendChannelMessageOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_io_pb";
import { BillingAccountSchema } from "@stigmer/protos/ai/stigmer/billing/v1/billing_account_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { LicenseCommandController } from "@stigmer/protos/ai/stigmer/billing/license/v1/command_pb";
import { BillingQueryController } from "@stigmer/protos/ai/stigmer/billing/v1/query_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type { ApiResourceRefView } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { ApiResourceRefViewSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import type { PlatformClient } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/api_pb";
import { MintGuestTokenResponseSchema } from "@stigmer/protos/ai/stigmer/iam/platformclient/v1/token_pb";
import type {
  ApiResourceRef,
  IamPolicySpec,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";
import type { Team } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { TeamSchema } from "@stigmer/protos/ai/stigmer/iam/team/v1/api_pb";
import { TeamCommandController } from "@stigmer/protos/ai/stigmer/iam/team/v1/command_pb";
import { TeamQueryController } from "@stigmer/protos/ai/stigmer/iam/team/v1/query_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import {
  ArtifactStorageNotFoundError,
  callerIdentityKey,
  callerIdentityOf,
  canSign,
  composeServer,
  createLogger,
  DuplicateAccountError,
  DuplicatePlatformClientError,
  DuplicatePolicyError,
  EncryptionScope,
  EncryptionUnavailableError,
  iamPolicyStoreContract,
  identityAccountStoreContract,
  identityIdForSubject,
  InvalidTokenError,
  isRunGateCheck,
  loadConfig,
  strictEgressPolicy,
  LOADED_EXECUTION_KEY,
  MintingDisabledError,
  newAgentExecutionTemporalConfigFromEnv,
  EXISTING_RESOURCE_KEY,
  loadedTargetAsMethod,
  newAuthorizeResolvedTargetStep,
  newAuthorizeStep,
  newBuildNewStateStep,
  newBuildUpdateStateStep,
  newModelCatalogProviderFromDocument,
  newPipeline,
  newSystemManagedPlatformClient,
  newResolveSlugStep,
  newR2ArtifactStorage,
  newValidateProtoStep,
  newWorkflowExecutionConfigFromEnv,
  notFoundError,
  PLATFORM_TOKEN_ISSUER,
  platformClientStoreContract,
  platformTokenKeyRingFromPem,
  platformTokenRefusalError,
  signPlatformToken,
  TOKEN_TYPE_CLAIM,
  verifyPlatformToken,
  RequestContext,
  ResourceNotFoundError,
  ROUTING_SESSION,
  SYSTEM_SHARE_CLIENT_SLUG,
  TARGET_RESOURCE_KEY,
  TOKEN_TYPE_EXECUTION_SCOPED,
  WORKFLOW_ROUTING_EXECUTION,
} from "@stigmer/server";
import type {
  AgentExecutionResponseDecorator,
  AgentExecutionTemporalConfig,
  AgentExecutionStatusObserver,
  ArtifactStorage,
  ArtifactStorageDriverFactory,
  AuthorizationQueryEngine,
  Authorizer,
  CallerGuard,
  CallerIdentity,
  ChannelRuntime,
  ComposedServer,
  GateSlotName,
  GuestTokenMinting,
  IamPolicyStore,
  IamPolicyStoreContractCase,
  IamPolicyStoreContractFixture,
  IdentityAccountStore,
  IdentityAccountStoreContractCase,
  IdentityAccountStoreContractFixture,
  IdentityFederation,
  IdentityVerifier,
  ListEntryMeta,
  ListReadScope,
  MintedToken,
  ModelCatalogProvider,
  OrganizationDirectory,
  OutboundEgressPolicy,
  PipelineStep,
  PlatformClientStore,
  PlatformClientStoreContractCase,
  PlatformClientStoreContractFixture,
  PlatformTokenKeyRing,
  PlatformTokenSigningOptions,
  PolicyGrantScope,
  PrincipalDisplay,
  PresignedUpload,
  RawResourceDocument,
  ResourceAuthorizationLifecycle,
  ResourceCreatedEvent,
  ResourceDeletedEvent,
  MemoryCaptureDecision,
  RunnerBootstrapCredentials,
  RunnerCredentialProvider,
  RunnerScopedTokenExchange,
  RunnerScopedTokenRequest,
  SandboxCredentialRequest,
  SandboxProvisioner,
  SandboxProvisionerFactory,
  ScheduleFireCallerMint,
  SecretCodec,
  SecretService,
  ServerExtension,
  SignedPlatformToken,
  Store,
  SystemManagedPlatformClientInput,
  VisibilityChangedEvent,
  WorkerFactory,
  WorkflowExecutionTemporalConfig,
} from "@stigmer/server";

/**
 * A permissive Authorizer in the consumer's own code (the O2 shape), with
 * the lane-admission arm a composition builds over the run gate (P1
 * sp.run-gate): a runtime lane this consumer mints is admitted on the
 * run-gate checks — isRunGateCheck is the OSS-owned definition of that
 * set — and every other check falls to the consumer's own decision.
 */
const authorizer: Authorizer = {
  authorize: (caller: CallerIdentity, check) =>
    Promise.resolve(
      (caller.callerClass === "fake-lane" && isRunGateCheck(check)) ||
        caller.callerClass === "user"
        ? { kind: "allow" as const }
        : { kind: "deny" as const, reason: "machine callers are refused here" },
    ),
};

/**
 * A consumer-shaped caller guard (the 20260902.02 seam) — the
 * platform-client enforcement shape: skip logic lives entirely in the
 * guard (claim-less tokens, the load-bearing token_type exemption),
 * refusal is the guard's own ConnectError with byte-pinned copy, and the
 * Origin header rides the request headers the chassis passes through.
 */
const callerGuard: CallerGuard = {
  name: "consumer-platform-client",
  guard: (caller: CallerIdentity, method: DescMethod, headers: Headers) => {
    void method.parent.typeName;
    if (caller.rawToken === "" || headers.get("origin") === null) {
      return Promise.resolve();
    }
    return Promise.reject(
      new ConnectError("platform client was deleted", Code.Unauthenticated),
    );
  },
};

/**
 * A consumer-shaped identity-account store driver (the 20260911.11 seam,
 * Q-IA-9): the PORT the identity-account domain writes and reads through
 * when a composition registers one — the cloud's `cloud.iam_identity_account`
 * store takes this position. `save` is create-only in effect: a held id
 * raises the exported DuplicateAccountError so the domain's race arms
 * (provisioning resolves the winner by subject; the create RPC answers
 * ALREADY_EXISTS) work over a consumer driver exactly as over the OSS one.
 */
const consumerIdentityAccountStore: IdentityAccountStore = {
  save: (account: IdentityAccount) =>
    Promise.reject(
      new DuplicateAccountError(
        `identity account '${account.metadata?.id ?? ""}' already exists`,
      ),
    ),
  update: () => Promise.resolve(),
  deleteById: () => Promise.resolve(),
  findById: () => Promise.resolve(undefined),
  findByIdpId: () => Promise.resolve(undefined),
  findDirectByIdpId: (idpId: string) =>
    Promise.resolve(
      idpId === "consumer|known"
        ? create(IdentityAccountSchema, {
            metadata: { id: "ida_consumer" },
            spec: { idpId },
          })
        : undefined,
    ),
  findDirectByEmail: () => Promise.resolve(undefined),
  findByIds: () => Promise.resolve([]),
};

/**
 * The port-contract kit over the consumer's driver (20260911.11 A11): a
 * composition's driver test iterates these cases with its own framework
 * — `for (const c of cases) it(c.name, c.run)` — so the same contract the
 * OSS adapter passes is what the driver is held to. Compile-only here:
 * this package proves the exported shape, not a fake's behavior.
 */
export function consumerIdentityAccountStoreContract(): ReadonlyArray<IdentityAccountStoreContractCase> {
  return identityAccountStoreContract(
    async (): Promise<IdentityAccountStoreContractFixture> => ({
      store: consumerIdentityAccountStore,
      disconnect: () => Promise.resolve(),
      cleanup: () => Promise.resolve(),
    }),
  );
}

export async function runConsumerIdentityAccountStoreContract(): Promise<void> {
  for (const contractCase of consumerIdentityAccountStoreContract()) {
    await contractCase.run();
  }
}

/**
 * A consumer-shaped PlatformClient store driver: the PORT the domain's
 * chains, the mint and the verifier's liveness read go through when a
 * composition registers one (the cloud's `cloud.iam_platform_client` store
 * takes this position, registered below as `drivers.platformClientStore`).
 * A held id, slug or client_id is DuplicatePlatformClientError.
 */
const consumerPlatformClients = new Map<string, PlatformClient>();
const consumerPlatformClientStore: PlatformClientStore = {
  save: (client) => {
    const id = client.metadata?.id ?? "";
    if (consumerPlatformClients.has(id)) {
      return Promise.reject(
        new DuplicatePlatformClientError(
          `platform client '${id}' already exists`,
        ),
      );
    }
    consumerPlatformClients.set(id, client);
    return Promise.resolve();
  },
  update: (client) => {
    const id = client.metadata?.id ?? "";
    if (consumerPlatformClients.has(id)) {
      consumerPlatformClients.set(id, client);
    }
    return Promise.resolve();
  },
  deleteById: (id) => {
    consumerPlatformClients.delete(id);
    return Promise.resolve();
  },
  findById: (id) => Promise.resolve(consumerPlatformClients.get(id)),
  findByClientId: (clientId) =>
    Promise.resolve(
      [...consumerPlatformClients.values()].find(
        (client) => client.spec?.clientId === clientId,
      ),
    ),
  findByOrgAndSlug: (org, slug) =>
    Promise.resolve(
      [...consumerPlatformClients.values()].find(
        (client) =>
          client.metadata?.org === org && client.metadata?.slug === slug,
      ),
    ),
  findByOrg: (org) =>
    Promise.resolve(
      [...consumerPlatformClients.values()].filter(
        (client) => client.metadata?.org === org,
      ),
    ),
};

/** The PlatformClient port-contract kit over the consumer's driver (compile-only here). */
export function consumerPlatformClientStoreContract(): ReadonlyArray<PlatformClientStoreContractCase> {
  return platformClientStoreContract(
    async (): Promise<PlatformClientStoreContractFixture> => ({
      store: consumerPlatformClientStore,
      disconnect: () => Promise.resolve(),
      cleanup: () => Promise.resolve(),
    }),
  );
}

/**
 * A consumer's platform-token key ring, built from its configured PEMs
 * (registered below as `drivers.platformTokenKeys`): the active public key
 * first, the previous one still accepted, and the private key that signs.
 */
const consumerPlatformTokenKeys: PlatformTokenKeyRing =
  platformTokenKeyRingFromPem({
    privateKeyPem: process.env["CONSUMER_PLATFORM_TOKEN_PRIVATE_KEY"] ?? "",
    kid: "consumer-signing-key-1",
    publicKeyPems: [process.env["CONSUMER_PLATFORM_TOKEN_PUBLIC_KEY"] ?? ""],
    audience: "https://api.consumer.example",
    ttlSeconds: 900,
  });

/** The consumer guest lane's own lifetime, longer than the ring's user-token default. */
const CONSUMER_GUEST_TOKEN_TTL_SECONDS = 3600;

/**
 * A consumer's own typed platform-token lane: a guest token signed through
 * the exported envelope with the lane's own lifetime, naming the org's
 * system-managed client, and claimed by a verifier on the same envelope —
 * the shape a composition's typed lanes take once open source owns the
 * untyped user-token lane.
 */
export async function mintConsumerGuestToken(
  org: string,
  shareId: string,
): Promise<SignedPlatformToken> {
  if (!canSign(consumerPlatformTokenKeys)) {
    throw new Error("consumer ring cannot sign");
  }
  const client = await ensureConsumerSystemShareClient(org);
  const options: PlatformTokenSigningOptions = {
    ttlSeconds: CONSUMER_GUEST_TOKEN_TTL_SECONDS,
  };
  return signPlatformToken(
    consumerPlatformTokenKeys,
    {
      sub: "ida_consumer_guest",
      [TOKEN_TYPE_CLAIM]: "guest",
      platform_client_id: client.metadata?.id ?? "",
      share_id: shareId,
    },
    options,
  );
}

/**
 * The org's system-managed share client, built by the library and kept in
 * the consumer's own store (the cloud's `cloud.iam_platform_client` driver
 * takes this position): get, else build and save.
 */
async function ensureConsumerSystemShareClient(
  org: string,
): Promise<PlatformClient> {
  const existing = await consumerPlatformClientStore.findByOrgAndSlug(
    org,
    SYSTEM_SHARE_CLIENT_SLUG,
  );
  if (existing !== undefined) {
    return existing;
  }
  const input: SystemManagedPlatformClientInput = {
    org,
    slug: SYSTEM_SHARE_CLIENT_SLUG,
    name: "System Share Client",
  };
  const client = newSystemManagedPlatformClient(input);
  await consumerPlatformClientStore.save(client);
  return client;
}

const consumerGuestTokenVerifier: IdentityVerifier = {
  name: "consumer-guest-token",
  verify(token) {
    const result = verifyPlatformToken(consumerPlatformTokenKeys, token);
    switch (result.outcome) {
      case "foreign":
        return Promise.resolve(null);
      case "refused":
        return Promise.reject(platformTokenRefusalError(result.refusal));
      case "verified":
        if (result.token.tokenType !== "guest") {
          return Promise.resolve(null);
        }
        return Promise.resolve({
          identityId: result.token.subject,
          callerClass: "guest",
          issuer: PLATFORM_TOKEN_ISSUER,
          rawToken: token,
        });
      default: {
        const exhaustive: never = result;
        return Promise.reject(
          new Error(`unknown outcome ${String(exhaustive)}`),
        );
      }
    }
  },
};

/** A consumer's guest-token capability (registered below as `drivers.guestTokenMinting`). */
const consumerGuestTokenMinting: GuestTokenMinting = {
  async mintGuestToken(request) {
    const signed = await mintConsumerGuestToken(request.org, request.slug);
    return create(MintGuestTokenResponseSchema, {
      accessToken: signed.token,
      tokenType: "Bearer",
      expiresIn: CONSUMER_GUEST_TOKEN_TTL_SECONDS,
      guestCookieId: request.guestCookieId,
    });
  },
};

/**
 * A consumer-shaped IamPolicy store driver (the 20260913.01 seam, Q-OR-1):
 * the PORT the IamPolicy domain's grant path writes and reads through when
 * a composition registers one — the cloud's `cloud.iam_policy` store takes
 * this position (registered below as `drivers.iamPolicyStore`).
 * `save` is create-only in effect: a held id raises the exported
 * DuplicatePolicyError so the grant path's race arm (re-read the winner by
 * triple; answer it as the duplicate) works over a consumer driver exactly
 * as over the OSS adapter.
 */
const consumerIamPolicyStore: IamPolicyStore = {
  save: (policy: IamPolicy) =>
    Promise.reject(
      new DuplicatePolicyError(
        `IAM policy '${policy.metadata?.id ?? ""}' already exists`,
      ),
    ),
  deleteById: () => Promise.resolve(),
  findById: () => Promise.resolve(undefined),
  findByPrincipal: () => Promise.resolve([]),
  findByResource: () => Promise.resolve([]),
  findByPrincipalAndResource: () => Promise.resolve([]),
  findByResourceWithRelations: () => Promise.resolve([]),
  countDistinctPrincipalsByResource: () => Promise.resolve(0),
  findScopeTuple: () => Promise.resolve(undefined),
};

/**
 * The IamPolicy port-contract kit over the consumer's driver (the 2a A11
 * shape): a composition's driver test iterates these cases with its own
 * framework so the same contract the OSS adapter passes is what the driver
 * is held to. Compile-only here: this package proves the exported shape,
 * not a fake's behavior.
 */
export function consumerIamPolicyStoreContract(): ReadonlyArray<IamPolicyStoreContractCase> {
  return iamPolicyStoreContract(
    async (): Promise<IamPolicyStoreContractFixture> => ({
      store: consumerIamPolicyStore,
      disconnect: () => Promise.resolve(),
      cleanup: () => Promise.resolve(),
    }),
  );
}

export async function runConsumerIamPolicyStoreContract(): Promise<void> {
  for (const contractCase of consumerIamPolicyStoreContract()) {
    await contractCase.run();
  }
}

/**
 * The outbound-egress registration a managed composition makes: the strict
 * posture, typed against the exported contract so a change to either the
 * type or the constructor is a compile failure here.
 */
const consumerOutboundEgress: OutboundEgressPolicy = strictEgressPolicy();

/**
 * A consumer-shaped policy grant scope (the 20260913.01 seam, Q-OR-3): which
 * kinds a user may grant on in this composition, with which roles. A scope
 * only NARROWS the proto's grantable roles, is total over the enum (an
 * unlisted kind answers none, never throws) and is synchronous — a fact
 * about the edition, not a lookup. This one admits a single per-resource
 * grant, the narrowing a composition would make.
 */
const consumerPolicyGrantScope: PolicyGrantScope = {
  grantableRoles: (kind: ApiResourceKind) =>
    kind === ApiResourceKind.agent ? [IamRole.viewer] : [],
};

/**
 * A consumer-shaped authorization-query engine (the 20260913.01 seam,
 * Q-OR-8): the tuple-half questions only an authorization backend answers
 * over its own graph. It speaks the contract's vocabulary (refs, specs,
 * the wire's relation and kind strings) and renders to its backend's
 * grammar itself; `false` and `[]` are real answers, an outage throws.
 */
const consumerAuthorizationQueries: AuthorizationQueryEngine = {
  check: (
    policy: IamPolicySpec,
    contextualPolicies: ReadonlyArray<IamPolicySpec>,
  ) =>
    Promise.resolve(
      policy.principal?.kind === "identity_account" &&
        policy.resource?.kind === "organization" &&
        contextualPolicies.length === 0,
    ),
  listResourceIds: (
    principal: ApiResourceRef,
    relation: string,
    resourceKind: string,
  ) => {
    void principal.id;
    void relation;
    return Promise.resolve<ReadonlyArray<string>>(
      resourceKind === "agent" ? ["agt_consumer"] : [],
    );
  },
  listPrincipalIds: (
    resource: ApiResourceRef,
    relation: string,
    principalKind: string,
  ) => {
    void resource.id;
    void relation;
    return Promise.resolve<ReadonlyArray<string>>(
      principalKind === "identity_account" ? ["ida_consumer"] : [],
    );
  },
};

/**
 * A consumer-shaped principal display: how an access list names a grantee
 * that is not a person (a team). It answers for the ids its own store
 * knows and omits the rest, which then render by id.
 */
const consumerPrincipalDisplay: PrincipalDisplay = {
  resolve: (kind: ApiResourceKind, ids: ReadonlyArray<string>) =>
    Promise.resolve<ReadonlyMap<string, ApiResourceRefView>>(
      new Map(
        kind === ApiResourceKind.team
          ? ids.map((id) => [
              id,
              create(ApiResourceRefViewSchema, {
                kind: "team",
                id,
                name: "Consumer team",
              }),
            ])
          : [],
      ),
    ),
};

/**
 * A claim-or-pass verifier (the O2 chain-entry shape) that resolves its
 * subject the way both OSS verifiers do — through the exported
 * identityIdForSubject over the composition's own driver, so a provisioned
 * subject is stamped with its account id and an unprovisioned one stays
 * idp-shaped. This is the convergence a composition's own verifier makes
 * instead of restating the rule (20260911.11 S2 slice 3 ruling).
 */
const verifier: IdentityVerifier = {
  name: "consumer-fake",
  verify: async (token) => {
    if (!token.startsWith("fake_")) {
      return null;
    }
    const subject = token.slice("fake_".length);
    return {
      identityId: await identityIdForSubject(
        consumerIdentityAccountStore,
        subject,
      ),
      callerClass: "user",
      issuer: "https://issuer.invalid",
      rawToken: token,
    };
  },
};

/**
 * A consumer-shaped identity-federation capability (the 20260911.11 seam,
 * Q-IA-9): the four federated-account RPC arms the controller dispatches
 * to after its own shared checks, plus the IdP-exists probe. The arms
 * receive the RESOLVED reference and the authenticated caller; the
 * federated natural key and its rows stay on the consumer's own store.
 */
const consumerIdentityFederation: IdentityFederation = {
  createFederatedAccount: (_input, ref, caller) => {
    void caller.identityId;
    return Promise.resolve(
      create(IdentityAccountSchema, {
        metadata: { id: `ida_federated_${ref.slug}` },
      }),
    );
  },
  updateFederatedAccount: () => Promise.resolve(create(IdentityAccountSchema)),
  deprovisionFederatedAccount: () =>
    Promise.resolve(create(IdentityAccountSchema)),
  getByExternalSub: () => Promise.resolve(create(IdentityAccountSchema)),
  providerExists: (org: string, slug: string) =>
    Promise.resolve(org === "consumer-org" && slug === "consumer-idp"),
};

/**
 * A gate-step body built from the exported pipeline primitives — the shape
 * every cloud gate (billing preflight, capacity, tier validation) takes
 * once O4 opens the slots. The store-fault idiom rides along: a typed
 * not-found maps to NotFound, anything else rethrows.
 */
export function consumerGateStep(): PipelineStep<DescMessage> {
  return {
    name: "ConsumerFakeGate",
    execute: () => {
      const missing = false as boolean;
      if (missing) {
        throw notFoundError("billing account", "org-fake");
      }
    },
  };
}

/** The typed store not-found classes are importable for the instanceof idiom. */
export function isStoreNotFound(error: unknown): boolean {
  return error instanceof ResourceNotFoundError;
}

/**
 * A capacity-gate-shaped consumer of the C4 Stage 3 seams: the
 * dispatch-policy configs read through their exported constructors (the
 * oss#397 one-definition rule consumed, never re-derived from env), and
 * the loaded execution read through the exported lifecycle context key —
 * on recover chains ctx.newState is the input message, so the resource
 * rides the metadata map under that key.
 */
const agentExecutionDispatchPolicy: AgentExecutionTemporalConfig =
  newAgentExecutionTemporalConfigFromEnv();
const workflowExecutionDispatchPolicy: WorkflowExecutionTemporalConfig =
  newWorkflowExecutionConfigFromEnv();

export function consumerCapacityGateStep(): PipelineStep<DescMessage> {
  return {
    name: "ConsumerCapacityGate",
    execute: (ctx) => {
      void (agentExecutionDispatchPolicy.activityRouting === ROUTING_SESSION);
      void (
        workflowExecutionDispatchPolicy.workflowActivityRouting ===
        WORKFLOW_ROUTING_EXECUTION
      );
      void ctx.get(LOADED_EXECUTION_KEY);
    },
  };
}

const statusObserver: AgentExecutionStatusObserver = (transition) => {
  void transition.execution.metadata?.id;
  void transition.newPhase;
};

const responseDecorator: AgentExecutionResponseDecorator = (
  execution,
  response,
) => {
  void execution.metadata?.id;
  // The control-signal field the §7 decorator contract names — it already
  // exists on the shared reply schema.
  void response.signal;
};

// The factory constructs through deps.createWorker — the ONLY worker
// construction path the seam offers a consumer (finding 16: a consumer
// importing @temporalio/worker itself pairs the server's connection with
// a second native bridge and its pollers die at boot). This proof never
// runs; it pins that the capability's option surface stays sufficient
// for a consumer-shaped worker.
const workerFactory: WorkerFactory = (deps) =>
  deps.createWorker({
    taskQueue: "consumer-extension-queue",
    activities: { consumerActivity: async (): Promise<void> => {} },
    workflows: { workflowsPath: "compile-proof-workflows-never-resolved" },
  });

/**
 * A consumer-shaped model-catalog provider built the way the cloud's
 * DB-resident baseline builds one (the C1 seam, 20260827.04): a document
 * from the consumer's own source, interpreted by the exported constructor
 * so the semantics stay OSS-owned. The interface remains implementable by
 * hand (ConsumerDriverBundle below keeps the type position covered).
 */
const catalogProvider: ModelCatalogProvider =
  newModelCatalogProviderFromDocument(
    `{"models":[{"id":"consumer-model","harness":"native"}]}`,
  );

/**
 * A consumer-shaped runner-credential provider (the O5 §6c shape). The
 * per-arm fail posture is contract: verify failures collapse to
 * InvalidTokenError (callers fall closed to redaction); a provided lane
 * that cannot mint throws MintingDisabledError (mapped to the
 * presence-based not-minted response).
 */
const credentialProvider: RunnerCredentialProvider = {
  isEnabled: (lane) => lane === TOKEN_TYPE_EXECUTION_SCOPED,
  mint: (lane, _binding, ttlSeconds): MintedToken => {
    if (lane !== TOKEN_TYPE_EXECUTION_SCOPED) {
      throw new MintingDisabledError();
    }
    return { token: "fake-token", ttlSeconds };
  },
  verify: (): string => {
    throw new InvalidTokenError();
  },
  // The C4 capability methods (gate ruling Q1): the four edition-policy
  // touchpoints a composition may take over — the platform exchange, the
  // bootstrap credential fields, the sandbox-provisioning mint, and the
  // ExecutionContext decrypt trust decision. All optional; this consumer
  // proves the shapes compile against the exports map alone.
  exchangeScopedToken: async (
    request: RunnerScopedTokenRequest,
  ): Promise<RunnerScopedTokenExchange> => {
    if (request.arm === "unset") {
      return { minted: false };
    }
    return { minted: true, token: "fake-scoped-token", expiresInSeconds: 60 };
  },
  bootstrapCredentials: async (): Promise<RunnerBootstrapCredentials> => ({
    accessToken: { token: "fake-bootstrap-token", expiresInSeconds: 60 },
    payloadKeys: { keyId: "rpk_fake", keyBase64: "a2V5" },
  }),
  mintSandboxCredential: (request: SandboxCredentialRequest): string =>
    `fake-${request.scope}-token`,
  authorizeExecutionContextRead: async (): Promise<boolean> => false,
  // The fifth capability (C4 Stage 2): decrypt-key resolution for the
  // server-managed rpk_ payload keys the bootstrap arm above hands out.
  resolvePayloadKey: async (keyId: string): Promise<Buffer | undefined> =>
    keyId === "rpk_fake" ? Buffer.from("a2V5", "base64") : undefined,
  // The two parity-entry-20260830.05 capabilities: the workflow-lineage
  // vouching decision (agentexecution create) and the memory
  // capture-eligibility decision (GuardMemoryCapture). Both classify the
  // caller by the implementation's OWN token vocabulary — the shapes
  // compile against the exports map alone.
  vouchRunnerLineageLabels: (
    _caller: CallerIdentity,
    stampedWorkflowExecutionId: string,
  ): boolean => stampedWorkflowExecutionId !== "wfe_unbound",
  authorizeMemoryCapture: (
    _caller: CallerIdentity,
    captureOrg: string,
  ): MemoryCaptureDecision =>
    captureOrg === ""
      ? { verdict: "refuse" }
      : {
          verdict: "admit",
          subjectIdentityAccountId: "ida_fake",
          provedSessionId: "ses_fake",
        },
};

/**
 * A consumer-registered R2 driver built through the exported constructor
 * (the C1 seam, 20260827.04) — the cloud's per-domain-bucket registration
 * shape: the composition owns the config, OSS owns the S3 plumbing.
 */
const consumerR2Driver: ArtifactStorageDriverFactory = () =>
  newR2ArtifactStorage({
    bucket: "consumer-domain-bucket",
    endpoint: "https://r2.invalid",
    accessKeyId: "consumer-key",
    secretAccessKey: "consumer-secret",
    region: "auto",
  });

/**
 * A consumer-registered blob driver (the O5 §6b registration shape) —
 * lazy factory, typed not-found, the widened size/presignPut surface.
 */
const consumerBlobDriver: ArtifactStorageDriverFactory =
  (): ArtifactStorage => ({
    upload: () => Promise.resolve(),
    download: (key) => Promise.reject(new ArtifactStorageNotFoundError(key)),
    size: (key) => Promise.reject(new ArtifactStorageNotFoundError(key)),
    presignPut: (declaredSizeBytes, ttlMs): Promise<PresignedUpload> =>
      Promise.resolve({
        url: `https://blob.invalid/put?size=${declaredSizeBytes}`,
        stagingKey: "staging/fake",
        ttlMs,
      }),
    getSignedUrl: () => Promise.resolve("https://blob.invalid/get"),
    delete: () => Promise.resolve(),
    exists: () => Promise.resolve(false),
    health: () => Promise.resolve(),
  });

/**
 * A consumer-registered sandbox driver (the O6 §6d registration shape) —
 * the full scoped contract: ensure-as-state-machine per scope, idempotent
 * teardown, the Q5 live-state probe. Selected at runtime through
 * SANDBOX_PROVISIONER_TYPE naming the registered key. Reads all three
 * environment facts, the caller's class included, so a driver that
 * decides workspace durability by who asked is proven compilable here.
 */
const consumerSandboxDriver: SandboxProvisionerFactory = ({
  config,
  logger,
}): SandboxProvisioner => {
  void config.backendEndpoint;
  void logger;
  return {
    ensureSessionSandbox: (sessionId, env) => {
      void sessionId;
      void env.taskQueue;
      void env.stigmerToken;
      void env.callerClass;
      return Promise.resolve();
    },
    deprovisionSessionSandbox: () => Promise.resolve(),
    ensureWorkflowSandbox: () => Promise.resolve(),
    deprovisionWorkflowSandbox: () => Promise.resolve(),
    createConnectSandbox: (connectRequestId) =>
      Promise.resolve(connectRequestId),
    deprovisionConnectSandbox: () => Promise.resolve(),
    probe: () => Promise.resolve("absent" as const),
  };
};

/**
 * A consumer-shaped channel runtime (the C3 seam, 20260827.11 ruling Q1) —
 * the full grouped surface: install delegation, whole-method messaging
 * and conversation serving, and the two edition-split CRUD hooks. All
 * groups are required by the type, so a composition that forgets an arm
 * fails THIS compile rather than serving a storing-posture refusal to a
 * live channel user.
 */
const channelRuntime: ChannelRuntime = {
  installs: {
    initiateInstall: (channel, input, caller) => {
      void channel.metadata?.id;
      void caller.identityId;
      return Promise.resolve(
        create(InitiateChannelInstallOutputSchema, {
          authorizationUrl: `https://consent.invalid/${input.resourceId}`,
          state: "fake-state",
        }),
      );
    },
    completeInstall: (channel) =>
      Promise.resolve(create(AgentChannelSchema, channel)),
  },
  messaging: {
    sendMessage: () => Promise.resolve(create(SendChannelMessageOutputSchema)),
    listTemplates: () => Promise.resolve(create(ChannelTemplatesSchema)),
    listMessagingChannels: () =>
      Promise.resolve(create(MessagingChannelsSchema)),
  },
  conversations: {
    listConversations: () =>
      Promise.resolve(create(ChannelConversationListSchema)),
    getConversation: () => Promise.resolve(create(ChannelConversationSchema)),
    getTimeline: () => Promise.resolve(create(ConversationTimelineSchema)),
    getMediaDownloadUrl: () =>
      Promise.resolve(create(ConversationMediaDownloadUrlSchema)),
    reply: () => Promise.resolve(create(SendChannelMessageOutputSchema)),
    takeOver: () => Promise.resolve(create(ChannelConversationSchema)),
    handBack: () => Promise.resolve(create(ChannelConversationSchema)),
    clearAttention: () => Promise.resolve(create(ChannelConversationSchema)),
    escalate: () => Promise.resolve(create(ChannelConversationSchema)),
  },
  enforceWriteConstraints: (channel) => {
    void channel.spec?.runConfig?.modelName;
    return Promise.resolve();
  },
  teardownOnDelete: (channel, caller) => {
    void channel.status?.installState;
    void caller.callerClass;
    return Promise.resolve();
  },
};

/**
 * A consumer-shaped vault-backed secret codec (the 20260830.04 Stage 1
 * seam, ruling Q2) — one enc:v<N>: wire format registered by version
 * token through drivers.secretCodecs. The scope carries the tenancy a
 * per-org KEK keys by; the taxonomy split is contract: a bad VALUE is
 * InvalidCiphertextError (skippable per key), missing MACHINERY is
 * EncryptionUnavailableError (must abort — this fake's every arm, it has
 * no real vault). The batch verbs and delete are optional: absent here,
 * the facade loops the singular verbs and treats delete as a no-op.
 */
const consumerVaultCodec: SecretCodec = {
  version: "v2",
  encrypt: (plaintext: string, scope: EncryptionScope) => {
    void plaintext;
    void scope.kekKeyName();
    return Promise.reject(
      new EncryptionUnavailableError("compile-proof codec — never invoked"),
    );
  },
  decrypt: (encrypted: string) => {
    void encrypted;
    return Promise.reject(
      new EncryptionUnavailableError("compile-proof codec — never invoked"),
    );
  },
};

/**
 * A consumer-shaped schedule-fire caller mint (the stigmer-cloud#572
 * seam) — the identity a schedule fire acts as, minted per fire. The
 * cloud edition's real driver mints a schedule JWT (sub = the org's
 * system-schedule account, claim = the firing Schedule id); this fake
 * proves the contract compiles from consumer code.
 */
const consumerScheduleFireCaller: ScheduleFireCallerMint = {
  mintFireCaller: (org: string, scheduleId: string) => {
    void scheduleId;
    return Promise.resolve({
      identityId: `ida_schedule_${org}`,
      callerClass: "schedule",
      issuer: "stigmer",
      rawToken: "compile-proof.jwt",
    });
  },
};

/**
 * The secret-convergence sweep's exact shape (Stage 3 consumes it): page
 * raw documents through the blessed maintenance verbs, reseal through the
 * facade's one upgrade door, and persist only when nothing interleaved —
 * the bytes-guarded compare-and-swap. Never executed; it pins that the
 * Store surface and the facade verbs stay sufficient for the sweep.
 */
export async function consumerSweepPage(
  store: Store,
  secrets: SecretService,
  afterId: string,
): Promise<string | undefined> {
  const scope = EncryptionScope.forOrganizationResource(
    "consumer-org",
    "environment",
    "env-slug",
  );
  const page: RawResourceDocument[] = await store.findResourcesRawOrderedAfter(
    ApiResourceKind.environment,
    afterId,
    100,
  );
  for (const row of page) {
    void (await secrets.reencrypt("enc:v1:fake", scope.withKeyName("KEY")));
    void (await store.replaceResourceDataIfUnchanged(
      ApiResourceKind.environment,
      row.id,
      row.data,
      row.data,
    ));
  }
  return page.length > 0 ? page[page.length - 1]?.id : undefined;
}

/**
 * An extension-registered service handler built the OSS controller idiom
 * (C4 Stage 4): the verified caller read once via callerIdentityOf, then
 * a chain fronted by the exported Authorize (descriptor-driven from the
 * method's proto options — the ratified three-arm decision mapping and
 * the internal-caller skip consumed, never re-derived) and ValidateProto
 * steps, executed by the exported pipeline (which owns the
 * sanitized-Internal error contract). This is the shape every cloud
 * fleet-domain service takes.
 */
const registerBillingService = (router: ConnectRouter): void => {
  const method = BillingQueryController.method.getBillingAccount;
  router.service(BillingQueryController, {
    getBillingAccount: async (input, ctx) => {
      // The stamp side of the identity contract compiles for consumers
      // too — extension service TESTS set this key on their router
      // transport's contextValues (production stamping stays the
      // interceptors' job).
      void ctx.values.get(callerIdentityKey);
      const reqCtx = new RequestContext(
        method.input,
        input,
        callerIdentityOf(ctx),
      );
      await newPipeline<typeof method.input>(
        "consumer-billing-get",
        createLogger({ level: "error", pretty: false }),
      )
        .addStep(newAuthorizeStep(method, authorizer))
        .addStep(newValidateProtoStep())
        .build()
        .execute(reqCtx);
      return create(BillingAccountSchema, { orgId: reqCtx.newState.orgId });
    },
  });
};

/**
 * A consumer-served CREATE of an envelope kind this server has no
 * controller for (a cloud_only kind): the chain runs the exported
 * ResolveSlug and BuildNewState between ValidateProto and the consumer's
 * own persistence, with the RequestContext carrying the kind so the id
 * prefix comes from the kind's proto meta. The slug derivation, the id
 * spelling, the audit stamp and the visibility default are therefore the
 * OSS steps' own, never a consumer copy; CheckDuplicate stays the
 * consumer's (it reads the consumer's table).
 */
const registerLicenseService = (router: ConnectRouter): void => {
  const method = LicenseCommandController.method.create;
  router.service(LicenseCommandController, {
    create: async (input, ctx) => {
      const reqCtx = new RequestContext(
        method.input,
        input,
        callerIdentityOf(ctx),
        ApiResourceKind.license,
      );
      await newPipeline<typeof method.input>(
        "consumer-license-create",
        createLogger({ level: "error", pretty: false }),
      )
        .addStep(newAuthorizeStep(method, authorizer))
        .addStep(newValidateProtoStep())
        .addStep(newResolveSlugStep())
        .addStep(newBuildNewStateStep())
        .build()
        .execute(reqCtx);
      // The shaped envelope: minted id, derived slug, stamped audit.
      return reqCtx.newState;
    },
  });
};

/**
 * A consumer-served UPDATE and READ BY REFERENCE of the same shape of kind
 * (an enterprise-tier Team, which this server registers no service for).
 * The consumer's own loaders read its own table and stash the row under
 * the exported keys; BuildUpdateState then decides what a client may
 * change and stamps the audit, and AuthorizeResolvedTarget authorizes the
 * loaded row exactly as the kind's `get` would, with `get`'s copy.
 */
const storedTeam = (id: string): Team =>
  create(TeamSchema, { metadata: { id, org: "acme", slug: "sre" } });

const registerTeamService = (router: ConnectRouter): void => {
  const update = TeamCommandController.method.update;
  router.service(TeamCommandController, {
    update: async (input, ctx) => {
      const reqCtx = new RequestContext(
        update.input,
        input,
        callerIdentityOf(ctx),
        ApiResourceKind.team,
      );
      const loadExisting: PipelineStep<typeof update.input> = {
        name: "LoadExistingTeam",
        execute: (stepCtx) => {
          stepCtx.set(
            EXISTING_RESOURCE_KEY,
            storedTeam(stepCtx.input.metadata?.id ?? ""),
          );
        },
      };
      await newPipeline<typeof update.input>(
        "consumer-team-update",
        createLogger({ level: "error", pretty: false }),
      )
        .addStep(newAuthorizeStep(update, authorizer))
        .addStep(newValidateProtoStep())
        .addStep(loadExisting)
        .addStep(newBuildUpdateStateStep())
        .build()
        .execute(reqCtx);
      return reqCtx.newState;
    },
  });
  const getByReference = TeamQueryController.method.getByReference;
  router.service(TeamQueryController, {
    getByReference: async (input, ctx) => {
      const reqCtx = new RequestContext(
        getByReference.input,
        input,
        callerIdentityOf(ctx),
        ApiResourceKind.team,
      );
      const loadByReference: PipelineStep<typeof getByReference.input> = {
        name: "LoadTeamByReference",
        execute: (stepCtx) => {
          stepCtx.set(TARGET_RESOURCE_KEY, storedTeam("tm_consumer"));
        },
      };
      await newPipeline<typeof getByReference.input>(
        "consumer-team-get-by-reference",
        createLogger({ level: "error", pretty: false }),
      )
        .addStep(newAuthorizeStep(getByReference, authorizer))
        .addStep(newValidateProtoStep())
        .addStep(loadByReference)
        .addStep(
          newAuthorizeResolvedTargetStep(
            authorizer,
            loadedTargetAsMethod(TeamQueryController.method.get),
          ),
        )
        .build()
        .execute(reqCtx);
      return reqCtx.get(TARGET_RESOURCE_KEY) as Team;
    },
  });
};

/**
 * A consumer tuple-lifecycle driver (the C2 seam, ruling Q2) — receives
 * fully-resolved events; the tuple writes are the consumer's own.
 */
const authorizationLifecycle: ResourceAuthorizationLifecycle = {
  onResourceCreated: (event: ResourceCreatedEvent) => {
    void event.parentLinks;
    void event.ownerAttribution;
    void event.visibilityShapes;
    return Promise.resolve();
  },
  onResourceDeleted: (event: ResourceDeletedEvent) => {
    void event.resourceId;
    return Promise.resolve();
  },
  onVisibilityChanged: (event: VisibilityChangedEvent) => {
    void event.shapesToCreate;
    void event.shapesToDelete;
    return Promise.resolve();
  },
};

/**
 * A consumer list read scope (the 20260830.01 seam; its candidates carry
 * `authorizationParent` since stigmer-cloud 20260913.04 T04): the
 * restrict verb asks the consumer's authorization backend about the
 * parent when a candidate carries one and about the row itself otherwise
 * — the cloud driver's shape, typed against the barrel alone.
 */
const listReadScope: ListReadScope = {
  authorizedResourceIds: (caller: CallerIdentity, kind: ApiResourceKind) => {
    void caller.identityId;
    void kind;
    return Promise.resolve<ReadonlySet<string>>(new Set());
  },
  restrictListEntries: (
    caller: CallerIdentity,
    kind: ApiResourceKind,
    entries: ReadonlyArray<ListEntryMeta>,
  ) => {
    void caller.identityId;
    const objects = entries.map((entry) => {
      const parent = entry.authorizationParent;
      return parent === undefined
        ? `${ApiResourceKind[kind]}:${entry.id}`
        : `${ApiResourceKind[parent.parentKind]}:${parent.parentId}`;
    });
    void objects;
    return Promise.resolve<ReadonlySet<string>>(
      new Set(entries.map((entry) => entry.id)),
    );
  },
};

/** A consumer organization directory (the C2 seam, ruling Q7). */
const organizationDirectory: OrganizationDirectory = {
  refusesEnumeration: true,
  listMyOrganizationIds: (caller: CallerIdentity) => {
    void caller.identityId;
    return Promise.resolve<ReadonlyArray<string>>([]);
  },
  getOrganizationIdByExternalOrgId: (externalOrgId: string) => {
    void externalOrgId;
    return Promise.resolve<string | undefined>(undefined);
  },
};

/** The whole unit — every point a consumer can populate today. */
export const fakeExtension: ServerExtension = {
  name: "consumer-fake",
  edition: ServerEdition.cloud,
  // The 20260904.02 point: the unit's verifiers are its only admission
  // path, so tokenless non-public requests are refused. Typed as the
  // literal `true` — `false` does not compile; omit the field instead.
  requireAuthentication: true,
  authorizer,
  identityVerifiers: [verifier, consumerGuestTokenVerifier],
  // The 20260902.02 seam: post-authentication caller guards, serving
  // chain only.
  callerGuards: [callerGuard],
  // The O4 slot vocabulary is typed: registering into a slot name outside
  // GateSlotName fails this compile (the §2b contract's compile-time layer).
  gateSteps: new Map<GateSlotName, ReadonlyArray<PipelineStep<DescMessage>>>([
    ["agent-execution-create:pre-side-effect-gate", [consumerGateStep()]],
    // The recover slot consumes the exported loaded-execution key (C4
    // Stage 3) — the capacity-gate shape reads the resource off the
    // metadata map there.
    [
      "agent-execution-recover:pre-side-effect-gate",
      [consumerCapacityGateStep()],
    ],
    ["org-create:post-persist", [consumerGateStep()]],
    // The sixth ratified slot (C4): the workflow-execution chains'
    // capacity-gate position.
    ["sandbox-acquisition:gate", [consumerCapacityGateStep()]],
    // The seventh (20260911.11, Q-IA-9): after the caller's account is
    // persisted or found inside provisionMyAccount — the cloud's
    // personal-organization ensure and backfill ride it.
    ["identity-account-provision:post-persist", [consumerGateStep()]],
    // The eighth: the IamPolicy create chain, before the grant is written
    // — where an edition that serves teams refuses a team it cannot admit.
    ["iam-policy-create:pre-side-effect-gate", [consumerGateStep()]],
  ]),
  statusTransitionHooks: {
    observers: [statusObserver],
    responseDecorators: [responseDecorator],
  },
  drivers: {
    modelCatalogProvider: catalogProvider,
    runnerCredentialProvider: credentialProvider,
    artifactStorageDrivers: new Map([
      ["consumer-blob", consumerBlobDriver],
      ["consumer-r2", consumerR2Driver],
    ]),
    sandboxProvisionerDrivers: new Map([
      ["consumer-sandbox", consumerSandboxDriver],
    ]),
    resourceAuthorizationLifecycle: authorizationLifecycle,
    organizationDirectory,
    // The 20260830.01 list read scope, carrying the T04 parent on its
    // candidates.
    listReadScope,
    // The C3 serving seam: a composed runtime flips the agentchannel
    // install/messaging/conversation arms from refusal to serving.
    channelRuntime,
    // The 20260830.04 sealing seam: vault-backed wire formats registered
    // by version token ("v1" is the reserved built-in).
    secretCodecs: new Map([["v2", consumerVaultCodec]]),
    // The stigmer-cloud#572 seam: who a schedule fire acts as.
    scheduleFireCaller: consumerScheduleFireCaller,
    // The 20260911.11 seams: the identity-account domain served over the
    // consumer's own store, and the federated arms only it can serve.
    identityAccountStore: consumerIdentityAccountStore,
    identityFederation: consumerIdentityFederation,
    // The 20260913.01 seams: the IamPolicy domain served over the
    // consumer's own store, the kinds it grants on, and the tuple-half
    // queries only its authorization backend can answer.
    iamPolicyStore: consumerIamPolicyStore,
    policyGrantScope: consumerPolicyGrantScope,
    authorizationQueries: consumerAuthorizationQueries,
    // How the consumer's access lists name a team grantee.
    principalDisplay: consumerPrincipalDisplay,
    // The outbound-egress seam: which addresses this edition's control
    // plane may dial when it reaches a URL a user supplied. A managed
    // composition registers the strict posture the library exports and
    // owns no copy of the address ranges.
    outboundEgress: consumerOutboundEgress,
    // The PlatformClient seams: the domain served over the consumer's own
    // store, the key ring its tokens ride, and the guest mint only it
    // hosts.
    platformClientStore: consumerPlatformClientStore,
    platformTokenKeys: consumerPlatformTokenKeys,
    guestTokenMinting: consumerGuestTokenMinting,
  },
  services: [
    registerBillingService,
    registerLicenseService,
    registerTeamService,
  ],
  workers: [workerFactory],
};

/** The thin composition program's exact shape (blueprint §2a). */
export async function composeFakeCloud(): Promise<ComposedServer> {
  return composeServer({
    config: loadConfig(),
    logger: createLogger({ level: "info", pretty: false }),
    extensions: [fakeExtension],
    // A consumer runs the library unbundled, so the build stamp is never
    // set for it; it states the release of the package it installed.
    version: "0.0.0-consumer",
  });
}

/**
 * The Stage-3 sweep's runtime wiring shape (20260830.04 gate ruling G2):
 * a composition's maintenance lane reaches the LIVE composed facade and
 * store off the compose return — never a twin facade built from the same
 * codec map, which would duplicate KEK caches and drift from the
 * boot-resolved write version.
 */
export async function consumerSweepOverComposedServer(
  server: ComposedServer,
): Promise<void> {
  await consumerSweepPage(server.store, server.secrets, "");
}

/**
 * The exported driver interfaces are consumable in extension signatures —
 * the O5 registrations above populate them; this bundle keeps the plain
 * type positions covered too.
 */
export interface ConsumerDriverBundle {
  readonly store: Store;
  readonly artifactStorage: ArtifactStorage;
  readonly modelCatalog: ModelCatalogProvider;
  readonly runnerCredentials: RunnerCredentialProvider;
}
