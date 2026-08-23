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
import type { ConnectRouter } from "@connectrpc/connect";

import { HealthCheckResponse_ServingStatus as ServingStatus } from "@stigmer/protos/grpc/health/v1/health_pb";

import { registerAgentServices } from "../domain/agent/controller.js";
import { newConfigFromEnv } from "../domain/agentexecution/temporal/config.js";
import { registerAgentInstanceServices } from "../domain/agentinstance/controller.js";
import { registerEnvironmentServices } from "../domain/environment/controller.js";
import { registerMemoryServices } from "../domain/memory/controller.js";
import { registerOrganizationServices } from "../domain/organization/controller.js";
import { registerSessionServices } from "../domain/session/controller.js";
import { SecretService } from "../encryption/encryption.js";
import { buildInterceptorChain } from "../pipeline/chain.js";
import { RunnerAuthService } from "../runnerauth/runnerauth.js";
import { SqliteStore } from "../store/sqlite/store.js";
import type { Store } from "../store/interface.js";
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
   * The runner-token service (exposed for its future consumers' wiring —
   * the platform exchange RPC and the executioncontext decrypt lane land
   * with their own sub-projects — and for boot tests).
   */
  runnerAuthService: RunnerAuthService;
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
  //     (Its consumers — the platform exchange RPC, the EC decrypt lane —
  //     arrive with their sub-projects; the boot posture is wired now so
  //     their wiring PRs never restructure boot.)
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
  const registryLanes = createRegistryLanes({
    modelRegistryUpstream: config.modelRegistryUpstream,
    modelRegistryRefreshEnabled: config.modelRegistryRefreshEnabled,
    logger,
    fetchImpl: options.fetchImpl,
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
  };
  inProcess = createInProcessClients(routes, logger);

  const server = createUnifiedPortServer({
    logger,
    routes,
    interceptors: buildInterceptorChain(logger),
    taskKindRegistryLane: registryLanes.taskKindRegistryLane,
    modelRegistryLane: registryLanes.modelRegistryLane,
  });

  return {
    healthState,
    store,
    runnerAuthService,

    async start(): Promise<number> {
      // Wiring complete → SERVING → background refresh → bind. The port
      // must be the LAST observable effect (serverGate contract).
      healthState.setOverall(ServingStatus.SERVING);
      registryLanes.start();
      const port = await server.listen(
        options.portOverride ?? config.grpcPort,
        options.host,
      );
      logger.info("stigmer-server-ts listening", { port });
      return port;
    },

    async shutdown(): Promise<void> {
      healthState.setOverall(ServingStatus.NOT_SERVING);
      registryLanes.stop();
      await server.shutdown();
      // The store closes LAST: in-flight handlers drained above may still
      // be mid-write (Go closes the store after grpcServer.Stop too).
      await store.close();
      logger.info("stigmer-server-ts stopped");
    },
  };
}
