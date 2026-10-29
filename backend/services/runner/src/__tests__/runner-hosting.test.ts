/**
 * The static root (`runner.ts`, `createStigmerRunner`) runs the hosted
 * table: it hosts the harness table before it boots it, boots the rows the
 * hosting returned (the hosted harnesses' remote adapters among them),
 * binds the activities over those same rows, and after the worker drains
 * releases the harnesses and then closes the local proxy; a boot that fails
 * once the host is up releases them the same way and rethrows. Its shutdown
 * drains once, with the drain grace, and a second call stops the queue's
 * turns now.
 *
 * The bootstrap resolves before the host starts, because the host builds its
 * turns' configuration once, from the config it is started with: the host
 * and the harness boot are given the MCP bridge the bootstrap discovered
 * (stigmer#1374), the runner's own STIGMER_MCP_BRIDGE_ENDPOINT wins over it,
 * and a bootstrap that fails starts no host and so releases nothing.
 *
 * Temporal, the bootstrap, the preflight, the registry and the hosting are
 * replaced at their module seams, so the root's own wiring runs in-process.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const fakes = vi.hoisted(() => ({
  order: [] as string[],
  hostedArgs: [] as unknown[],
  hostedBridges: [] as (string | null)[],
  booted: [] as unknown[],
  bootedBridges: [] as (string | null)[],
  discoveredBridge: undefined as string | undefined,
  activitiesFail: false,
  bound: [] as unknown[],
  release: () => {},
  workerShutdowns: 0,
  drainGraces: [] as number[],
  bootstrapFails: false,
  runFails: false,
}));

vi.mock("../worker.js", () => ({
  startWorker: async ({ config }: { config: { drainGraceMs: number } }) => {
    fakes.drainGraces.push(config.drainGraceMs);
    const drained = new Promise<void>((resolve) => {
      fakes.release = resolve;
    });
    return {
      worker: { run: () => (fakes.runFails ? Promise.reject(new Error("the worker died")) : drained), shutdown: () => {
        fakes.workerShutdowns += 1;
        fakes.release();
      } },
      connection: { close: async () => void fakes.order.push("connection closed") },
    };
  },
}));

vi.mock("../bootstrap.js", () => ({
  resolveRunnerBootstrap: async () => {
    if (fakes.bootstrapFails) throw new Error("the control plane is unreachable");
    return { temporalAddress: "127.0.0.1:7233", temporalNamespace: "default", mcpBridgeEndpoint: fakes.discoveredBridge };
  },
  refreshRunnerAccessToken: async () => null,
}));

vi.mock("../preflight.js", () => ({ assertLlmBackendsPreflight: () => {} }));

vi.mock("../harness-adapters.js", () => ({ HARNESS_ADAPTERS: [{ harness: "stigmer", adapter: { name: "table" } }] }));

vi.mock("../agent-host/hosting.js", () => ({
  hostHarnesses: async (rows: unknown, config: { mcpBridgeEndpoint: string | null }) => {
    fakes.hostedArgs.push(rows);
    fakes.hostedBridges.push(config.mcpBridgeEndpoint);
    return {
      rows: [{ harness: "stigmer", adapter: { name: "remote" } }],
      close: async () => void fakes.order.push("proxy closed"),
    };
  },
}));

vi.mock("../harness/registry.js", () => ({
  adaptersOf: (rows: readonly { adapter: unknown }[]) => rows.map((r) => r.adapter),
  bootHarnesses: async (adapters: unknown, config: { mcpBridgeEndpoint: string | null }) => {
    fakes.booted.push(adapters);
    fakes.bootedBridges.push(config.mcpBridgeEndpoint);
  },
  createHarnessActivities: async (rows: unknown) => {
    if (fakes.activitiesFail) throw new Error("the activities could not be created");
    fakes.bound.push(rows);
    return {};
  },
  shutdownHarnesses: async () => void fakes.order.push("harnesses shut down"),
}));

import { createStigmerRunner } from "../runner.js";
import { DEFAULT_DRAIN_GRACE_MS } from "../config.js";
import { getShutdownSignalForQueue, getStopNowSignalForQueue } from "../shared/worker-shutdown.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the static root runs the hosted table", () => {
  it("hosts the table, boots and binds the hosted rows, and closes the proxy after the harnesses shut down", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = await createStigmerRunner({
      taskQueue: "stigmer_runner",
      stigmerEndpoint: "localhost:7234",
      temporalAddress: "127.0.0.1:7233",
      workspaceRootDir: join(tmpdir(), "stigmer-runner-hosting-test"),
    });

    expect(fakes.hostedArgs).toEqual([[{ harness: "stigmer", adapter: { name: "table" } }]]);
    expect(fakes.booted, "the hosted rows are what boots").toEqual([[{ name: "remote" }]]);
    expect(fakes.bound, "and what the activities bind").toEqual([[{ harness: "stigmer", adapter: { name: "remote" } }]]);

    const started = runner.start();
    runner.shutdown();
    await started;
    expect(fakes.order).toEqual(["harnesses shut down", "proxy closed", "connection closed"]);
  });

  it("drains once with the default grace, and a second shutdown stops the queue's turns now without draining again", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakes.workerShutdowns = 0;
    const runner = await createStigmerRunner({
      taskQueue: "stigmer_runner_twice",
      stigmerEndpoint: "localhost:7234",
      temporalAddress: "127.0.0.1:7233",
      workspaceRootDir: join(tmpdir(), "stigmer-runner-hosting-test"),
    });
    expect(fakes.drainGraces.at(-1), "the worker drains for the default grace").toBe(DEFAULT_DRAIN_GRACE_MS);

    const started = runner.start();
    runner.shutdown();
    expect(getShutdownSignalForQueue("stigmer_runner_twice")?.aborted, "the first asks every turn to yield").toBe(true);
    expect(getStopNowSignalForQueue("stigmer_runner_twice")?.aborted).toBe(false);
    runner.shutdown();
    expect(getStopNowSignalForQueue("stigmer_runner_twice")?.aborted, "the second stops them now").toBe(true);
    expect(fakes.workerShutdowns, "the worker is drained once").toBe(1);
    await started;
  });

  it("releases the hosted harnesses, the proxy and the connection when the worker's run fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fakes.order.length = 0;
    const runner = await createStigmerRunner({
      taskQueue: "stigmer_runner",
      stigmerEndpoint: "localhost:7234",
      temporalAddress: "127.0.0.1:7233",
      workspaceRootDir: join(tmpdir(), "stigmer-runner-hosting-test"),
    });
    fakes.runFails = true;
    try {
      await expect(runner.start()).rejects.toThrow("the worker died");
    } finally {
      fakes.runFails = false;
    }
    expect(fakes.order).toEqual(["harnesses shut down", "proxy closed", "connection closed"]);
  });

  it("releases the hosted harnesses and the proxy when the boot fails after hosting", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    fakes.order.length = 0;
    fakes.activitiesFail = true;
    try {
      await expect(
        createStigmerRunner({
          taskQueue: "stigmer_runner",
          stigmerEndpoint: "localhost:7234",
          workspaceRootDir: join(tmpdir(), "stigmer-runner-hosting-test"),
        }),
      ).rejects.toThrow("the activities could not be created");
    } finally {
      fakes.activitiesFail = false;
    }
    expect(fakes.order).toEqual(["harnesses shut down", "proxy closed"]);
  });

  it("starts no host, and so releases nothing, when the bootstrap fails", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    fakes.order.length = 0;
    const hostedBefore = fakes.hostedArgs.length;
    fakes.bootstrapFails = true;
    try {
      await expect(
        createStigmerRunner({
          taskQueue: "stigmer_runner",
          stigmerEndpoint: "localhost:7234",
          workspaceRootDir: join(tmpdir(), "stigmer-runner-hosting-test"),
        }),
      ).rejects.toThrow("the control plane is unreachable");
    } finally {
      fakes.bootstrapFails = false;
    }
    expect(fakes.hostedArgs.length, "no host was started").toBe(hostedBefore);
    expect(fakes.order).toEqual([]);
  });
});

describe("the static root hosts with the bootstrap's MCP bridge", () => {
  afterEach(() => {
    fakes.discoveredBridge = undefined;
    vi.unstubAllEnvs();
  });

  async function bootAndStop(): Promise<{ hosted: string | null | undefined; booted: string | null | undefined }> {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const runner = await createStigmerRunner({
      taskQueue: "stigmer_runner_bridge",
      stigmerEndpoint: "localhost:7234",
      workspaceRootDir: join(tmpdir(), "stigmer-runner-hosting-test"),
    });
    const started = runner.start();
    runner.shutdown();
    await started;
    return { hosted: fakes.hostedBridges.at(-1), booted: fakes.bootedBridges.at(-1) };
  }

  it("gives the host and the harness boot the bridge the bootstrap discovered", async () => {
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
