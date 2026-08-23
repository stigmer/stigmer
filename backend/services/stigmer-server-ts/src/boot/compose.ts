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
import { HealthCheckResponse_ServingStatus as ServingStatus } from "@stigmer/protos/grpc/health/v1/health_pb";

import { registerOrganizationServices } from "../domain/organization/controller.js";
import { buildInterceptorChain } from "../pipeline/chain.js";
import { SqliteStore } from "../store/sqlite/store.js";
import type { Store } from "../store/interface.js";
import { HealthState, registerHealthService } from "../transport/health.js";
import { createRegistryLanes } from "../transport/registry/lanes.js";
import { createUnifiedPortServer } from "../transport/server.js";
import type { ServerConfig } from "./config.js";
import type { Logger } from "./logger.js";

export interface ComposedServer {
  healthState: HealthState;
  /** The persistence layer (exposed for tests; domain code gets it injected). */
  store: Store;
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

  // Stage: temporal — seam (execution cluster sub-projects).

  // Stage: controllers + routes.
  const healthState = new HealthState();
  const registryLanes = createRegistryLanes({
    modelRegistryUpstream: config.modelRegistryUpstream,
    modelRegistryRefreshEnabled: config.modelRegistryRefreshEnabled,
    logger,
    fetchImpl: options.fetchImpl,
  });
  const server = createUnifiedPortServer({
    logger,
    routes: (router) => {
      registerHealthService(router, healthState);
      registerOrganizationServices(router, { store, logger });
    },
    interceptors: buildInterceptorChain(logger),
    taskKindRegistryLane: registryLanes.taskKindRegistryLane,
    modelRegistryLane: registryLanes.modelRegistryLane,
  });

  return {
    healthState,
    store,

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
