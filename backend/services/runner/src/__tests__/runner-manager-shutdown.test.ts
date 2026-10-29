/**
 * Pins the manager's full shutdown (runner-manager.ts, `shutdown`): every
 * queue's worker-shutdown signal is aborted BEFORE any worker drains, so an
 * activity the drain cancels classifies itself as a worker shutdown and
 * persists RUN_FAILED with the shutdown copy, never the orchestrator stop a
 * user's pause is (#776). Then every session worker drains, the harnesses
 * release what they hold, and the Temporal connection closes.
 * A manager whose boot fails once the agent host is up releases the
 * harnesses before the error reaches its caller. Every session's worker
 * sends heartbeats within the cancellation pulse, as the static worker does,
 * so a pause reaches a turn in a sandbox as fast as anywhere. The agent host
 * is started with the MCP bridge the bootstrap discovered, the bootstrap
 * having resolved first, and the runner's own STIGMER_MCP_BRIDGE_ENDPOINT
 * wins over it (stigmer#1374: the desktop's runner is this root).
 *
 * Temporal, the control-plane bootstrap, the harness registry and the LLM
 * preflight are replaced at their module seams, and the hosting is observed
 * at its own, so the manager's own bookkeeping runs in-process without a
 * server or a worker.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/** One fake worker per queue: `run()` settles when `shutdown()` is called, as the SDK's drain does. */
interface FakeWorker {
  readonly taskQueue: string;
  /** The heartbeat throttle the worker was created with. */
  readonly maxHeartbeatThrottleInterval: unknown;
  /** The queue's shutdown signal as it read when the drain began. */
  abortedAtDrain?: boolean;
  run(): Promise<void>;
  shutdown(): void;
}

const fakes = vi.hoisted(() => ({
  workers: [] as FakeWorker[],
  connectionClose: { calls: 0 },
  shutdownHarnesses: { calls: 0 },
  releasedSessions: [] as string[],
  connectFails: false,
  discoveredBridge: undefined as string | undefined,
  hostedBridges: [] as (string | null)[],
  bootedBridges: [] as (string | null)[],
  signalOf: undefined as
    | ((taskQueue: string) => AbortSignal | undefined)
    | undefined,
}));

vi.mock("@temporalio/worker", () => ({
  NativeConnection: {
    connect: async () => {
      if (fakes.connectFails) throw new Error("Temporal is unreachable");
      return {
        close: () => {
          fakes.connectionClose.calls++;
        },
      };
    },
  },
  Worker: {
    create: async ({ taskQueue, maxHeartbeatThrottleInterval }: { taskQueue: string; maxHeartbeatThrottleInterval?: unknown }) => {
      let release: () => void = () => {};
      const drained = new Promise<void>((resolve) => {
        release = resolve;
      });
      const worker: FakeWorker = {
        taskQueue,
        maxHeartbeatThrottleInterval,
        run: () => drained,
        shutdown() {
          worker.abortedAtDrain = fakes.signalOf?.(taskQueue)?.aborted ?? false;
          release();
        },
      };
      fakes.workers.push(worker);
      return worker;
    },
  },
  bundleWorkflowCode: async () => ({ code: "" }),
}));

vi.mock("../bootstrap.js", () => ({
  resolveRunnerBootstrap: async () => ({
    temporalAddress: "127.0.0.1:7233",
    temporalNamespace: "default",
    mcpBridgeEndpoint: fakes.discoveredBridge,
  }),
  refreshRunnerAccessToken: async () => null,
}));

vi.mock("../preflight.js", () => ({
  assertLlmBackendsPreflight: () => {},
}));

vi.mock("../workflow-source.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../workflow-source.js")>();
  return {
    ...actual,
    resolveWorkflowSource: () => ({
      kind: "prebuilt",
      codePath: "/nonexistent/workflow-bundle.js",
    }),
  };
});

vi.mock("../harness-adapters.js", () => ({ HARNESS_ADAPTERS: [] }));

vi.mock("../agent-host/hosting.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../agent-host/hosting.js")>();
  return {
    ...actual,
    hostHarnesses: (...args: Parameters<typeof actual.hostHarnesses>) => {
      fakes.hostedBridges.push(args[1].mcpBridgeEndpoint);
      return actual.hostHarnesses(...args);
    },
  };
});

vi.mock("../harness/registry.js", () => ({
  adaptersOf: () => [],
  bootHarnesses: async (_adapters: unknown, config: { mcpBridgeEndpoint: string | null }) => {
    fakes.bootedBridges.push(config.mcpBridgeEndpoint);
  },
  createHarnessActivities: async () => ({}),
  releaseHarnessSession: async (_adapters: unknown, sessionId: string) => {
    fakes.releasedSessions.push(sessionId);
  },
  shutdownHarnesses: async () => {
    fakes.shutdownHarnesses.calls++;
  },
}));

import {
  createStigmerRunnerManager,
  getShutdownSignalForQueue,
} from "../runner-manager.js";
import { CANCELLATION_PULSE_MS } from "../shared/heartbeat.js";

fakes.signalOf = getShutdownSignalForQueue;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StigmerRunnerManager.shutdown", () => {
  it("aborts every queue's shutdown signal before any worker drains, then closes the connection", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = await createStigmerRunnerManager({
      stigmerEndpoint: "localhost:7234",
      temporalAddress: "127.0.0.1:7233",
      workspaceRootDir: join(tmpdir(), "stigmer-runner-manager-shutdown-test"),
    });

    await manager.addSession("ses_1");
    await manager.addSession("ses_2");
    expect(fakes.workers.map((w) => w.taskQueue)).toEqual([
      "session:ses_1",
      "session:ses_2",
    ]);

    await manager.shutdown();

    for (const worker of fakes.workers) {
      expect(
        worker.abortedAtDrain,
        `${worker.taskQueue}: aborted before its drain`,
      ).toBe(true);
    }
    expect(fakes.shutdownHarnesses.calls).toBe(1);
    expect(fakes.connectionClose.calls).toBe(1);
    expect(manager.activeSessions()).toEqual([]);
    await expect(manager.addSession("ses_3")).rejects.toThrow(
      "RunnerManager is shutting down",
    );
  });
});

describe("createStigmerRunnerManager, failing", () => {
  it("releases the harnesses it booted when Temporal cannot be reached", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = fakes.shutdownHarnesses.calls;
    fakes.connectFails = true;
    try {
      await expect(
        createStigmerRunnerManager({
          stigmerEndpoint: "localhost:7234",
          temporalAddress: "127.0.0.1:7233",
          workspaceRootDir: join(tmpdir(), "stigmer-runner-manager-failed-boot-test"),
        }),
      ).rejects.toThrow("Temporal is unreachable");
    } finally {
      fakes.connectFails = false;
    }
    expect(fakes.shutdownHarnesses.calls - before).toBe(1);
  });
});

describe("StigmerRunnerManager.removeSession", () => {
  it("has every harness, the hosted ones included, release what it parked for the session", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = await createStigmerRunnerManager({
      stigmerEndpoint: "localhost:7234",
      temporalAddress: "127.0.0.1:7233",
      workspaceRootDir: join(tmpdir(), "stigmer-runner-manager-release-test"),
    });

    await manager.addSession("ses_release");
    await manager.removeSession("ses_release");

    expect(fakes.releasedSessions).toEqual(["ses_release"]);
    await manager.shutdown();
  });
});

describe("StigmerRunnerManager.addSession", () => {
  it("creates the session's worker with the cancellation pulse's heartbeat throttle", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = await createStigmerRunnerManager({
      stigmerEndpoint: "localhost:7234",
      temporalAddress: "127.0.0.1:7233",
      workspaceRootDir: join(tmpdir(), "stigmer-runner-manager-heartbeat-test"),
    });

    await manager.addSession("ses_pulse");

    const worker = fakes.workers.find((w) => w.taskQueue === "session:ses_pulse");
    expect(worker?.maxHeartbeatThrottleInterval).toBe(CANCELLATION_PULSE_MS);
    await manager.shutdown();
  });
});

describe("createStigmerRunnerManager, hosting with the bootstrap's MCP bridge", () => {
  afterEach(() => {
    fakes.discoveredBridge = undefined;
    vi.unstubAllEnvs();
  });

  async function bootAndStop(): Promise<{ hosted: string | null | undefined; booted: string | null | undefined }> {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = await createStigmerRunnerManager({
      stigmerEndpoint: "localhost:7234",
      stigmerToken: "token",
      workspaceRootDir: join(tmpdir(), "stigmer-runner-manager-bridge-test"),
    });
    await manager.shutdown();
    return { hosted: fakes.hostedBridges.at(-1), booted: fakes.bootedBridges.at(-1) };
  }

  it("starts the agent host and boots the harnesses with the bridge the bootstrap discovered", async () => {
    vi.stubEnv("STIGMER_MCP_BRIDGE_ENDPOINT", undefined);
    fakes.discoveredBridge = "https://mcp.example.test";
    expect(await bootAndStop()).toEqual({ hosted: "https://mcp.example.test", booted: "https://mcp.example.test" });
  });

  it("keeps the runner's own STIGMER_MCP_BRIDGE_ENDPOINT over a discovered one", async () => {
    vi.stubEnv("STIGMER_MCP_BRIDGE_ENDPOINT", "https://bridge.own.test");
    fakes.discoveredBridge = "https://mcp.example.test";
    expect(await bootAndStop()).toEqual({ hosted: "https://bridge.own.test", booted: "https://bridge.own.test" });
  });

  it("keeps the local shape when neither names a bridge", async () => {
    vi.stubEnv("STIGMER_MCP_BRIDGE_ENDPOINT", undefined);
    expect(await bootAndStop()).toEqual({ hosted: null, booted: null });
  });
});
