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
 * the pipeline primitives, the store-fault idiom, and the compose entry
 * itself. It is never executed — the runtime behavior is pinned by the
 * server's own extension suite; execution here would need real
 * infrastructure for no additional proof.
 */
import { create } from "@bufbuild/protobuf";
import type { DescMessage } from "@bufbuild/protobuf";
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
import { BillingQueryController } from "@stigmer/protos/ai/stigmer/billing/v1/query_pb";
import { ServerEdition } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";

import {
  ArtifactStorageNotFoundError,
  callerIdentityKey,
  callerIdentityOf,
  composeServer,
  createLogger,
  EncryptionScope,
  EncryptionUnavailableError,
  InvalidTokenError,
  loadConfig,
  LOADED_EXECUTION_KEY,
  MintingDisabledError,
  newAgentExecutionTemporalConfigFromEnv,
  newAuthorizeStep,
  newModelCatalogProviderFromDocument,
  newPipeline,
  newR2ArtifactStorage,
  newValidateProtoStep,
  newWorkflowExecutionConfigFromEnv,
  notFoundError,
  RequestContext,
  ResourceNotFoundError,
  ROUTING_SESSION,
  TOKEN_TYPE_EXECUTION_SCOPED,
  WORKFLOW_ROUTING_EXECUTION,
} from "@stigmer/server";
import type {
  AgentExecutionResponseDecorator,
  AgentExecutionTemporalConfig,
  AgentExecutionStatusObserver,
  ArtifactStorage,
  ArtifactStorageDriverFactory,
  Authorizer,
  CallerIdentity,
  ChannelRuntime,
  ComposedServer,
  GateSlotName,
  IdentityVerifier,
  MintedToken,
  ModelCatalogProvider,
  OrganizationDirectory,
  PipelineStep,
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
  SecretCodec,
  SecretService,
  ServerExtension,
  Store,
  VisibilityChangedEvent,
  WorkerFactory,
  WorkflowExecutionTemporalConfig,
} from "@stigmer/server";

/** A permissive Authorizer in the consumer's own code (the O2 shape). */
const authorizer: Authorizer = {
  authorize: (caller: CallerIdentity) =>
    Promise.resolve(
      caller.callerClass === "user"
        ? { kind: "allow" as const }
        : { kind: "deny" as const, reason: "machine callers are refused here" },
    ),
};

/** A claim-or-pass verifier (the O2 chain-entry shape). */
const verifier: IdentityVerifier = {
  name: "consumer-fake",
  verify: (token) =>
    Promise.resolve(
      token.startsWith("fake_")
        ? {
            identityId: "ida_consumer",
            callerClass: "user",
            issuer: "https://issuer.invalid",
            rawToken: token,
          }
        : null,
    ),
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
 * SANDBOX_PROVISIONER_TYPE naming the registered key.
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
  authorizer,
  identityVerifiers: [verifier],
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
    // The C3 serving seam: a composed runtime flips the agentchannel
    // install/messaging/conversation arms from refusal to serving.
    channelRuntime,
    // The 20260830.04 sealing seam: vault-backed wire formats registered
    // by version token ("v1" is the reserved built-in).
    secretCodecs: new Map([["v2", consumerVaultCodec]]),
  },
  services: [registerBillingService],
  workers: [workerFactory],
};

/** The thin composition program's exact shape (blueprint §2a). */
export async function composeFakeCloud(): Promise<ComposedServer> {
  return composeServer({
    config: loadConfig(),
    logger: createLogger({ level: "info", pretty: false }),
    extensions: [fakeExtension],
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
