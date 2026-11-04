/**
 * TemporalManager lifecycle tests — pins the shutdown race and the
 * partial-start tracking, the availability posture, and the worker-construction
 * capability:
 *
 *   - close() racing an in-flight reconnect must NOT resurrect the
 *     manager (fresh dial discarded; no workers recreated; no hooks
 *     fired after shutdown) — the manager re-checks `closed` across every
 *     await;
 *   - a worker factory throwing mid-loop must leave the already-started
 *     workers TRACKED so close() can stop them (an untracked poller
 *     lives forever);
 *   - the availability posture: getClient() is undefined only until
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
 *     cannot be installed);
 *   - the boot schedule (#2178): initialConnect() makes exactly one dial,
 *     so an absent engine costs boot one dial window, and a healthy one is
 *     connected before it resolves; while the engine has never connected,
 *     the monitor makes the initial schedule's remaining attempts at 1s
 *     and 2s through the reconnect path (workers recreated, each hook
 *     fired once), then falls back to its own cadence; close() inside
 *     that window leaves no timer and adopts nothing.
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

  it("dials once while a reconnection is already in flight", async () => {
    const manager = newManager([]);
    let dials = 0;
    let releaseDial: (() => void) | undefined;
    const dialGate = new Promise<void>((resolve) => {
      releaseDial = resolve;
    });
    stubDial(manager, async () => {
      dials++;
      await dialGate;
      throw new Error("still down");
    });
    const reconnect = manager as unknown as {
      attemptReconnection: () => Promise<void>;
    };

    const first = reconnect.attemptReconnection();
    await reconnect.attemptReconnection();
    releaseDial!();
    await first;

    expect(dials, "the second attempt stands down while the first dials").toBe(1);
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
    // startWorkers logs the factory failure as a warning…
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
  it("getClient() is undefined until the first successful connect", async () => {
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

describe("TemporalManager boot schedule (#2178)", () => {
  /** A connection double the monitor's health check reads as SERVING. */
  function healthyConnection(): unknown {
    return {
      close: async () => {},
      withDeadline: (_deadline: number, fn: () => Promise<unknown>) => fn(),
      healthService: { check: async () => ({ status: 1 }) },
    };
  }

  /**
   * Fails the first `failures` dials, then answers with a healthy pair;
   * `dials` counts every call.
   */
  function flakyDial(failures: number): {
    readonly dial: () => Promise<{ connection: unknown; client: unknown }>;
    readonly dials: () => number;
  } {
    let dials = 0;
    return {
      dial: async () => {
        dials++;
        if (dials <= failures) {
          throw new Error("connect ECONNREFUSED 127.0.0.1:1");
        }
        return { connection: healthyConnection(), client: { dial: dials } };
      },
      dials: () => dials,
    };
  }

  afterEach(async () => {
    // Closed under the fake clock that armed their timers, before it goes.
    for (const manager of managers.splice(0)) {
      await manager.close();
    }
    vi.useRealTimers();
  });

  it("a refused first dial returns from initialConnect after one attempt", async () => {
    const manager = newManager([]);
    const dial = flakyDial(Number.POSITIVE_INFINITY);
    stubDial(manager, dial.dial);

    const started = Date.now();
    const connected = await manager.initialConnect();

    expect(connected).toBe(false);
    expect(dial.dials(), "boot makes one dial, never the whole schedule").toBe(1);
    expect(
      Date.now() - started,
      "no retry sleep inside the awaited connect",
    ).toBeLessThan(500);
    expect(manager.getClient()).toBeUndefined();
  });

  it("a healthy first dial is connected before initialConnect resolves, and the monitor dials nothing more", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const record: FakeWorkerRecord = { shutdowns: 0 };
    let created = 0;
    const factory = fakeWorkerFactory(record);
    const manager = newManager([
      async (deps) => {
        created++;
        return factory(deps);
      },
    ]);
    const dial = flakyDial(0);
    stubDial(manager, dial.dial);

    const connected = await manager.initialConnect();
    expect(connected).toBe(true);
    expect(manager.isConnected()).toBe(true);
    expect(manager.getClient()).toEqual({ dial: 1 });
    await manager.startWorkers();
    manager.startHealthMonitor();
    await vi.advanceTimersByTimeAsync(31_000);

    expect(dial.dials(), "a healthy engine is never re-dialed").toBe(1);
    expect(created, "workers are started once, by startWorkers").toBe(1);
  });

  it("makes the remaining initial attempts at 1s and 2s through the reconnect path", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    let created = 0;
    const factory = fakeWorkerFactory({ shutdowns: 0 });
    const manager = newManager([
      async (deps) => {
        created++;
        return factory(deps);
      },
    ]);
    let hooks = 0;
    manager.addReconnectHook(() => {
      hooks++;
    });
    const dial = flakyDial(2);
    stubDial(manager, dial.dial);

    expect(await manager.initialConnect()).toBe(false);
    await manager.startWorkers();
    manager.startHealthMonitor();

    await vi.advanceTimersByTimeAsync(999);
    expect(dial.dials(), "the second attempt waits the first backoff").toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(dial.dials(), "the second attempt runs at 1s").toBe(2);
    expect(manager.isConnected()).toBe(false);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(dial.dials(), "the third attempt waits the second backoff").toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(dial.dials(), "the third attempt runs 2s later").toBe(3);

    expect(manager.isConnected()).toBe(true);
    expect(manager.getClient()).toEqual({ dial: 3 });
    expect(created, "the late connect creates the workers").toBe(1);
    expect(hooks, "each reconnect hook fires once on the late connect").toBe(1);

    await vi.advanceTimersByTimeAsync(31_000);
    expect(dial.dials(), "a connected engine is not re-dialed").toBe(3);
    expect(hooks).toBe(1);
  });

  it("falls back to the monitor's cadence once the initial schedule is spent", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const manager = newManager([]);
    const dial = flakyDial(Number.POSITIVE_INFINITY);
    stubDial(manager, dial.dial);

    await manager.initialConnect();
    manager.startHealthMonitor();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(dial.dials(), "three attempts on the initial schedule").toBe(3);

    await vi.advanceTimersByTimeAsync(11_999);
    expect(dial.dials(), "nothing more before the monitor's tick").toBe(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(dial.dials(), "the monitor's 15s tick dials next").toBe(4);
  });

  it("close() in the window leaves no timer and adopts nothing", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const manager = newManager([]);
    let hooks = 0;
    manager.addReconnectHook(() => {
      hooks++;
    });
    const dial = flakyDial(1);
    stubDial(manager, dial.dial);

    await manager.initialConnect();
    manager.startHealthMonitor();
    await manager.close();
    expect(vi.getTimerCount(), "close() clears the pending attempt").toBe(0);

    await vi.advanceTimersByTimeAsync(31_000);
    expect(dial.dials(), "no dial after close").toBe(1);
    expect(manager.getClient()).toBeUndefined();
    expect(hooks).toBe(0);
  });

  it("a scheduled dial that lands after close() is discarded, with no hook fired", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    const manager = newManager([]);
    let hooks = 0;
    manager.addReconnectHook(() => {
      hooks++;
    });
    let dials = 0;
    let releaseDial: (() => void) | undefined;
    const dialGate = new Promise<void>((resolve) => {
      releaseDial = resolve;
    });
    let closes = 0;
    stubDial(manager, async () => {
      dials++;
      if (dials === 1) {
        throw new Error("connect ECONNREFUSED 127.0.0.1:1");
      }
      await dialGate;
      return {
        connection: {
          close: async () => {
            closes++;
          },
        },
        client: {},
      };
    });

    await manager.initialConnect();
    manager.startHealthMonitor();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(dials, "the scheduled attempt is dialing").toBe(2);
    await manager.close();
    releaseDial!();
    await vi.advanceTimersByTimeAsync(0);

    expect(manager.getClient(), "the late dial is not adopted").toBeUndefined();
    expect(closes, "its connection is closed").toBe(1);
    expect(hooks).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
