/**
 * TemporalManager lifecycle tests — pins the shutdown race and the
 * partial-start tracking, the availability posture, and the worker-construction
 * capability:
 *
 *   - close() racing an in-flight reconnect must NOT resurrect the
 *     manager (fresh dial discarded; no workers recreated; no hooks
 *     fired after shutdown) — Go is immune via context cancellation,
 *     this port re-checks `closed` across every await;
 *   - a worker factory throwing mid-loop must leave the already-started
 *     workers TRACKED so close() can stop them (an untracked poller
 *     lives forever);
 *   - the Go availability parity: getClient() is undefined only until
 *     the first successful connect;
 *   - both connections, the client's and the workers' native one, carry
 *     the configured connection security (TLS and API key) beside the
 *     address, and a plaintext manager passes neither;
 *   - deps.createWorker builds through THIS package's Worker.create with
 *     the manager's connection, namespace, and codec chain pre-wired
 *     (factories never see the NativeConnection);
 *   - a worker's run() rejection logs at ERROR with its queue identity
 *     (a permanent death re-dies on every recreate while the worker
 *     reports RUNNING — the log line is the only signal);
 *   - the manager's logger is attached to the SDK log bridge before
 *     every native connect, first start and reconnect alike (#1037: the
 *     first native connect creates the Runtime, after which its logger
 *     cannot be installed).
 *
 * The manager's private dial, the SDK's NativeConnection/Worker.create and
 * the process SDK log bridge are stubbed (module mock + private-seam
 * override), so no test here creates the native Runtime: the real connect
 * path is proven end-to-end by local-execution; these tests pin the
 * manager's OWN state machine and wiring, which only misbehave in windows
 * no live harness can schedule deterministically.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger, type Logger } from "../../boot/logger.js";
import { TemporalManager, type WorkerFactory } from "../manager.js";

const sdkSpy = vi.hoisted(() => ({
  /** Options of every Worker.create call, in order. */
  createCalls: [] as Record<string, unknown>[],
  /** The connection object the mocked NativeConnection.connect returned last. */
  lastConnection: undefined as unknown,
  /** Options of every NativeConnection.connect and Connection.connect call. */
  nativeConnectCalls: [] as Record<string, unknown>[],
  clientConnectCalls: [] as Record<string, unknown>[],
  /** Bridge attaches and native connects, in the order they happened. */
  order: [] as Array<"attach" | "native-connect">,
  /** The logger of every SDK log bridge attach, in order. */
  attachedLoggers: [] as unknown[],
}));

vi.mock("../sdk-logger.js", () => ({
  processSdkLogBridge: {
    attach: (logger: unknown) => {
      sdkSpy.order.push("attach");
      sdkSpy.attachedLoggers.push(logger);
    },
  },
}));

vi.mock("@temporalio/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@temporalio/client")>();
  return {
    ...original,
    Connection: {
      connect: async (options: Record<string, unknown>) => {
        sdkSpy.clientConnectCalls.push(options);
        return { close: async () => {}, healthService: { check: async () => ({ status: 1 }) } };
      },
    },
    Client: class {
      constructor(readonly options: Record<string, unknown>) {}
    },
  };
});

vi.mock("@temporalio/worker", async (importOriginal) => {
  const original = await importOriginal<typeof import("@temporalio/worker")>();
  return {
    ...original,
    NativeConnection: {
      connect: async (options: Record<string, unknown>) => {
        sdkSpy.nativeConnectCalls.push(options);
        sdkSpy.order.push("native-connect");
        const connection = { close: async () => {} };
        sdkSpy.lastConnection = connection;
        return connection;
      },
    },
    Worker: {
      create: async (options: Record<string, unknown>) => {
        sdkSpy.createCalls.push(options);
        let release: (() => void) | undefined;
        const done = new Promise<void>((resolve) => {
          release = resolve;
        });
        return {
          options: { taskQueue: options["taskQueue"] },
          run: () => done,
          shutdown: () => release?.(),
        };
      },
    },
  };
});

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const managers: TemporalManager[] = [];
afterEach(async () => {
  sdkSpy.createCalls.length = 0;
  sdkSpy.lastConnection = undefined;
  sdkSpy.nativeConnectCalls.length = 0;
  sdkSpy.clientConnectCalls.length = 0;
  sdkSpy.order.length = 0;
  sdkSpy.attachedLoggers.length = 0;
  for (const manager of managers.splice(0)) {
    await manager.close();
  }
});

interface FakeWorkerRecord {
  shutdowns: number;
}

/** A Worker double: run() resolves when shutdown() is called. */
function fakeWorkerFactory(record: FakeWorkerRecord): WorkerFactory {
  return async () => {
    let release: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      options: { taskQueue: "fake-queue" },
      run: () => done,
      shutdown: () => {
        record.shutdowns++;
        release?.();
      },
    } as unknown as Awaited<ReturnType<WorkerFactory>>;
  };
}

function newManager(
  factories: WorkerFactory[],
  options?: {
    logger?: typeof silentLogger;
    payloadCodecs?: ConstructorParameters<
      typeof TemporalManager
    >[0]["payloadCodecs"];
    connection?: ConstructorParameters<typeof TemporalManager>[0]["connection"];
  },
): TemporalManager {
  const manager = new TemporalManager({
    hostPort: "127.0.0.1:1",
    namespace: "default",
    connection: options?.connection ?? {},
    logger: options?.logger ?? silentLogger,
    payloadCodecs: options?.payloadCodecs ?? [],
    workerFactories: factories,
  });
  managers.push(manager);
  return manager;
}

/** Stubs the private dial seam with a controllable connection/client pair. */
function stubDial(
  manager: TemporalManager,
  impl: () => Promise<{ connection: unknown; client: unknown }>,
): void {
  (manager as unknown as { dial: typeof impl }).dial = impl;
}

describe("TemporalManager close/reconnect race", () => {
  it("discards a dial that completes after close() — no resurrection, no hooks", async () => {
    const record: FakeWorkerRecord = { shutdowns: 0 };
    const manager = newManager([fakeWorkerFactory(record)]);
    let hookFired = false;
    manager.addReconnectHook(() => {
      hookFired = true;
    });

    let releaseDial: (() => void) | undefined;
    const dialGate = new Promise<void>((resolve) => {
      releaseDial = resolve;
    });
    const freshConnection = { closed: 0, close: async () => {} };
    freshConnection.close = async () => {
      freshConnection.closed++;
    };
    stubDial(manager, async () => {
      await dialGate;
      return { connection: freshConnection, client: {} };
    });

    // Drive attemptReconnection directly (the monitor path), then close()
    // while the dial is parked, then release the dial.
    const reconnectPromise = (
      manager as unknown as { attemptReconnection: () => Promise<void> }
    ).attemptReconnection();
    await manager.close();
    releaseDial!();
    await reconnectPromise;

    expect(manager.isConnected(), "a closed manager must stay down").toBe(
      false,
    );
    expect(
      manager.getClient(),
      "the fresh client must be discarded",
    ).toBeUndefined();
    expect(hookFired, "reconnect hooks must never fire after shutdown").toBe(
      false,
    );
    expect(
      freshConnection.closed,
      "the discarded dial's connection is closed",
    ).toBe(1);
    expect(record.shutdowns, "no workers may be created after close").toBe(0);
  });
});

describe("TemporalManager worker tracking", () => {
  it("keeps already-started workers stoppable when a later factory throws", async () => {
    const record: FakeWorkerRecord = { shutdowns: 0 };
    const manager = newManager([
      fakeWorkerFactory(record),
      async () => {
        throw new Error("factory two exploded");
      },
    ]);
    stubDial(manager, async () => ({
      connection: { close: async () => {} },
      client: {},
    }));

    await manager.initialConnect();
    // startWorkers logs the factory failure as a warning (Go posture)…
    await manager.startWorkers();
    // …but the FIRST worker already started polling; close() must reach it.
    await manager.close();

    expect(
      record.shutdowns,
      "the started worker must be tracked and shut down despite the later factory failure",
    ).toBe(1);
  });
});

describe("TemporalManager availability posture", () => {
  it("getClient() is undefined until the first successful connect (Go's nil-creator window)", async () => {
    const manager = newManager([]);
    expect(manager.getClient()).toBeUndefined();

    const client = { marker: "client-1" };
    stubDial(manager, async () => ({
      connection: { close: async () => {} },
      client,
    }));
    await manager.initialConnect();

    expect(manager.getClient()).toBe(client);
    expect(manager.isConnected()).toBe(true);
  });
});

describe("TemporalManager createWorker capability", () => {
  it("builds through this package's Worker.create with connection, namespace, and codecs pre-wired", async () => {
    const fakeCodec = { encode: async () => [], decode: async () => [] };
    const manager = newManager(
      [
        (deps) =>
          deps.createWorker({
            taskQueue: "capability-queue",
            activities: { doThing: async () => {} },
            workflows: { workflowsPath: "/tmp/workflows.js" },
          }),
      ],
      { payloadCodecs: [fakeCodec] },
    );
    stubDial(manager, async () => ({
      connection: { close: async () => {} },
      client: {},
    }));

    await manager.initialConnect();
    await manager.startWorkers();

    expect(sdkSpy.createCalls).toHaveLength(1);
    const created = sdkSpy.createCalls[0]!;
    expect(
      created["connection"],
      "the worker must be bound to the manager's own NativeConnection",
    ).toBe(sdkSpy.lastConnection);
    expect(created["namespace"]).toBe("default");
    expect(created["taskQueue"]).toBe("capability-queue");
    expect(created["workflowsPath"]).toBe("/tmp/workflows.js");
    expect(
      created["dataConverter"],
      "the decode-only codec chain must reach every worker (the choke point)",
    ).toEqual({ payloadCodecs: [fakeCodec] });
  });

  it("omits dataConverter when no codecs are configured (the SQLite-local shape)", async () => {
    const manager = newManager([
      (deps) =>
        deps.createWorker({
          taskQueue: "codecless-queue",
          activities: {},
          workflows: { workflowBundle: { code: "bundled" } },
        }),
    ]);
    stubDial(manager, async () => ({
      connection: { close: async () => {} },
      client: {},
    }));

    await manager.initialConnect();
    await manager.startWorkers();

    expect(sdkSpy.createCalls).toHaveLength(1);
    const created = sdkSpy.createCalls[0]!;
    expect("dataConverter" in created).toBe(false);
    expect(created["workflowBundle"]).toEqual({ code: "bundled" });
  });
});

describe("TemporalManager connection security", () => {
  it("spreads TLS and the API key into both the client's and the workers' connections", async () => {
    const security = {
      tls: { serverNameOverride: "temporal.internal" },
      apiKey: "api-key-1",
    };
    const manager = newManager([fakeWorkerFactory({ shutdowns: 0 })], {
      connection: security,
    });

    await manager.initialConnect();
    await manager.startWorkers();

    expect(sdkSpy.clientConnectCalls).toHaveLength(1);
    expect(sdkSpy.clientConnectCalls[0]).toMatchObject({ address: "127.0.0.1:1", ...security });
    expect(sdkSpy.nativeConnectCalls).toHaveLength(1);
    expect(sdkSpy.nativeConnectCalls[0]).toEqual({ address: "127.0.0.1:1", ...security });
  });

  it("passes neither for a plaintext manager", async () => {
    const manager = newManager([fakeWorkerFactory({ shutdowns: 0 })]);

    await manager.initialConnect();
    await manager.startWorkers();

    expect(sdkSpy.clientConnectCalls[0]).not.toHaveProperty("tls");
    expect(sdkSpy.clientConnectCalls[0]).not.toHaveProperty("apiKey");
    expect(sdkSpy.nativeConnectCalls[0]).toEqual({ address: "127.0.0.1:1" });
  });
});

describe("TemporalManager worker-death observability", () => {
  it("logs a run() rejection at ERROR with the dead worker's queue identity", async () => {
    const lines: string[] = [];
    const capturingLogger = createLogger({
      level: "error",
      pretty: false,
      write: (line) => {
        lines.push(line);
      },
    });
    const manager = newManager(
      [
        async () =>
          ({
            options: { taskQueue: "doomed-queue" },
            run: () => Promise.reject(new Error("poller exploded")),
            shutdown: () => {},
          }) as unknown as Awaited<ReturnType<WorkerFactory>>,
      ],
      { logger: capturingLogger },
    );
    stubDial(manager, async () => ({
      connection: { close: async () => {} },
      client: {},
    }));

    await manager.initialConnect();
    await manager.startWorkers();
    // The rejection is handled asynchronously; drain the microtask queue.
    await new Promise((resolve) => setImmediate(resolve));

    const death = lines.find((line) =>
      line.includes("Temporal worker stopped with error"),
    );
    expect(death, "the death must be logged").toBeDefined();
    expect(death).toContain('"level":"error"');
    expect(death).toContain('"task_queue":"doomed-queue"');
    expect(death).toContain("poller exploded");
  });
});

describe("TemporalManager SDK log routing (#1037)", () => {
  it("attaches its logger to the SDK log bridge before every native connect", async () => {
    const logger: Logger = createLogger({
      level: "error",
      pretty: false,
      write: () => {},
    });
    const manager = newManager([fakeWorkerFactory({ shutdowns: 0 })], {
      logger,
    });
    stubDial(manager, async () => ({
      connection: { close: async () => {} },
      client: {},
    }));

    await manager.initialConnect();
    await manager.startWorkers();
    await (
      manager as unknown as { attemptReconnection: () => Promise<void> }
    ).attemptReconnection();

    expect(sdkSpy.order).toEqual([
      "attach",
      "native-connect",
      "attach",
      "native-connect",
    ]);
    expect(sdkSpy.attachedLoggers).toEqual([logger, logger]);
  });
});
