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
 */
import path from "node:path";

import type { ConnectRouter } from "@connectrpc/connect";

import { HealthCheckResponse_ServingStatus as ServingStatus } from "@stigmer/protos/grpc/health/v1/health_pb";

import { registerAgentServices } from "../domain/agent/controller.js";
import { newConfigFromEnv } from "../domain/agentexecution/temporal/config.js";
import { registerAgentExecutionServices } from "../domain/agentexecution/controller.js";
import { newArtifactStorage } from "../artifactstorage/artifact-storage.js";
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
import { registerArtifactServices } from "../domain/artifact/controller.js";
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
import { DEFAULT_SLOT_TTL_MS, MAX_ZIP_SIZE } from "../domain/skill/constants.js";
import { LocalFileStorage as SkillLocalFileStorage } from "../domain/skill/storage/artifact-storage.js";
import { newSkillTransferLane } from "../domain/skill/transfer/handler.js";
import { UploadSlots } from "../domain/skill/transfer/slots.js";
import { SecretService } from "../encryption/encryption.js";
import { registerActivityServices } from "../query/activity/controller.js";
import { ActivityHandler } from "../query/activity/handler.js";
import { registerSearchServices } from "../query/search/controller.js";
import { SearchHandler } from "../query/search/handler.js";
import { SqliteSearchQueryStore } from "../query/search/query-store.js";
import { newSearchableResourceRegistry } from "../query/search/registry.js";
import { buildInterceptorChain } from "../pipeline/chain.js";
import { RunnerAuthService } from "../runnerauth/runnerauth.js";
import { PostgresStore } from "../store/postgres/store.js";
import { SqliteStore } from "../store/sqlite/store.js";
import type { Store } from "../store/interface.js";
import { registerWorkflowServices } from "../domain/workflow/controller.js";
import {
  bundledModelRegistryDocument,
  bundledTaskKindRegistryDocument,
} from "../domain/workflow/registry/bundled.js";
import { ModelRegistryStore } from "../domain/workflow/registry/model-registry-store.js";
import { InProcessValidator } from "../domain/workflow/validation/validator.js";
import { registerWorkflowInstanceServices } from "../domain/workflowinstance/controller.js";
import { registerWorkflowExecutionServices } from "../domain/workflowexecution/controller.js";
import { StreamBroker as WorkflowExecutionStreamBroker } from "../domain/workflowexecution/stream-broker.js";
import { newWorkflowExecutionConfigFromEnv } from "../domain/workflowexecution/temporal/config.js";
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
  /** Completes wiring, flips SERVING, binds the port; returns the bound port. */
  start(): Promise<number>;
  /** NOT_SERVING first, stop background work, drain connections. */
  shutdown(): Promise<void>;
}

export interface ComposeOptions {
  config: ServerConfig;
  logger: Logger;
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
  //     pass-through service. Plaintext at rest is tolerable (the write
  //     steps WARN per request, oss#394); refusing to boot over it is not.
  //   - Runner-token key failure → FATAL (throw). The EC read RPCs redact
  //     by default, so a server that cannot mint runner tokens would hand
  //     every execution redaction markers instead of its secrets — the
  //     exact silent-junk failure the oss#405 fail-loud doctrine forbids.
  //     (The verify side is live: the executioncontext decrypt lane. The
  //     mint side — the platform exchange RPC — arrives with its
  //     sub-project.)
  let secretService: SecretService;
  try {
    secretService = SecretService.fromEnv();
  } catch (error) {
    logger.warn(
      "Failed to initialize encryption - secret values will be stored in plaintext",
      { error: error instanceof Error ? error.message : String(error) },
    );
    secretService = SecretService.create(undefined);
  }
  const runnerAuthService = RunnerAuthService.fromEnv();

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
  const healthState = new HealthState();
  // The model-registry store is DOMAIN-owned (workflow-family DD-A,
  // restoring Go's ownership): workflow validation and the transport's
  // registry lane read this one store, so the pickers and validation can
  // never drift (DD-004). The composition root owns its refresh lifecycle.
  const modelRegistryStore = new ModelRegistryStore({
    bundledDocument: bundledModelRegistryDocument(),
    upstreamOrigin: config.modelRegistryUpstream,
    refreshEnabled: config.modelRegistryRefreshEnabled,
    logger,
    fetchImpl: options.fetchImpl,
  });
  const registryLanes = createRegistryLanes({
    taskKindRegistryDocument: bundledTaskKindRegistryDocument(),
    modelRegistryStore,
  });
  // The Layer-2 workflow validator reads the domain-owned registry store
  // per validation call, keeping validation and the served pickers in
  // lockstep (DD-004).
  const workflowValidator = new InProcessValidator(modelRegistryStore, logger);
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
  // ExecutionCreator edge).
  const scheduleRunStarter = new RunStarter({
    store,
    config: scheduleTemporalConfig,
    executions: {
      create: (execution) =>
        requireInProcess().scheduleExecutionCreator.create(execution),
    },
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
    payloadCodecs: loadServerPayloadCodecs(),
    workerFactories: [
      newAgentExecutionWorkerFactory({
        store,
        logger,
        broker: agentExecutionStreamBroker,
        temporalConfig,
      }),
      newWorkflowExecutionWorkerFactory({
        store,
        logger,
        broker: workflowExecutionStreamBroker,
        temporalConfig: workflowExecutionTemporalConfig,
      }),
      newScheduleWorkerFactory({
        store,
        config: scheduleTemporalConfig,
        syncer: scheduleSyncer,
        runStarter: scheduleRunStarter,
        logger,
      }),
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
  const workflowExecutionEngineState = newWorkflowExecutionEngineStateProvider(
    {
      manager: temporalManager,
      config: workflowExecutionTemporalConfig,
      logger,
    },
  );
  // The artifact blob store (Go server.go 349: shared by agentexecution
  // attachments, the artifact domain (#13), and skill push (#8)). The r2
  // arm landed with #13; the health probe runs in start(), matching Go's
  // boot check.
  const artifactStorage = newArtifactStorage({
    type: config.artifactStorageType,
    localBasePath: config.artifactLocalBasePath,
    localServeUrl: config.artifactLocalServeUrl,
    r2Bucket: config.r2Bucket,
    r2Endpoint: config.r2Endpoint,
    r2AccessKeyId: config.r2AccessKeyId,
    r2SecretAccessKey: config.r2SecretAccessKey,
    r2Region: config.r2Region,
  });
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
  const skillArtifactStorage = new SkillLocalFileStorage(config.storagePath);
  const skillUploadSlots = new UploadSlots(
    path.join(config.storagePath, "skills-staging"),
    DEFAULT_SLOT_TTL_MS,
    MAX_ZIP_SIZE,
  );
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
  const searchHandler = new SearchHandler(searchQueryStore, logger);
  // The activity recents feed (#14) — pure reads over listResources.
  const activityHandler = new ActivityHandler(store, logger);
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
      create: (environment) =>
        requireInProcess().executionEnvironmentReader.create(environment),
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
  // validated, logged, and kind-tagged exactly like an external one.
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
    registerOrganizationServices(router, { store, logger });
    registerEnvironmentServices(router, { store, logger, secretService });
    // OAuthApp reuses the environment's SecretService instance — Go wires
    // ONE encryption service for both (server.go 302–307).
    registerOAuthAppServices(router, { store, secretService, logger });
    registerExecutionContextServices(router, {
      store,
      logger,
      secretService,
      runnerAuthService,
    });
    registerAgentServices(router, {
      store,
      logger,
      agentInstanceApplier: () => requireInProcess().agentInstanceApplier,
    });
    registerAgentInstanceServices(router, {
      store,
      logger,
      parentAgentLoader: () => requireInProcess().parentAgentLoader,
    });
    registerSessionServices(router, {
      store,
      logger,
      temporalConfig,
      agentInstanceCreator: () => requireInProcess().agentInstanceCreator,
    });
    // The sharing/channel family registers after the agent family, as in
    // Go server.go (agent 378 → agentshare 384 → agentchannel 391 →
    // channelmessage 399 → channelconversation 408 → channelapp 416).
    // ChannelApp shares the ONE SecretService instance with Environment —
    // one key, one enc:v1: format (Go wires the same pointer).
    registerAgentShareServices(router, { store, logger });
    registerAgentChannelServices(router, {
      store,
      logger,
      // The SAME domain-owned registry instance the workflow validator
      // and the registry lanes read — the channel model-pin rule
      // (stigmer/stigmer#774) can never drift from the served pickers.
      modelRegistry: modelRegistryStore,
    });
    registerChannelMessageServices(router);
    registerChannelConversationServices(router);
    registerChannelAppServices(router, { store, logger, secretService });
    // Schedule registers between channelapp and memory (Go server.go
    // 417 → 426 → 436). The clock and runner ride constant providers —
    // production wiring always has both (Go SetClock/SetRunner beside the
    // manager); the provider SHAPE exists for embedded/test assemblies
    // that skip Temporal wiring, where undefined degrades per DD-015 D-A.
    registerScheduleServices(router, {
      store,
      logger,
      modelRegistry: modelRegistryStore,
      clock: () => scheduleSyncer,
      runner: () => scheduleRunStarter,
    });
    registerMemoryServices(router, { store, logger });
    registerAgentExecutionServices(router, {
      store,
      logger,
      broker: agentExecutionStreamBroker,
      engineState: executionEngineState,
      modelRegistry: modelRegistryStore,
      artifactStorage,
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
        environmentReader: () =>
          requireInProcess().executionEnvironmentReader,
        environmentResolution,
        executionContextCreator: () =>
          requireInProcess().executionContextCreator,
        managedEnvService,
      },
    });
    registerWorkflowServices(router, {
      store,
      logger,
      validator: workflowValidator,
      workflowInstanceCreator: () => requireInProcess().workflowInstanceCreator,
    });
    registerWorkflowInstanceServices(router, {
      store,
      logger,
      parentWorkflowLoader: () => requireInProcess().parentWorkflowLoader,
    });
    registerWorkflowExecutionServices(router, {
      store,
      logger,
      engineState: workflowExecutionEngineState,
      broker: workflowExecutionStreamBroker,
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
      connect: {
        store,
        logger,
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
        runnerAuth: runnerAuthService,
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
    registerArtifactServices(router, { store, artifactStorage, logger });
    // Project registers after all four reconciled kinds (agent, workflow,
    // mcpserver, skill) — the last Class A domain. The lazy deleter
    // provider replaces Go's SetReconciliationService late-bind
    // (server.go 478 registration + 635–648 injection): orphan deletes
    // route through the in-process command clients' FULL pipelines.
    registerProjectServices(router, {
      store,
      logger,
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
      runnerAuthService,
      logger,
    });
  };
  inProcess = createInProcessClients(routes, logger);

  const server = createUnifiedPortServer({
    logger,
    routes,
    interceptors: buildInterceptorChain(logger),
    taskKindRegistryLane: registryLanes.taskKindRegistryLane,
    modelRegistryLane: registryLanes.modelRegistryLane,
    skillTransferLane,
    consoleLane,
  });

  return {
    healthState,
    store,
    temporalManager,
    runnerAuthService,
    agentExecutionStreamBroker,
    workflowExecutionStreamBroker,

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
      modelRegistryStore.startRefresh();
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
          await artifactFileServer.listen(config.artifactHttpPort);
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
      modelRegistryStore.stopRefresh();
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
