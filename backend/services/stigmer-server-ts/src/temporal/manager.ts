/**
 * TemporalManager — ports pkg/server/temporal_manager.go: the Temporal
 * connection lifecycle with non-fatal initial connect, a periodic health
 * monitor, automatic reconnection with worker recreation, and reconnect
 * hooks.
 *
 * The ephemeral-dev-server posture is the design driver: in OSS the
 * managed Temporal dev server can restart at any time (often with EMPTY
 * state), so the manager must survive outages, recreate every worker on
 * reconnect (a worker missing from the reconnect path silently dies after
 * the first Temporal blip — Go's createWorkers warning), and let domain
 * code observe the CURRENT client at call time.
 *
 * Two deliberate TS-idiom deviations from Go, both internal (sub-project
 * 20260824.03 plan; neither is wire-visible):
 *
 *   - Go re-injects workflow creators into controllers via duck-typed
 *     SetWorkflowCreator/SetTemporalClient assertions on an untyped
 *     dependency bag. Here the domain's engine implementation reads
 *     getClient() at call time — the engine-state provider #17 wired IS
 *     the injection mechanism, so reconnects propagate with no reinject
 *     step and "forgot to wire it" is a compile error.
 *   - Go passes the client to CompleteExternalActivity through a mutable
 *     package global re-set on every reconnect. Here activities receive a
 *     live client PROVIDER (worker factory deps), which reads the current
 *     client when the activity runs.
 *
 * Parity note on availability semantics (Go behavior, preserved exactly):
 * the engine is "unavailable" only until the FIRST successful connect —
 * Go's nil workflowCreator window. After that, getClient() keeps returning
 * the most recent client even during an outage; operations fail with
 * connection errors exactly as Go's stale-client operations do, and the
 * health monitor swaps in a fresh client when the server returns.
 *
 * One choke point for payload decryption: the codecs are installed on the
 * client at dial AND handed to every worker factory (the TS SDK's
 * Worker.create takes its own dataConverter; Go workers inherit the
 * client's — same coverage, two installation sites, one source array).
 */
import { Client, Connection } from "@temporalio/client";
import type { PayloadCodec } from "@temporalio/common";
import { NativeConnection, type Worker } from "@temporalio/worker";

import type { Logger } from "../boot/logger.js";

/**
 * Initial connect: 3 attempts with exponential backoff (1s, 2s between
 * attempts), then give up NON-fatally — the server boots and serves with
 * the engine unavailable; the health monitor keeps retrying
 * (temporal_manager.go InitialConnect).
 */
const INITIAL_CONNECT_MAX_ATTEMPTS = 3;
const INITIAL_CONNECT_BASE_DELAY_MS = 1_000;

/**
 * Per-dial connect window. Go's client.Dial fails FAST on
 * connection-refused; grpc-js instead keeps re-dialing inside its
 * connectTimeout (default 10s), which would turn the non-fatal 3-attempt
 * boot into a ~33s stall when Temporal is absent (the Class A conformance
 * harness deliberately points at a closed port). A short window restores
 * Go's fail-fast boot; the retry loop and the health monitor supply all
 * the patience a slow-starting Temporal needs.
 */
const DIAL_CONNECT_TIMEOUT_MS = 1_000;

/**
 * Health monitor cadence: 15s ticks with a 5s CheckHealth deadline
 * (temporal_manager.go StartHealthMonitor/testConnection). Fast enough
 * that a dev-server restart is healed within one schedule-reconcile
 * window; slow enough to be free at idle.
 */
const HEALTH_CHECK_INTERVAL_MS = 15_000;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;

/**
 * Reconnect backoff: exponential 1s, 2s, 4s… capped at 30s
 * (temporal_manager.go calculateBackoff) — the cap keeps recovery latency
 * bounded when the dev server has been down a while.
 */
const RECONNECT_BACKOFF_CAP_MS = 30_000;

/** The gRPC health service name Go's client.CheckHealth probes. */
const TEMPORAL_HEALTH_SERVICE =
  "temporal.api.workflowservice.v1.WorkflowService";

export interface WorkerFactoryDeps {
  readonly nativeConnection: NativeConnection;
  readonly namespace: string;
  /**
   * The decode-only codec chain — Worker.create must receive it as its
   * dataConverter so workflow tasks can decode runner-encrypted activity
   * results in history (see the module header's choke-point note).
   */
  readonly payloadCodecs: PayloadCodec[];
  /**
   * Live client provider for activities that call the Temporal API
   * (CompleteExternalActivity). Reads the manager's CURRENT client, so a
   * reconnect needs no re-registration. Throws if no client ever
   * connected — unreachable from a running activity, because a polling
   * worker implies a connect succeeded.
   */
  readonly client: () => Client;
}

/**
 * Creates one domain worker (agent-execution here; workflow-execution and
 * the schedule clock append theirs in #21/#22 — Go createWorkers' list).
 */
export type WorkerFactory = (deps: WorkerFactoryDeps) => Promise<Worker>;

export interface TemporalManagerOptions {
  readonly hostPort: string;
  readonly namespace: string;
  readonly logger: Logger;
  readonly payloadCodecs: PayloadCodec[];
  readonly workerFactories: readonly WorkerFactory[];
}

interface RunningWorker {
  readonly worker: Worker;
  readonly runPromise: Promise<void>;
}

export class TemporalManager {
  private readonly hostPort: string;
  private readonly namespace: string;
  private readonly logger: Logger;
  private readonly payloadCodecs: PayloadCodec[];
  private readonly workerFactories: readonly WorkerFactory[];

  private client: Client | undefined;
  private connection: Connection | undefined;
  private nativeConnection: NativeConnection | undefined;
  private workers: RunningWorker[] = [];

  private connected = false;
  private consecutiveFails = 0;
  private lastAttemptMs = 0;
  /** Go's reconnectMu.TryLock: one reconnection attempt at a time. */
  private reconnecting = false;
  private monitor: NodeJS.Timeout | undefined;
  private closed = false;
  private readonly reconnectHooks: Array<() => void> = [];

  constructor(options: TemporalManagerOptions) {
    this.hostPort = options.hostPort;
    this.namespace = options.namespace;
    this.logger = options.logger;
    this.payloadCodecs = options.payloadCodecs;
    this.workerFactories = options.workerFactories;
  }

  /**
   * The current client, or undefined until the FIRST successful connect
   * (Go's nil-creator window — see the module header's parity note).
   * After an outage this keeps returning the stale client on purpose;
   * operations fail as Go's do until the monitor swaps in a fresh one.
   */
  getClient(): Client | undefined {
    return this.client;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Registers a callback run after every successful RECONNECTION, once
   * workers are recreated (Go AddReconnectHook). First consumer arrives
   * with #22: the schedule reconciliation kick — an OSS reconnect very
   * often means the dev server restarted with empty state.
   */
  addReconnectHook(hook: () => void): void {
    this.reconnectHooks.push(hook);
  }

  /**
   * Attempts the initial connection with bounded retries; returns true on
   * success, false after all retries (NON-fatal — the health monitor takes
   * over). Mirrors Go InitialConnect.
   */
  async initialConnect(): Promise<boolean> {
    this.logger.info("Attempting initial Temporal connection with retry", {
      host_port: this.hostPort,
      namespace: this.namespace,
      max_retries: INITIAL_CONNECT_MAX_ATTEMPTS,
    });

    for (let attempt = 1; attempt <= INITIAL_CONNECT_MAX_ATTEMPTS; attempt++) {
      try {
        const { connection, client } = await this.dial();
        this.connection = connection;
        this.client = client;
        this.connected = true;
        this.consecutiveFails = 0;
        this.logger.info("Initial Temporal connection successful", {
          host_port: this.hostPort,
          attempt,
        });
        return true;
      } catch (error) {
        if (attempt < INITIAL_CONNECT_MAX_ATTEMPTS) {
          const delayMs = 2 ** (attempt - 1) * INITIAL_CONNECT_BASE_DELAY_MS;
          this.logger.warn("Temporal connection failed, retrying", {
            error: errorMessage(error),
            attempt,
            retry_in_ms: delayMs,
          });
          await sleep(delayMs);
        } else {
          this.logger.warn(
            "Failed initial Temporal connection after all retries - will retry via health monitor",
            { error: errorMessage(error), attempts: attempt },
          );
          this.connected = false;
          this.consecutiveFails = attempt;
          this.lastAttemptMs = Date.now();
        }
      }
    }
    return false;
  }

  /**
   * Creates and starts all workers for the first time (Go StartWorkers).
   * No client → warn and return; a worker-start failure is a warning, not
   * a boot failure (server.go's posture — the health monitor's next
   * reconnect recreates everything).
   */
  async startWorkers(): Promise<void> {
    if (this.client === undefined) {
      this.logger.warn("No Temporal client available, workers not started");
      return;
    }
    try {
      await this.createAndRunWorkers();
      this.logger.info("All Temporal workers started", {
        worker_count: this.workers.length,
      });
    } catch (error) {
      this.logger.warn("Failed to start Temporal workers - health monitor will retry", {
        error: errorMessage(error),
      });
    }
  }

  /**
   * Starts the periodic health check + reconnection loop (Go
   * StartHealthMonitor): an immediate check, then 15s ticks. The interval
   * is unref'd so an unclosed manager cannot keep the process alive past
   * main's intent; close() clears it deliberately.
   */
  startHealthMonitor(): void {
    this.logger.info("Starting Temporal health monitor");
    void this.checkAndReconnect();
    this.monitor = setInterval(() => {
      void this.checkAndReconnect();
    }, HEALTH_CHECK_INTERVAL_MS);
    this.monitor.unref();
  }

  /** Stops the monitor, shuts down workers, closes connections. */
  async close(): Promise<void> {
    this.closed = true;
    if (this.monitor !== undefined) {
      clearInterval(this.monitor);
      this.monitor = undefined;
    }
    await this.shutdownWorkers();
    if (this.nativeConnection !== undefined) {
      await closeQuietly(() => this.nativeConnection!.close(), this.logger);
      this.nativeConnection = undefined;
    }
    if (this.connection !== undefined) {
      await closeQuietly(() => this.connection!.close(), this.logger);
      this.connection = undefined;
    }
    this.logger.info("Temporal manager closed");
  }

  private async dial(): Promise<{ connection: Connection; client: Client }> {
    const connection = await Connection.connect({
      address: this.hostPort,
      connectTimeout: DIAL_CONNECT_TIMEOUT_MS,
    });
    const client = new Client({
      connection,
      namespace: this.namespace,
      // When payload encryption is configured, the decode-only codec is
      // the single client-side choke point for runner-encrypted payload
      // reads (Go dialTemporal). Absent config installs nothing.
      ...(this.payloadCodecs.length > 0
        ? { dataConverter: { payloadCodecs: this.payloadCodecs } }
        : {}),
    });
    return { connection, client };
  }

  private async checkAndReconnect(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.connection !== undefined) {
      if (await this.testConnection(this.connection)) {
        // Healthy — repair the flag if a failed attempt left it false.
        if (!this.connected) {
          this.connected = true;
          this.consecutiveFails = 0;
        }
        return;
      }
      this.logger.warn("Temporal connection unhealthy, initiating reconnection");
    }
    await this.attemptReconnection();
  }

  private async testConnection(connection: Connection): Promise<boolean> {
    try {
      const response = await connection.withDeadline(
        Date.now() + HEALTH_CHECK_TIMEOUT_MS,
        () => connection.healthService.check({ service: TEMPORAL_HEALTH_SERVICE }),
      );
      // 1 = SERVING in grpc.health.v1; anything else is unhealthy.
      return response.status === 1;
    } catch {
      return false;
    }
  }

  private async attemptReconnection(): Promise<void> {
    if (this.reconnecting) {
      return; // Go's TryLock: another attempt is in flight.
    }
    const backoffMs = this.calculateBackoff();
    if (Date.now() - this.lastAttemptMs < backoffMs) {
      return; // Too soon to retry.
    }
    this.reconnecting = true;
    this.lastAttemptMs = Date.now();
    try {
      this.logger.info("Attempting Temporal reconnection", {
        attempt: this.consecutiveFails + 1,
        backoff_ms: backoffMs,
      });

      let dialed: { connection: Connection; client: Client };
      try {
        dialed = await this.dial();
      } catch (error) {
        this.consecutiveFails++;
        this.connected = false;
        this.logger.warn("Temporal reconnection failed, will retry", {
          error: errorMessage(error),
          consecutive_failures: this.consecutiveFails,
        });
        return;
      }

      // close() may have completed while the dial was in flight; adopting
      // the fresh connection now would RESURRECT the manager after
      // shutdown — live pollers, open connections, reconnect hooks firing
      // post-close (panel finding; Go is immune because its monitor's
      // context is cancelled before Close). Discard and stand down.
      if (this.closed) {
        await closeQuietly(() => dialed.connection.close(), this.logger);
        return;
      }

      const oldConnection = this.connection;
      // Swap order is contract (Go attemptReconnection): the new client is
      // observable BEFORE workers restart, so an engine call racing the
      // reconnect sees the fresh client, never a closed one.
      this.connection = dialed.connection;
      this.client = dialed.client;
      this.consecutiveFails = 0;
      this.connected = true;
      this.logger.info("Temporal reconnected successfully");

      await this.restartWorkers();

      // Second closed-recheck: close() may have completed while the
      // workers were being recreated. Tear down everything this attempt
      // built and stand down — hooks must never fire after shutdown.
      if (this.closed) {
        await this.shutdownWorkers();
        if (this.nativeConnection !== undefined) {
          await closeQuietly(() => this.nativeConnection!.close(), this.logger);
          this.nativeConnection = undefined;
        }
        await closeQuietly(() => dialed.connection.close(), this.logger);
        return;
      }

      // No creator re-injection step: the engine-state provider reads
      // getClient() at call time (see the module header).

      // Reconnect hooks last, once workers poll again (Go ordering) —
      // e.g. #22's schedule re-arm must find a worker to fire against.
      for (const hook of [...this.reconnectHooks]) {
        hook();
      }

      if (oldConnection !== undefined) {
        await closeQuietly(() => oldConnection.close(), this.logger);
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private calculateBackoff(): number {
    if (this.consecutiveFails === 0) {
      return 0;
    }
    const backoff = 2 ** (this.consecutiveFails - 1) * 1_000;
    return Math.min(backoff, RECONNECT_BACKOFF_CAP_MS);
  }

  private async restartWorkers(): Promise<void> {
    this.logger.info("Stopping old workers", {
      worker_count: this.workers.length,
    });
    await this.shutdownWorkers();
    if (this.nativeConnection !== undefined) {
      // The old NativeConnection is bound to the dead server; workers get
      // a fresh one (Go workers are recreated from the new client).
      await closeQuietly(() => this.nativeConnection!.close(), this.logger);
      this.nativeConnection = undefined;
    }
    this.logger.info("Creating and starting new workers");
    try {
      await this.createAndRunWorkers();
      this.logger.info("Workers restarted successfully", {
        worker_count: this.workers.length,
      });
    } catch (error) {
      // Mirror Go restartWorkers: a worker failure never breaks the
      // reconnect — the next monitor tick tries again.
      this.logger.warn("Failed to restart workers", {
        error: errorMessage(error),
      });
    }
  }

  private async createAndRunWorkers(): Promise<void> {
    const nativeConnection = await NativeConnection.connect({
      address: this.hostPort,
    });
    this.nativeConnection = nativeConnection;

    const deps: WorkerFactoryDeps = {
      nativeConnection,
      namespace: this.namespace,
      payloadCodecs: this.payloadCodecs,
      client: () => {
        if (this.client === undefined) {
          throw new Error(
            "Temporal client requested before any connection succeeded (boot ordering bug)",
          );
        }
        return this.client;
      },
    };

    // Each worker is tracked THE MOMENT it starts (not after the whole
    // loop): a later factory throwing must leave the earlier workers
    // stoppable by shutdownWorkers/close — an untracked running worker
    // polls forever (panel finding; latent until #21/#22 add factories).
    this.workers = [];
    for (const factory of this.workerFactories) {
      const worker = await factory(deps);
      // run() resolves on graceful shutdown and rejects on fatal worker
      // errors; a rejection is logged and left to the health monitor —
      // exactly Go's "worker died, reconnect recreates it" model.
      const runPromise = worker.run().catch((error: unknown) => {
        this.logger.warn("Temporal worker stopped with error", {
          error: errorMessage(error),
        });
      });
      this.workers.push({ worker, runPromise });
    }
  }

  private async shutdownWorkers(): Promise<void> {
    for (const { worker } of this.workers) {
      try {
        worker.shutdown();
      } catch {
        // Already stopped — shutdown on a non-running worker throws in the
        // TS SDK; Go's Stop is idempotent, and idempotence is what the
        // reconnect path needs here.
      }
    }
    await Promise.all(this.workers.map(({ runPromise }) => runPromise));
    this.workers = [];
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function closeQuietly(
  close: () => Promise<void>,
  logger: Logger,
): Promise<void> {
  try {
    await close();
  } catch (error) {
    logger.warn("Error closing Temporal connection", {
      error: errorMessage(error),
    });
  }
}
