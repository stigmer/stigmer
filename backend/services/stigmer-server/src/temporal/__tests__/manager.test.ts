/**
 * TemporalManager lifecycle tests — pins the two panel findings, the
 * availability posture, and the worker-construction capability:
 *
 *   - close() racing an in-flight reconnect must NOT resurrect the
 *     manager (fresh dial discarded; no workers recreated; no hooks
 *     fired after shutdown) — Go is immune via context cancellation,
 *     this port re-checks `closed` across every await;
 *   - a worker factory throwing mid-loop must leave the already-started
 *     workers TRACKED so close() can stop them (an untracked poller
 *     lives forever — latent until #21/#22 add factories);
 *   - the Go availability parity: getClient() is undefined only until
 *     the first successful connect;
 *   - deps.createWorker builds through THIS package's Worker.create with
 *     the manager's connection, namespace, and codec chain pre-wired
 *     (the finding-16 seam — factories never see the NativeConnection);
 *   - a worker's run() rejection logs at ERROR with its queue identity
 *     (a permanent death re-dies on every recreate while the worker
 *     reports RUNNING — the log line is the only signal).
 *
 * The manager's private dial and the SDK's NativeConnection/Worker.create
 * are stubbed (module mock + private-seam override): the real connect
 * path is proven end-to-end by local-execution; these tests pin the
 * manager's OWN state machine and wiring, which only misbehave in windows
 * no live harness can schedule deterministically.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../../boot/logger.js";
import { TemporalManager, type WorkerFactory } from "../manager.js";

const sdkSpy = vi.hoisted(() => ({
  /** Options of every Worker.create call, in order. */
  createCalls: [] as Record<string, unknown>[],
  /** The connection object the mocked NativeConnection.connect returned last. */
  lastConnection: undefined as unknown,
}));

vi.mock("@temporalio/worker", async (importOriginal) => {
  const original = await importOriginal<typeof import("@temporalio/worker")>();
  return {
    ...original,
    NativeConnection: {
      connect: async () => {
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
  },
): TemporalManager {
  const manager = new TemporalManager({
    hostPort: "127.0.0.1:1",
    namespace: "default",
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

describe("TemporalManager createWorker capability (the finding-16 seam)", () => {
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
