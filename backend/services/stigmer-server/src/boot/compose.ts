/**
 * The staged composition root (D2 §2, ratified against Go's two-phase
 * nil-then-inject wiring): plain functions building the graph in
 * dependency order — config → storage → temporal → controllers → routes →
 * listen. Every dependency is a required parameter; a missing one is a
 * compile error or a loud boot throw, NEVER a silent no-op (the Go bug
 * class the inventory flags).
 *
 * Scaffold stage: the storage and temporal stages are seams (src/store/,
 * src/temporal/ — sub-project #4 and the execution cluster fill them); the
 * served surface is the health service and the registry lanes.
 *
 * Boot ordering is contract (Go server.go:739-743, 806, 839-843): health
 * flips SERVING only when wiring is complete, and the port binds AFTER
 * that — the CLI's serverGate TCP probe treats port-bind as readiness.
 * Shutdown is the reverse (grpc lib Stop): NOT_SERVING first, then drain.
 *
 * Extensions (DD-006, sub-project 20260826.09/O1): the optional
 * `extensions` units resolve FIRST — a bad registry aborts boot before any
 * stage has side effects — and their contributions ride the existing
 * stages (services in the one routes closure, workers on the manager's
 * factory list, the edition into the platform controller). With no
 * extensions composed, every stage below behaves byte-identically to
 * before the parameter existed; the conformance rosters pin that.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import type { ConnectRouter, Transport } from "@connectrpc/connect";

import { HealthCheckResponse_ServingStatus as ServingStatus } from "@stigmer/protos/grpc/health/v1/health_pb";

import { registerAgentServices } from "../domain/agent/controller.js";
import {
  newConfigFromEnv,
  ROUTING_SESSION,
} from "../domain/agentexecution/temporal/config.js";
import { registerAgentExecutionServices } from "../domain/agentexecution/controller.js";
import {
  LocalArtifactStorage,
  newArtifactStorage,
} from "../artifactstorage/artifact-storage.js";
import type { ArtifactStorage } from "../artifactstorage/artifact-storage.js";
import { StreamBroker } from "../domain/agentexecution/stream-broker.js";
import { newExecutionEngineStateProvider } from "../temporal/agentexecution/engine-client.js";
import { newMcpServerEngineStateProvider } from "../temporal/mcpserver/engine-client.js";
import { newAgentExecutionWorkerFactory } from "../temporal/agentexecution/worker.js";
import { TemporalManager } from "../temporal/manager.js";
import { loadServerPayloadCodecs } from "../temporal/payload-codec.js";
import type { Client as TemporalClient } from "@temporalio/client";

import { ScheduleArtifact } from "../temporal/schedule/artifact.js";
import { newScheduleConfigFromEnv } from "../temporal/schedule/config.js";
import { ScheduleReconciler } from "../temporal/schedule/reconciler.js";
import { RunStarter } from "../temporal/schedule/run-starter.js";
import { ScheduleSyncer } from "../temporal/schedule/syncer.js";
import { newScheduleWorkerFactory } from "../temporal/schedule/worker.js";
import { registerScheduleServices } from "../domain/schedule/controller.js";
import { RuntimeResolutionService } from "../domain/environment/resolution/resolution.js";
import { ManagedEnvironmentService } from "../domain/mcpserver/oauth/managed-env.js";
import { registerAgentInstanceServices } from "../domain/agentinstance/controller.js";
import { registerAgentChannelServices } from "../domain/agentchannel/controller.js";
import { registerChannelConversationServices } from "../domain/agentchannel/conversation.js";
import { registerChannelMessageServices } from "../domain/agentchannel/message.js";
import { registerAgentShareServices } from "../domain/agentshare/controller.js";
import { registerApiKeyServices } from "../domain/apikey/controller.js";
import { newApiKeyIdentityVerifier } from "../domain/apikey/verifier.js";
import { registerArtifactServices } from "../domain/artifact/controller.js";
import { newOidcIdentityVerifier } from "../identity/oidc-verifier.js";
import {
  createArtifactFileServer,
  warnOnLegacyArtifactLayout,
} from "../domain/artifact/file-server.js";
import { registerChannelAppServices } from "../domain/channelapp/controller.js";
import { registerEnvironmentServices } from "../domain/environment/controller.js";
import { registerExecutionContextServices } from "../domain/executioncontext/controller.js";
import { registerGitHubServices } from "../domain/github/controller.js";
import { registerMemoryServices } from "../domain/memory/controller.js";
import { registerOAuthAppServices } from "../domain/oauthapp/controller.js";
import { registerOrganizationServices } from "../domain/organization/controller.js";
import { registerMcpServerServices } from "../domain/mcpserver/controller.js";
import { registerPlatformServices } from "../domain/platform/controller.js";
import { registerProjectServices } from "../domain/project/controller.js";
import { registerSessionServices } from "../domain/session/controller.js";
import { registerSkillServices } from "../domain/skill/controller.js";
import {
  DEFAULT_SLOT_TTL_MS,
  MAX_ZIP_SIZE,
} from "../domain/skill/constants.js";
import { newSkillArtifactStorage } from "../domain/skill/storage/artifact-storage.js";
import {
  newSkillTransferLane,
  uploadUrl as skillUploadUrl,
} from "../domain/skill/transfer/handler.js";
import { UploadSlots } from "../domain/skill/transfer/slots.js";
import {
  DEFAULT_WRITE_VERSION,
  ENCRYPTION_KEY_ENV_VAR,
  ENCRYPTION_KEY_FILE_NAME,
  ENCRYPTION_WRITE_VERSION_ENV_VAR,
  SecretService,
  StaticKeySecretCodec,
} from "../encryption/encryption.js";
import type { SecretCodec } from "../encryption/codec.js";
import { getOrCreateNamedKey } from "../encryption/key-manager.js";
import { V1_VERSION } from "../encryption/v1-codec.js";
import { registerActivityServices } from "../query/activity/controller.js";
import { ActivityHandler } from "../query/activity/handler.js";
import { registerSearchServices } from "../query/search/controller.js";
import { SearchHandler } from "../query/search/handler.js";
import { SqliteSearchQueryStore } from "../query/search/query-store.js";
import { newSearchableResourceRegistry } from "../query/search/registry.js";
import { buildInterceptorChain } from "../pipeline/chain.js";
import { createVerifierChainInterceptor } from "../pipeline/interceptors/auth.js";
import { createErrorBoundaryInterceptor } from "../pipeline/interceptors/error-boundary.js";
import { newPermissiveSingleTeamAuthorizer } from "../pipeline/steps/authorize.js";
import { newExecutionScopedRunnerCredentialProvider } from "../runnerauth/runner-credential-provider.js";
import { RunnerAuthService } from "../runnerauth/runnerauth.js";
import { PostgresStore } from "../store/postgres/store.js";
import { SqliteStore } from "../store/sqlite/store.js";
import type { Store } from "../store/interface.js";
import { resolveExtensions } from "../extensions/registry.js";
import type { ServerExtension } from "../extensions/registry.js";
import { registerWorkflowServices } from "../domain/workflow/controller.js";
import {
  bundledModelRegistryDocument,
  bundledTaskKindRegistryDocument,
} from "../domain/workflow/registry/bundled.js";
import type { ModelCatalogProvider } from "../domain/workflow/registry/model-catalog-provider.js";
import { ModelRegistryStore } from "../domain/workflow/registry/model-registry-store.js";
import { InProcessValidator } from "../domain/workflow/validation/validator.js";
import { registerWorkflowInstanceServices } from "../domain/workflowinstance/controller.js";
import { registerWorkflowExecutionServices } from "../domain/workflowexecution/controller.js";
import { StreamBroker as WorkflowExecutionStreamBroker } from "../domain/workflowexecution/stream-broker.js";
import {
  newWorkflowExecutionConfigFromEnv,
  WORKFLOW_ROUTING_EXECUTION,
} from "../domain/workflowexecution/temporal/config.js";
import { builtInSandboxProvisionerFactories } from "../sandbox/builtins.js";
import { newSandboxLane } from "../sandbox/lane.js";
import { newSandboxProvisioner } from "../sandbox/provisioner.js";
import { newWorkflowSandboxTerminalObserver } from "../sandbox/steps.js";
import { newWorkflowExecutionEngineStateProvider } from "../temporal/workflowexecution/engine-client.js";
import { newWorkflowExecutionWorkerFactory } from "../temporal/workflowexecution/worker.js";
import { HealthState, registerHealthService } from "../transport/health.js";
import { resolveConsoleAssets } from "../transport/console/assets.js";
import { createConsoleLane } from "../transport/console/handler.js";
import { createRegistryLanes } from "../transport/registry/lanes.js";
import { createUnifiedPortServer } from "../transport/server.js";
import type { ServerConfig } from "./config.js";
import { createInProcessClients } from "./inprocess.js";
import type { InProcessClients } from "./inprocess.js";
import type { Logger } from "./logger.js";

export interface ComposedServer {
  healthState: HealthState;
  /** The persistence layer (exposed for tests; domain code gets it injected). */
  store: Store;
  /**
   * The composed secret-encryption facade — the SAME instance every
   * domain seals and opens with (one facade per composition, the Go
   * one-pointer posture). Exposed for compositions whose extensions run
   * maintenance lanes over stored ciphertext — the secret-convergence
   * sweep's reencrypt door and the encryption-state census (convergence
   * 20260830.04 Stage 3, gate ruling G2): a twin facade built from the
   * same codec map would duplicate KEK caches and silently drift from
   * the boot-resolved write version.
   */
  secrets: SecretService;
  /**
   * The Temporal lifecycle manager (exposed for composed tests asserting
   * engine-state behavior). Health semantics are unchanged by it: a down
   * engine never flips gRPC health — that is the engine-unavailable
   * posture the agentexecution suites pin.
   */
  temporalManager: TemporalManager;
  /**
   * The runner-token service (exposed for boot tests and for the
   * executioncontext decrypt-lane tests, which mint scope-bound tokens
   * against the SAME key the server verifies with; the platform exchange
   * RPC — the mint side — lands with its own sub-project).
   */
  runnerAuthService: RunnerAuthService;
  /**
   * The agentexecution broadcast fabric (exposed for tests and, with #18,
   * the Temporal worker's recovery broadcasts — Go's GetStreamBroker).
   * UpdateStatus is the production writer.
   */
  agentExecutionStreamBroker: StreamBroker;
  /**
   * The workflowexecution broadcast fabric (exposed for tests and for the
   * Temporal worker's persist broadcasts, #21 — Go's GetStreamBroker).
   * UpdateStatus, the lifecycle RPCs, and the worker's activities are the
   * production writers.
   */
  workflowExecutionStreamBroker: WorkflowExecutionStreamBroker;
  /**
   * The in-process router transport — the same routes and interceptor
   * chain as the serving router EXCEPT the position-1 identity source
   * (DD-002's bufconn shape; O2 ruling Q4: this lane stamps the internal
   * caller class, the serving chain runs the verifier chassis). Exposed
   * because it is the one lane that reaches EVERY registered service,
   * extension services included (blueprint 20260826.02/03 §8):
   * compositions build clients to their extension services over it, and
   * the O1 extension suite proves both-router visibility through it.
   */
  inProcessTransport: Transport;
  /** Completes wiring, flips SERVING, binds the port; returns the bound port. */
  start(): Promise<number>;
  /** NOT_SERVING first, stop background work, drain connections. */
  shutdown(): Promise<void>;
}

export interface ComposeOptions {
  config: ServerConfig;
  logger: Logger;
  /**
   * Named extension units composed into this server (DD-006). Omitted or
   * empty means plain OSS — byte-identical wire behavior, pinned by the
   * conformance rosters.
   */
  extensions?: ReadonlyArray<ServerExtension>;
  /** Test seam forwarded to the model-registry upstream fetch. */
  fetchImpl?: typeof fetch;
  /** Test seam: bind an ephemeral port instead of config.grpcPort. */
  portOverride?: number;
  host?: string;
}

export async function composeServer(
  options: ComposeOptions,
): Promise<ComposedServer> {
  const { config, logger } = options;

  // Stage: extensions — resolves and validates BEFORE any stage has side
  // effects (DD-006 §2b: a bad registry is a loud boot throw, never a
  // partially-wired server). The empty set resolves to explicit defaults
  // and logs nothing, keeping today's boot output stable.
  const extensions = resolveExtensions(options.extensions);
  if (extensions.unitNames.length > 0) {
    logger.info("extension units composed", {
      units: extensions.unitNames.join(", "),
    });
  }
  // The ONE composed Authorizer (DD-007 §3): an extension's registration
  // or the OSS permissive single-team default. Resolved here, handed to
  // every controller as an explicit dependency — the Authorize step at
  // position 1 of every chain calls it (O2).
  const authorizer =
    extensions.authorizer ?? newPermissiveSingleTeamAuthorizer();
  // The C2 tuple-lifecycle driver (ruling Q2): undefined = the three
  // shared tuple steps (CreateAuthorizationTuples / CleanupIamPolicies /
  // UpdateVisibilityTuples) no-op — OSS behavior byte-identical. Handed
  // to every resource controller as an explicit dependency, the same
  // threading as the authorizer.
  const authorizationLifecycle =
    extensions.drivers.resourceAuthorizationLifecycle;

  // Stage: storage — the driver selection seam (DD-010): DATABASE_URL
  // present → Postgres (async connect + advisory-locked migrations), else
  // sqlite on DB_PATH (migrations v1–v7, incl. adopting a Go-created
  // database — D2 §3 schema continuity). Postgres wins when both are set:
  // DB_PATH always has a default value, so no other precedence could ever
  // select Postgres (config.ts documents the contract). A failure here is
  // a loud boot throw, never a degraded server. The operator identity
  // (#400) is installed by main.ts — once per PROCESS, before any writer
  // exists — not here: composeServer is re-entrant for tests, the
  // identity seam deliberately is not.
  let store: Store;
  if (config.databaseUrl !== "") {
    store = await PostgresStore.open(config.databaseUrl, logger);
    logger.info("storage driver selected", { driver: "postgres" });
  } else {
    store = SqliteStore.open(config.dbPath, logger);
    logger.info("storage driver selected", {
      driver: "sqlite",
      dbPath: config.dbPath,
    });
  }

  // Stage: keys — the ratified fail-loud boot ASYMMETRY (D2 cross-domain
  // invariants; Go server.go:277-293):
  //
  //   - Encryption key failure → WARN and continue with a keyless
  //     pass-through v1 codec. Plaintext at rest is tolerable (the write
  //     steps WARN per request, oss#394); refusing to boot over it is not.
  //   - Runner-token key failure → FATAL (throw). The EC read RPCs redact
  //     by default, so a server that cannot mint runner tokens would hand
  //     every execution redaction markers instead of its secrets — the
  //     exact silent-junk failure the oss#405 fail-loud doctrine forbids.
  //     (The verify side is live: the executioncontext decrypt lane. The
  //     mint side — the platform exchange RPC — arrives with its
  //     sub-project.)
  //
  // The versioned-codec seam (20260830.04 Stage 1, ruling Q2): the
  // built-in v1 codec installs HERE, never in the registry (the
  // default-lives-with-the-consumer doctrine), and merges with the
  // extension-registered codecs. The write version resolves FAIL-FAST:
  // naming a version with no codec is a boot throw (deliberately outside
  // the WARN-degrade catch — only the KEY ladder degrades; a
  // misconfigured write version must never silently write v1). The env
  // vars stay off ServerConfig, the key-manager posture: no config entry
  // exists before the code that reads it.
  let v1Key: Buffer | undefined;
  try {
    v1Key = getOrCreateNamedKey(
      ENCRYPTION_KEY_ENV_VAR,
      ENCRYPTION_KEY_FILE_NAME,
    );
  } catch (error) {
    logger.warn(
      "Failed to initialize encryption - secret values will be stored in plaintext",
      { error: error instanceof Error ? error.message : String(error) },
    );
    v1Key = undefined;
  }
  const secretCodecs = new Map<string, SecretCodec>([
    [V1_VERSION, new StaticKeySecretCodec(v1Key)],
    ...extensions.drivers.secretCodecs,
  ]);
  // Blank normalizes to the default — a rollback lever must be robust to
  // sloppy unsetting (the cloud EncryptionConfig contract).
  const writeVersionValue = process.env[ENCRYPTION_WRITE_VERSION_ENV_VAR] ?? "";
  const secretService = SecretService.withCodecs({
    codecs: secretCodecs,
    writeVersion:
      writeVersionValue === "" ? DEFAULT_WRITE_VERSION : writeVersionValue,
  });
  logger.info("secret encryption configured", {
    writeVersion:
      writeVersionValue === "" ? DEFAULT_WRITE_VERSION : writeVersionValue,
    registeredCodecs: [...secretCodecs.keys()].sort(),
  });
  const runnerAuthService = RunnerAuthService.fromEnv();
  // The runner-credential seam (§6c, O5): the composed provider, or the
  // OSS execution-scoped default over the service above. The concrete
  // service is constructed and exposed UNCONDITIONALLY either way — its
  // boot-fatal key posture is the ratified cross-domain invariant, and the
  // boot/EC-decrypt tests mint against the server's own key through it.
  const runnerCredentials =
    extensions.drivers.runnerCredentialProvider ??
    newExecutionScopedRunnerCredentialProvider(runnerAuthService);

  // Stage: temporal (#18). Construction is sync and connection-free —
  // initialConnect/startWorkers/startHealthMonitor run in start(), all
  // NON-fatal (Go server.go: the server boots and serves with the engine
  // unavailable; the health monitor keeps retrying). The one boot-fatal
  // arm is a PRESENT-but-malformed payload-encryption key: an operator
  // who set the key intended runner history to be encrypted, and failing
  // on the first runner payload read would be worse than failing here.
  //
  // The agent-execution temporal config lives with the controllers stage
  // (not here) because the session update pipeline's execution-target
  // immutability step must resolve UNSPECIFIED through the SAME default
  // dispatch uses — one definition, so policy and dispatch can never
  // disagree (oss#397).
  const temporalConfig = newConfigFromEnv();
  // The workflow-execution twin (#21) — its config has no policy
  // consumer, so it lives here with the temporal stage.
  const workflowExecutionTemporalConfig = newWorkflowExecutionConfigFromEnv();
  // The sandbox lane (§6d, O6): the configured driver — built-in tier or
  // composition-registered — or the default external-runner posture
  // (SANDBOX_PROVISIONER_TYPE unset: no driver constructed, the ensure
  // steps short-circuit, an operator-managed runner polls the queues).
  // Selection is loud-fail inside newSandboxProvisioner; the routing
  // coherence check lives HERE because both temporal configs do — a
  // provisioner that no routing mode can ever dispatch to is dark
  // configuration, the validateR2Config class of boot fault.
  const sandboxProvisioner = newSandboxProvisioner(
    config.sandboxProvisionerType,
    {
      config: {
        backendEndpoint: config.sandboxBackendEndpoint,
        temporalAddress: config.sandboxTemporalAddress,
        runnerImage: config.sandboxRunnerImage,
        runnerCommand: config.sandboxRunnerCommand,
        kubernetesNamespace: config.sandboxKubernetesNamespace,
      },
      logger,
    },
    builtInSandboxProvisionerFactories(),
    extensions.drivers.sandboxProvisionerDrivers,
  );
  if (
    sandboxProvisioner !== undefined &&
    temporalConfig.activityRouting !== ROUTING_SESSION &&
    workflowExecutionTemporalConfig.workflowActivityRouting !==
      WORKFLOW_ROUTING_EXECUTION
  ) {
    throw new Error(
      `SANDBOX_PROVISIONER_TYPE='${config.sandboxProvisionerType}' requires a per-queue routing mode — set STIGMER_ACTIVITY_ROUTING=session and/or STIGMER_WORKFLOW_ACTIVITY_ROUTING=execution (a provisioner no dispatch can reach must fail loudly, not sit dark)`,
    );
  }
  const sandboxLane = newSandboxLane(sandboxProvisioner, runnerCredentials);
  if (sandboxLane.enabled) {
    logger.info("sandbox provisioner composed", {
      type: config.sandboxProvisionerType,
    });
  }
  // ONE terminal observer instance feeds all three workflow-execution
  // status write sites (the UpdateStatus RPC, the orchestrator's persist
  // activity, the lifecycle persists) — gate ruling Q3b.
  const workflowSandboxTerminalObserver = newWorkflowSandboxTerminalObserver(
    sandboxLane,
    logger,
  );
  const healthState = new HealthState();
  // The model catalog (DD-008, O5): ONE provider instance feeds workflow
  // validation, the pin checks, and the transport's registry lane, so the
  // pickers and validation can never drift (DD-004) — on either arm. With
  // no extension provider composed, the OSS domain-owned ModelRegistryStore
  // (workflow-family DD-A, restoring Go's ownership) is constructed and
  // this root owns its refresh lifecycle; with one composed, the OSS store
  // and its hourly upstream refresh are never built — a substituted
  // composition must not keep fetching registry data nobody reads.
  let modelCatalog: ModelCatalogProvider;
  let ossModelRegistryStore: ModelRegistryStore | undefined;
  if (extensions.drivers.modelCatalogProvider !== undefined) {
    modelCatalog = extensions.drivers.modelCatalogProvider;
  } else {
    ossModelRegistryStore = new ModelRegistryStore({
      bundledDocument: bundledModelRegistryDocument(),
      upstreamOrigin: config.modelRegistryUpstream,
      refreshEnabled: config.modelRegistryRefreshEnabled,
      logger,
      fetchImpl: options.fetchImpl,
    });
    modelCatalog = ossModelRegistryStore;
  }
  const registryLanes = createRegistryLanes({
    taskKindRegistryDocument: bundledTaskKindRegistryDocument(),
    modelRegistryStore: modelCatalog,
  });
  // The Layer-2 workflow validator reads the composed catalog provider
  // per validation call, keeping validation and the served pickers in
  // lockstep (DD-004).
  const workflowValidator = new InProcessValidator(modelCatalog, logger);
  // ONE broker spans both routers AND the Temporal worker's activities:
  // the worker's status persists broadcast through the same fabric, so
  // recovery/fallback updates reach externally-connected subscribe
  // streams (Go's GetStreamBroker seam).
  const agentExecutionStreamBroker = new StreamBroker(logger);
  // The workflowexecution twin (domain-local per that sub-project's
  // DD-002); #21's activities broadcast through it the same way.
  const workflowExecutionStreamBroker = new WorkflowExecutionStreamBroker(
    logger,
  );
  // Stage: schedule clock (#22) — Go server.go 578–592 injection order:
  // config → artifact → syncer → run starter → (worker below) →
  // reconciler. The client provider closes over `temporalManager`,
  // declared just below — legal and deliberate: the manager's factory list
  // must include the schedule worker at construction, while the syncer and
  // reconciler only READ the client at call time, long after boot (a call
  // before initialization would throw loudly, the composition-root idiom).
  const scheduleTemporalConfig = newScheduleConfigFromEnv();
  const scheduleClientProvider = (): TemporalClient | undefined =>
    temporalManager.getClient();
  const scheduleArtifact = new ScheduleArtifact(scheduleTemporalConfig);
  const scheduleSyncer = new ScheduleSyncer(
    scheduleClientProvider,
    store,
    scheduleArtifact,
    logger,
  );
  // Every fire enters the FULL execution create pipeline through the
  // in-process agentexecution client (Go server.go 581: the RunStarter's
  // ExecutionCreator edge). The composed scheduleFireCaller driver
  // (stigmer-cloud#572), when present, gives each fire its edition
  // identity — propagated by the creator's asCaller lane.
  const scheduleRunStarter = new RunStarter({
    store,
    config: scheduleTemporalConfig,
    executions: {
      create: (execution, fireCaller) =>
        requireInProcess().scheduleExecutionCreator.create(
          execution,
          fireCaller,
        ),
    },
    fireCallerMint: extensions.drivers.scheduleFireCaller,
    logger,
  });
  const scheduleReconciler = new ScheduleReconciler(
    scheduleClientProvider,
    store,
    scheduleSyncer,
    scheduleTemporalConfig,
    logger,
  );
  // The manager owns the connection lifecycle; one factory per domain
  // worker (Go createWorkers' list) — agent-execution (#18),
  // workflow-execution (#21), and the schedule clock (#22).
  const temporalManager = new TemporalManager({
    hostPort: config.temporalHostPort,
    namespace: config.temporalNamespace,
    logger,
    // The composed provider's optional resolvePayloadKey capability rides
    // the decode codec (C4 Stage 2): database-resident rpk_ keys for
    // desktop-runner histories. Absent → env keys only, today's behavior.
    payloadCodecs: loadServerPayloadCodecs(
      runnerCredentials.resolvePayloadKey?.bind(runnerCredentials),
    ),
    workerFactories: [
      newAgentExecutionWorkerFactory({
        store,
        logger,
        broker: agentExecutionStreamBroker,
        authorizer,
        // O4: the worker's status-merge activity reuses updateStatus, so
        // the workflow's terminal writes notify the same composed hooks.
        statusObservers: extensions.statusObservers,
        responseDecorators: extensions.responseDecorators,
        temporalConfig,
      }),
      newWorkflowExecutionWorkerFactory({
        store,
        logger,
        broker: workflowExecutionStreamBroker,
        temporalConfig: workflowExecutionTemporalConfig,
        sandboxTerminalObserver: workflowSandboxTerminalObserver,
      }),
      newScheduleWorkerFactory({
        store,
        config: scheduleTemporalConfig,
        syncer: scheduleSyncer,
        runStarter: scheduleRunStarter,
        logger,
      }),
      // Extension workers append after the OSS set — their own queues,
      // the Java worker-per-queue split as precedent (blueprint §8).
      ...extensions.workers,
    ],
  });
  // The provider IS the injection mechanism (no Go-style creator
  // re-injection): controllers observe the manager's CURRENT client at
  // request time, so reconnects propagate with zero re-wiring.
  const executionEngineState = newExecutionEngineStateProvider({
    manager: temporalManager,
    config: temporalConfig,
    store,
    logger,
  });
  // The workflow-execution twin: the same provider-is-the-injection
  // mechanism, filling the seam #20 left disconnected.
  const workflowExecutionEngineState = newWorkflowExecutionEngineStateProvider({
    manager: temporalManager,
    config: workflowExecutionTemporalConfig,
    logger,
  });
  // The artifact blob store (Go server.go 349: shared by agentexecution
  // attachments, the artifact domain (#13), and skill push (#8)). The r2
  // arm landed with #13; the health probe runs in start(), matching Go's
  // boot check. Since O5 the factory consults the composition's registered
  // drivers for non-built-in types (§6b).
  const artifactStorage = newArtifactStorage(
    {
      type: config.artifactStorageType,
      localBasePath: config.artifactLocalBasePath,
      localServeUrl: config.artifactLocalServeUrl,
      r2Bucket: config.r2Bucket,
      r2Endpoint: config.r2Endpoint,
      r2AccessKeyId: config.r2AccessKeyId,
      r2SecretAccessKey: config.r2SecretAccessKey,
      r2Region: config.r2Region,
    },
    extensions.drivers.artifactStorageDrivers,
  );
  // The artifact download lane: a SECOND loopback listener on
  // ARTIFACT_HTTP_PORT, local storage only (Go server.go 849–870) —
  // deliberately not a unified-port lane. Lifecycle rides start()/
  // shutdown().
  const artifactFileServer =
    config.artifactStorageType === "local"
      ? createArtifactFileServer({
          basePath: config.artifactLocalBasePath,
          logger,
        })
      : undefined;
  // The skill artifact store + transfer lane (Go server.go:318-340). The
  // store is content-addressed and never-GC at {storagePath}/skills/;
  // the slots registry wipes {storagePath}/skills-staging at boot (orphans
  // from a dead process are useless — the registry died with it). On OSS
  // the lane is ALWAYS configured (Go wires it unconditionally too): the
  // FailedPrecondition lane-absent arms exist for construction-order
  // safety, and the capability matrix pins skillArtifactTransferLane=true.
  //
  // Since O5 the store is the skill-domain port over a PER-DOMAIN blob
  // driver (§6b, Q2/Q2b rulings): skill keeps its own root and its own
  // backend knob (SKILL_ARTIFACT_STORAGE_TYPE), so an r2-configured
  // deployment changes nothing for skill artifacts until it opts in
  // explicitly, and the Go-written skills/ directory keeps serving in
  // place on the default arm.
  const skillUploadSlots = new UploadSlots(
    path.join(config.storagePath, "skills-staging"),
    DEFAULT_SLOT_TTL_MS,
    MAX_ZIP_SIZE,
  );
  const skillStorageDriver = ((): ArtifactStorage => {
    const skillType =
      config.skillArtifactStorageType === ""
        ? "local"
        : config.skillArtifactStorageType;
    if (skillType === "local") {
      // Go layout invariant: {storagePath}/skills exists from boot with
      // 0755 (the retired LocalFileStorage constructor's mkdir; the
      // generic driver only creates directories on demand).
      mkdirSync(path.join(config.storagePath, "skills"), {
        recursive: true,
        mode: 0o755,
      });
      // The local presigned-PUT arm rides the skill transfer lane's slot
      // mechanism (§6b Q1 ruling: one upload surface, no new lane). The
      // slots stage inside THIS driver's root, so a minted stagingKey
      // reads back through the same instance; the empty serve URL is the
      // honest state — skill downloads ride the transfer lane, never
      // getSignedUrl.
      return new LocalArtifactStorage(config.storagePath, "", {
        mint: (declaredSizeBytes) => skillUploadSlots.mint(declaredSizeBytes),
        uploadUrl: (ref) => skillUploadUrl(config.skillTransferBaseUrl, ref),
        stagedKey: (ref) =>
          `skills-staging/${skillUploadSlots.stagedFileName(ref)}`,
      });
    }
    // Non-local skill backends share the artifact store's R2 settings for
    // the built-in arm and the composition's registered drivers beyond it.
    return newArtifactStorage(
      {
        type: skillType,
        localBasePath: config.storagePath,
        localServeUrl: "",
        r2Bucket: config.r2Bucket,
        r2Endpoint: config.r2Endpoint,
        r2AccessKeyId: config.r2AccessKeyId,
        r2SecretAccessKey: config.r2SecretAccessKey,
        r2Region: config.r2Region,
      },
      extensions.drivers.artifactStorageDrivers,
    );
  })();
  const skillArtifactStorage = newSkillArtifactStorage(skillStorageDriver);
  const skillTransferLane = newSkillTransferLane(
    skillUploadSlots,
    skillArtifactStorage,
    logger,
  );
  // The console lane (lane 4, DD-012): present only when a static export
  // is bundled (slim artifacts) or configured (STIGMER_CONSOLE_DIR) —
  // "not bundled" is a modeled state, logged once, with the router
  // behaving exactly as it did before the lane existed.
  const consoleAssets = resolveConsoleAssets(config.consoleDir, logger);
  if (consoleAssets !== undefined) {
    logger.info("web console serving from unified port", {
      dir: consoleAssets.root,
      files: consoleAssets.fileCount,
    });
  } else {
    logger.debug("no web console export bundled; console lane disabled");
  }
  const consoleLane =
    consoleAssets !== undefined
      ? createConsoleLane({
          assets: consoleAssets,
          grpcPort: options.portOverride ?? config.grpcPort,
          logger,
        })
      : undefined;
  // The search read side (#14): the 13-kind extractor registry, the query
  // store over the driver's index read (OD-3 — no DB() escape hatch), and
  // the CQRS handler. Registry validation is warn-only, Go server.go:509's
  // posture — run ONCE here rather than inside routes(), which executes
  // twice (serving router + in-process router).
  const searchRegistry = newSearchableResourceRegistry();
  searchRegistry.validateExpectedKinds(logger);
  const searchQueryStore = new SqliteSearchQueryStore(
    store,
    searchRegistry,
    logger,
  );
  const searchHandler = new SearchHandler(
    searchQueryStore,
    logger,
    extensions.drivers.listReadScope,
  );
  // The activity recents feed (#14) — pure reads over listResources.
  const activityHandler = new ActivityHandler(
    store,
    logger,
    extensions.drivers.listReadScope,
  );
  // The environment runtime-resolution service (#5) — the decrypt-for-
  // execution path the EC builder uses to resolve environment_refs (the
  // RPC surface redacts secret values, oss#405).
  const environmentResolution = new RuntimeResolutionService(
    store,
    secretService,
    logger,
  );
  // The managed-environment lifecycle — OAuth token access for the EC
  // builder's injection (server.go 732–735) plus the create/delete halves
  // the connect/OAuth slice mints and tears environments with (#19).
  // Rides the environment in-process client so encryption, validation,
  // and audit ride the environment pipeline. ONE instance shared by
  // agentexecution and mcpserver — Go builds two, both stateless over the
  // same client, so sharing is behavior-identical.
  const managedEnvService = new ManagedEnvironmentService(
    {
      getSecretValue: (input) =>
        requireInProcess().executionEnvironmentReader.getSecretValue(input),
      updateVariables: (request) =>
        requireInProcess().executionEnvironmentReader.updateVariables(request),
      create: (environment, caller) =>
        requireInProcess().executionEnvironmentReader.create(
          environment,
          caller,
        ),
      delete: (input) =>
        requireInProcess().executionEnvironmentReader.delete(input),
    },
    logger,
  );
  // The mcpserver connect-engine provider — the same manager-backed
  // request-time idiom as executionEngineState above; the connect lanes
  // start the RUNNER's workflow, so no worker factory is added here.
  const mcpServerEngineState = newMcpServerEngineStateProvider({
    manager: temporalManager,
    config: temporalConfig,
    logger,
  });
  // WARN-degrade, not boot-fatal (Go server.go:722-729): every OAuth RPC
  // except initiateOAuthConnect works without the redirect URI, and
  // initiate refuses with the pinned FailedPrecondition copy.
  if (config.oauthRedirectUri === "") {
    logger.warn(
      "STIGMER_OAUTH_REDIRECT_URI is not set — OAuth Connect flows for MCP servers are unavailable (initiateOAuthConnect will refuse)",
    );
  }
  // The SAME `routes` function registers every service on BOTH the serving
  // router and the in-process router transport (createInProcessClients).
  // Handlers are stateless over the same store, so the two routers behave
  // as one server — Go's single-server bufconn shape. Chain traversal on
  // internal calls is the point (DD-002): an in-process apply/get is
  // validated, logged, and kind-tagged exactly like an external one — the
  // one deliberate difference is position 1 (O2): internal calls carry the
  // internal caller class, wire calls the verifier chassis's identity.
  //
  // requireInProcess breaks the routes↔clients definition cycle: the lazy
  // domain providers are only invoked at request time, after boot
  // completes, so the throw is the composition-root loudness idiom — never
  // expected to fire.
  let inProcess: InProcessClients | undefined;
  function requireInProcess(): InProcessClients {
    if (inProcess === undefined) {
      throw new Error("in-process clients not wired (boot ordering bug)");
    }
    return inProcess;
  }
  const routes = (router: ConnectRouter): void => {
    registerHealthService(router, healthState);
    // The O4 extension points ride the same explicit-deps pattern the
    // authorizer established: the three slot-hosting domains receive the
    // merged gateSteps; agentexecution additionally receives the
    // status-transition hooks (both empty in the no-extension composition).
    registerOrganizationServices(router, {
      store,
      logger,
      authorizer,
      gateSteps: extensions.gateSteps,
      authorizationLifecycle,
      organizationDirectory: extensions.drivers.organizationDirectory,
    });
    // ApiKey is the first domain born AFTER the Go port (O3, 20260827.06 —
    // DD-003: the apikey contract is wholly OSS), so it has no Go
    // registration order to mirror; it registers with the tenancy/IAM
    // family at the top. The chassis's apikey VERIFIER shares this
    // domain's lookup module — not the RPC (domain/apikey/lookup.ts).
    registerApiKeyServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      listReadScope: extensions.drivers.listReadScope,
    });
    registerEnvironmentServices(router, {
      store,
      logger,
      authorizer,
      secretService,
      authorizationLifecycle,
      listReadScope: extensions.drivers.listReadScope,
    });
    // OAuthApp reuses the environment's SecretService instance — Go wires
    // ONE encryption service for both (server.go 302–307).
    registerOAuthAppServices(router, {
      store,
      secretService,
      logger,
      authorizer,
      authorizationLifecycle,
    });
    registerExecutionContextServices(router, {
      store,
      logger,
      authorizer,
      secretService,
      runnerAuthService: runnerCredentials,
      authorizationLifecycle,
    });
    registerAgentServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      agentInstanceApplier: () => requireInProcess().agentInstanceApplier,
    });
    registerAgentInstanceServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      parentAgentLoader: () => requireInProcess().parentAgentLoader,
      listReadScope: extensions.drivers.listReadScope,
    });
    registerSessionServices(router, {
      store,
      logger,
      authorizer,
      temporalConfig,
      agentInstanceCreator: () => requireInProcess().agentInstanceCreator,
      gateSteps: extensions.gateSteps,
      sandboxLane,
      authorizationLifecycle,
      listReadScope: extensions.drivers.listReadScope,
    });
    // The sharing/channel family registers after the agent family, as in
    // Go server.go (agent 378 → agentshare 384 → agentchannel 391 →
    // channelmessage 399 → channelconversation 408 → channelapp 416).
    // ChannelApp shares the ONE SecretService instance with Environment —
    // one key, one enc:v1: format (Go wires the same pointer).
    registerAgentShareServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      listReadScope: extensions.drivers.listReadScope,
    });
    registerAgentChannelServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      listReadScope: extensions.drivers.listReadScope,
      // The SAME domain-owned registry instance the workflow validator
      // and the registry lanes read — the channel model-pin rule
      // (stigmer/stigmer#774) can never drift from the served pickers.
      modelRegistry: modelCatalog,
      // DD-004's serving seam (C3): undefined = the byte-pinned refusal
      // posture; a composed runtime serves install + write/delete hooks.
      channelRuntime: extensions.drivers.channelRuntime,
    });
    registerChannelMessageServices(router, extensions.drivers.channelRuntime);
    registerChannelConversationServices(
      router,
      extensions.drivers.channelRuntime,
    );
    registerChannelAppServices(router, {
      store,
      logger,
      authorizer,
      secretService,
      authorizationLifecycle,
    });
    // Schedule registers between channelapp and memory (Go server.go
    // 417 → 426 → 436). The clock and runner ride constant providers —
    // production wiring always has both (Go SetClock/SetRunner beside the
    // manager); the provider SHAPE exists for embedded/test assemblies
    // that skip Temporal wiring, where undefined degrades per DD-015 D-A.
    registerScheduleServices(router, {
      store,
      logger,
      authorizer,
      modelRegistry: modelCatalog,
      clock: () => scheduleSyncer,
      runner: () => scheduleRunStarter,
      authorizationLifecycle,
      listReadScope: extensions.drivers.listReadScope,
    });
    registerMemoryServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      listReadScope: extensions.drivers.listReadScope,
      runnerCredentialProvider: runnerCredentials,
    });
    registerAgentExecutionServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      listReadScope: extensions.drivers.listReadScope,
      runnerCredentialProvider: runnerCredentials,
      broker: agentExecutionStreamBroker,
      engineState: executionEngineState,
      modelRegistry: modelCatalog,
      artifactStorage,
      gateSteps: extensions.gateSteps,
      statusObservers: extensions.statusObservers,
      responseDecorators: extensions.responseDecorators,
      sandboxLane,
      temporalConfig,
      agentLoader: () => requireInProcess().executionAgentLoader,
      agentInstanceCreator: () =>
        requireInProcess().executionAgentInstanceCreator,
      sessionCreator: () => requireInProcess().executionSessionCreator,
      executionContextBuilder: {
        store,
        logger,
        agentLoader: () => requireInProcess().executionAgentLoader,
        agentInstanceLoader: () =>
          requireInProcess().executionAgentInstanceLoader,
        sessionLoader: () => requireInProcess().executionSessionLoader,
        environmentReader: () => requireInProcess().executionEnvironmentReader,
        environmentResolution,
        executionContextCreator: () =>
          requireInProcess().executionContextCreator,
        managedEnvService,
      },
    });
    registerWorkflowServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      validator: workflowValidator,
      workflowInstanceCreator: () => requireInProcess().workflowInstanceCreator,
    });
    registerWorkflowInstanceServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      parentWorkflowLoader: () => requireInProcess().parentWorkflowLoader,
      listReadScope: extensions.drivers.listReadScope,
    });
    registerWorkflowExecutionServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      listReadScope: extensions.drivers.listReadScope,
      gateSteps: extensions.gateSteps,
      engineState: workflowExecutionEngineState,
      broker: workflowExecutionStreamBroker,
      sandboxLane,
      temporalConfig: workflowExecutionTemporalConfig,
      sandboxTerminalObserver: workflowSandboxTerminalObserver,
      workflowInstanceCreator: () =>
        requireInProcess().workflowExecutionInstanceCreator,
      approvalForwarder: () =>
        requireInProcess().workflowExecutionApprovalForwarder,
      fileDecisionForwarder: () =>
        requireInProcess().workflowExecutionFileDecisionForwarder,
      executionContextBuilder: {
        store,
        logger,
        workflowInstanceLoader: () =>
          requireInProcess().workflowExecutionInstanceLoader,
        environmentResolution,
        executionContextCreator: () =>
          requireInProcess().workflowExecutionContextCreator,
      },
    });
    // The whole surface: the CRUD slice (D4 #9) plus the connect/OAuth
    // slice (D4 #19). All connect deps are wired unconditionally per the
    // composition-root idiom — engine availability is the modeled state
    // the provider answers at request time, and the managed-env service
    // has no Temporal dependency (DB-1, sub-project 20260825.02).
    registerMcpServerServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      connect: {
        store,
        logger,
        authorizer,
        engineState: mcpServerEngineState,
        environmentReader: {
          list: (request) =>
            requireInProcess().executionEnvironmentReader.list(request),
          getSecretValue: (input) =>
            requireInProcess().executionEnvironmentReader.getSecretValue(input),
        },
        executionContext: {
          create: (ec) =>
            requireInProcess().connectExecutionContextClient.create(ec),
          delete: (input) =>
            requireInProcess().connectExecutionContextClient.delete(input),
        },
        runnerAuth: runnerCredentials,
        managedEnv: managedEnvService,
        // The SAME grant-store instance agentexecution's session-time
        // token injection reads (Go server.go:732-735 shares it too).
        oauthGrants: store.oauthGrants,
        pendingOAuthStates: store.pendingOAuthStates,
        secretService,
        oauthRedirectUri: config.oauthRedirectUri,
      },
    });
    registerSkillServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      artifactStorage: skillArtifactStorage,
      // The agentexecution blob store (server.go:362-363) — read side of
      // pushFromExecutionArtifact.
      executionArtifactStorage: artifactStorage,
      transferLane: {
        slots: skillUploadSlots,
        baseUrl: config.skillTransferBaseUrl,
      },
    });
    // Artifact CRUD shares the ONE blob store with agentexecution's
    // attachment lanes (Go server.go 347–374).
    registerArtifactServices(router, {
      store,
      artifactStorage,
      logger,
      authorizer,
    });
    // Project registers after all four reconciled kinds (agent, workflow,
    // mcpserver, skill) — the last Class A domain. The lazy deleter
    // provider replaces Go's SetReconciliationService late-bind
    // (server.go 478 registration + 635–648 injection): orphan deletes
    // route through the in-process command clients' FULL pipelines.
    registerProjectServices(router, {
      store,
      logger,
      authorizer,
      authorizationLifecycle,
      orphanDeleter: () => requireInProcess().projectOrphanDeleter,
    });
    // The two CQRS query services register between the domains and the
    // github/platform tail, mirroring Go's registration order
    // (server.go: project 478 → organization 487 → search 493 →
    // activity 513 → github 524 → platform 530).
    registerSearchServices(router, { handler: searchHandler, logger });
    registerActivityServices(router, { handler: activityHandler, logger });
    // GitHub broker: config-only, no store (Go server.go 524–528).
    registerGitHubServices(router, {
      clientId: config.gitHubOAuthClientId,
      clientSecret: config.gitHubOAuthClientSecret,
      logger,
      fetchImpl: options.fetchImpl,
    });
    // Platform registers LAST of all controllers (Go server.go 530–535).
    registerPlatformServices(router, {
      temporalHostPort: config.temporalHostPort,
      temporalNamespace: config.temporalNamespace,
      runnerAuthService: runnerCredentials,
      edition: extensions.edition,
      logger,
    });
    // Extension services register after the whole OSS set, inside the ONE
    // routes closure — so the serving router AND the in-process transport
    // see them by construction (blueprint §2a; DD-002's parity doctrine
    // extends to extension services unchanged).
    for (const registerExtensionServices of extensions.services) {
      registerExtensionServices(router);
    }
  };
  const inProcessWiring = createInProcessClients(routes, logger);
  inProcess = inProcessWiring.clients;

  // The auth-enabled modeled state (O3 rulings Q1+Q2): a configured OIDC
  // issuer registers the two OSS verifiers — API tokens first (cheap
  // prefix claim, the Java ProviderManager's order), then OIDC — ahead of
  // the extension entries ("OSS entries first", the registry contract),
  // and turns on the require-authentication posture. No issuer = zero OSS
  // verifiers = the trusted-local posture, byte-identical wire behavior.
  // The runner's credential in this posture is an operator-minted API
  // token via STIGMER_TOKEN (ruling Q3) — no runner-specific verifier.
  const authEnabled = config.oidcIssuer !== "";
  const identityVerifiers = authEnabled
    ? [
        newApiKeyIdentityVerifier(store),
        newOidcIdentityVerifier({
          issuer: config.oidcIssuer,
          audience: config.oidcAudience,
        }),
        ...extensions.identityVerifiers,
      ]
    : extensions.identityVerifiers;

  const server = createUnifiedPortServer({
    logger,
    routes,
    // The serving chain's position-1 identity source is the verifier
    // chassis over the composed verifiers (O2; zero verifiers = the
    // trusted-local posture, byte-identical wire behavior) followed by
    // the composed caller guards (20260902.02; zero guards = today's
    // behavior). The in-process transport above carries its own
    // position-1 source — the internal caller class only it can mint
    // (ruling Q4), and NO guards: the in-process exemption is structural
    // (caller-guards.ts). Position 0 is the error boundary (20260830.03):
    // the raw-error conversion net plus the composed visitor sanitizer —
    // SERVING chain only, so in-process hops keep full diagnostics by
    // construction.
    interceptors: buildInterceptorChain(
      logger,
      createVerifierChainInterceptor(
        identityVerifiers,
        extensions.callerGuards,
        logger,
        authEnabled,
      ),
      createErrorBoundaryInterceptor(
        logger,
        extensions.drivers.visitorErrorPolicy,
      ),
    ),
    taskKindRegistryLane: registryLanes.taskKindRegistryLane,
    modelRegistryLane: registryLanes.modelRegistryLane,
    skillTransferLane,
    consoleLane,
  });

  return {
    healthState,
    store,
    secrets: secretService,
    temporalManager,
    runnerAuthService,
    agentExecutionStreamBroker,
    workflowExecutionStreamBroker,
    inProcessTransport: inProcessWiring.transport,

    async start(): Promise<number> {
      // Temporal boot is NON-fatal end to end (Go server.go): a failed
      // initial connect leaves the engine unavailable and the monitor
      // retrying; a failed worker start is a warning. Health below flips
      // SERVING regardless — engine availability is modeled in the
      // agentexecution domain, never in gRPC health.
      const connected = await temporalManager.initialConnect();
      if (connected) {
        await temporalManager.startWorkers();
      }
      temporalManager.startHealthMonitor();
      // Schedule reconciliation: an immediate boot pass (the dev server may
      // have restarted with empty state while the daemon was down), the
      // periodic loop, and the reconnect kick — Go server.go 763–764.
      const kickScheduleReconcile = scheduleReconciler.startReconciliation();
      temporalManager.addReconnectHook(kickScheduleReconcile);
      // Artifact storage must be reachable and writable before the server
      // answers (Go server.go boots-fatal on the same probe).
      await artifactStorage.health();
      // Rebuild the search index before the port binds (Go
      // server.go:617): the index is separate from the resources table,
      // and rebuilding here makes every resource — including seedpack
      // rows bootstrapped into an earlier database — discoverable the
      // moment the server accepts connections. Warn-only: a partial
      // rebuild degrades search, never boot.
      try {
        const indexed = await searchQueryStore.rebuildIndex();
        logger.info("Search index rebuilt at startup", { indexed });
      } catch (error) {
        logger.warn("Failed to rebuild search index at startup", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      // Wiring complete → SERVING → background refresh → bind. The port
      // must be the LAST observable effect (serverGate contract).
      healthState.setOverall(ServingStatus.SERVING);
      // Undefined when an extension provider substituted the catalog —
      // that implementation owns its own freshness.
      ossModelRegistryStore?.startRefresh();
      const port = await server.listen(
        options.portOverride ?? config.grpcPort,
        options.host,
      );
      logger.info("stigmer-server listening", { port });
      // The artifact file server binds AFTER the main server, exactly Go's
      // boot order; a bind failure is logged but NOT fatal (Go's
      // ListenAndServe goroutine logs and dies while the server runs on).
      if (artifactFileServer !== undefined) {
        await warnOnLegacyArtifactLayout(config.artifactLocalBasePath, logger);
        try {
          await artifactFileServer.listen(
            config.artifactHttpPort,
            config.artifactHttpHost,
          );
        } catch (error) {
          logger.error("Artifact HTTP file server failed", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      return port;
    },

    async shutdown(): Promise<void> {
      healthState.setOverall(ServingStatus.NOT_SERVING);
      ossModelRegistryStore?.stopRefresh();
      await artifactFileServer?.shutdown();
      // The reconciler stops before the manager: a pass mid-flight may
      // still call through the manager's client, and nothing may fire
      // after shutdown (the #18 close-race lesson).
      await scheduleReconciler.stop();
      // Workers stop before the transport drains: an in-flight activity
      // may still write through the store, which closes LAST.
      await temporalManager.close();
      await server.shutdown();
      // The store closes LAST: in-flight handlers drained above may still
      // be mid-write (Go closes the store after grpcServer.Stop too).
      await store.close();
      logger.info("stigmer-server stopped");
    },
  };
}
