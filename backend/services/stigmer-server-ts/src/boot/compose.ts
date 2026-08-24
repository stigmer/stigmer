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
import { ENGINE_DISCONNECTED } from "../domain/agentexecution/engine.js";
import { StreamBroker } from "../domain/agentexecution/stream-broker.js";
import { RuntimeResolutionService } from "../domain/environment/resolution/resolution.js";
import { ManagedEnvironmentService } from "../domain/mcpserver/oauth/managed-env.js";
import { registerAgentInstanceServices } from "../domain/agentinstance/controller.js";
import { registerEnvironmentServices } from "../domain/environment/controller.js";
import { registerExecutionContextServices } from "../domain/executioncontext/controller.js";
import { registerMemoryServices } from "../domain/memory/controller.js";
import { registerOrganizationServices } from "../domain/organization/controller.js";
import { registerMcpServerServices } from "../domain/mcpserver/controller.js";
import { registerSessionServices } from "../domain/session/controller.js";
import { registerSkillServices } from "../domain/skill/controller.js";
import { DEFAULT_SLOT_TTL_MS, MAX_ZIP_SIZE } from "../domain/skill/constants.js";
import { LocalFileStorage as SkillLocalFileStorage } from "../domain/skill/storage/artifact-storage.js";
import { newSkillTransferLane } from "../domain/skill/transfer/handler.js";
import { UploadSlots } from "../domain/skill/transfer/slots.js";
import { SecretService } from "../encryption/encryption.js";
import { buildInterceptorChain } from "../pipeline/chain.js";
import { RunnerAuthService } from "../runnerauth/runnerauth.js";
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
import { ENGINE_DISCONNECTED as WORKFLOW_EXECUTION_ENGINE_DISCONNECTED } from "../domain/workflowexecution/engine.js";
import { StreamBroker as WorkflowExecutionStreamBroker } from "../domain/workflowexecution/stream-broker.js";
import { HealthState, registerHealthService } from "../transport/health.js";
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
   * The workflowexecution broadcast fabric (exposed for tests and, with
   * #21, its Temporal worker's broadcasts — Go's GetStreamBroker).
   * UpdateStatus and the lifecycle RPCs are the production writers.
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

export function composeServer(options: ComposeOptions): ComposedServer {
  const { config, logger } = options;

  // Stage: storage. Opening the store runs migrations (v1–v7, incl.
  // adopting a Go-created database — D2 §3 schema continuity); a failure
  // here is a loud boot throw, never a degraded server. The operator
  // identity (#400) is installed by main.ts — once per PROCESS, before any
  // writer exists — not here: composeServer is re-entrant for tests, the
  // identity seam deliberately is not.
  const store: Store = SqliteStore.open(config.dbPath, logger);

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

  // Stage: temporal — seam (execution cluster sub-projects).

  // Stage: controllers + routes.
  // The agent-execution temporal config is env-derived strings only — the
  // temporal seam stays empty. It lives here (not with the seam) because
  // the session update pipeline's execution-target immutability step must
  // resolve UNSPECIFIED through the SAME default dispatch will use — one
  // definition, so policy and dispatch can never disagree (oss#397).
  const temporalConfig = newConfigFromEnv();
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
  // ONE broker spans both routers: #18's Temporal activities update
  // status through the in-process client, and those broadcasts must reach
  // externally-connected subscribe streams (Go's GetStreamBroker seam).
  const agentExecutionStreamBroker = new StreamBroker(logger);
  // The workflowexecution twin (domain-local per that sub-project's
  // DD-002); #21's activities broadcast through it the same way.
  const workflowExecutionStreamBroker = new WorkflowExecutionStreamBroker(
    logger,
  );
  // The artifact blob store (Go server.go 349: shared by agentexecution
  // attachments now, the artifact domain + skill push later). Construction
  // boot-fails on ARTIFACT_STORAGE_TYPE=r2 (the ratified #13 deferral);
  // the health probe runs in start(), matching Go's boot check.
  const artifactStorage = newArtifactStorage({
    type: config.artifactStorageType,
    localBasePath: config.artifactLocalBasePath,
    localServeUrl: config.artifactLocalServeUrl,
  });
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
  // The environment runtime-resolution service (#5) — the decrypt-for-
  // execution path the EC builder uses to resolve environment_refs (the
  // RPC surface redacts secret values, oss#405).
  const environmentResolution = new RuntimeResolutionService(
    store,
    secretService,
    logger,
  );
  // OAuth-managed token access for the EC builder's injection (server.go
  // 732–735); rides the environment in-process client so encryption,
  // validation, and audit ride the environment pipeline.
  const managedEnvService = new ManagedEnvironmentService({
    getSecretValue: (input) =>
      requireInProcess().executionEnvironmentReader.getSecretValue(input),
    updateVariables: (request) =>
      requireInProcess().executionEnvironmentReader.updateVariables(request),
  });
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
    registerMemoryServices(router, { store, logger });
    registerAgentExecutionServices(router, {
      store,
      logger,
      broker: agentExecutionStreamBroker,
      // Permanently disconnected until #18 lands the worker infra; the
      // provider shape lets its TemporalManager flip availability at
      // runtime without controller changes.
      engineState: () => ENGINE_DISCONNECTED,
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
      // Permanently disconnected until #21 lands the workflow-execution
      // orchestrator on #18's worker infra; same provider shape as the
      // agentexecution seam above.
      engineState: () => WORKFLOW_EXECUTION_ENGINE_DISCONNECTED,
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
    // CRUD slice only (D4 #9) — Go's constructor takes exactly the store
    // for this slice; the connect/OAuth deps arrive with #19.
    registerMcpServerServices(router, { store, logger });
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
  };
  inProcess = createInProcessClients(routes, logger);

  const server = createUnifiedPortServer({
    logger,
    routes,
    interceptors: buildInterceptorChain(logger),
    taskKindRegistryLane: registryLanes.taskKindRegistryLane,
    modelRegistryLane: registryLanes.modelRegistryLane,
    skillTransferLane,
  });

  return {
    healthState,
    store,
    runnerAuthService,
    agentExecutionStreamBroker,
    workflowExecutionStreamBroker,

    async start(): Promise<number> {
      // Artifact storage must be reachable and writable before the server
      // answers (Go server.go boots-fatal on the same probe).
      await artifactStorage.health();
      // Wiring complete → SERVING → background refresh → bind. The port
      // must be the LAST observable effect (serverGate contract).
      healthState.setOverall(ServingStatus.SERVING);
      modelRegistryStore.startRefresh();
      const port = await server.listen(
        options.portOverride ?? config.grpcPort,
        options.host,
      );
      logger.info("stigmer-server-ts listening", { port });
      return port;
    },

    async shutdown(): Promise<void> {
      healthState.setOverall(ServingStatus.NOT_SERVING);
      modelRegistryStore.stopRefresh();
      await server.shutdown();
      // The store closes LAST: in-flight handlers drained above may still
      // be mid-write (Go closes the store after grpcServer.Stop too).
      await store.close();
      logger.info("stigmer-server-ts stopped");
    },
  };
}
