/**
 * TemporalManager lifecycle tests — pins the two panel findings plus the
 * availability posture:
 *
 *   - close() racing an in-flight reconnect must NOT resurrect the
 *     manager (fresh dial discarded; no workers recreated; no hooks
 *     fired after shutdown) — Go is immune via context cancellation,
 *     this port re-checks `closed` across every await;
 *   - a worker factory throwing mid-loop must leave the already-started
 *     workers TRACKED so close() can stop them (an untracked poller
 *     lives forever — latent until #21/#22 add factories);
 *   - the Go availability parity: getClient() is undefined only until
 *     the first successful connect.
 *
 * The manager's private dial and the SDK's NativeConnection are stubbed
 * (module mock + private-seam override): the real connect path is proven
 * end-to-end by local-execution; these tests pin the manager's OWN
 * state machine, which only misbehaves in windows no live harness can
 * schedule deterministically.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../../boot/logger.js";
import { TemporalManager, type WorkerFactory } from "../manager.js";

vi.mock("@temporalio/worker", async (importOriginal) => {
  const original = await importOriginal<typeof import("@temporalio/worker")>();
  return {
    ...original,
    NativeConnection: {
      connect: async () => ({ close: async () => {} }),
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
      run: () => done,
      shutdown: () => {
        record.shutdowns++;
        release?.();
      },
    } as unknown as Awaited<ReturnType<WorkerFactory>>;
  };
}

function newManager(factories: WorkerFactory[]): TemporalManager {
  const manager = new TemporalManager({
    hostPort: "127.0.0.1:1",
    namespace: "default",
    logger: silentLogger,
    payloadCodecs: [],
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

    expect(manager.isConnected(), "a closed manager must stay down").toBe(false);
    expect(manager.getClient(), "the fresh client must be discarded").toBeUndefined();
    expect(hookFired, "reconnect hooks must never fire after shutdown").toBe(false);
    expect(freshConnection.closed, "the discarded dial's connection is closed").toBe(1);
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
    stubDial(manager, async () => ({ connection: { close: async () => {} }, client: {} }));

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
    stubDial(manager, async () => ({ connection: { close: async () => {} }, client }));
    await manager.initialConnect();

    expect(manager.getClient()).toBe(client);
    expect(manager.isConnected()).toBe(true);
  });
});
