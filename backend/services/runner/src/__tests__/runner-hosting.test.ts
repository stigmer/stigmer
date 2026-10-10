/**
 * The static root (`runner.ts`, `createStigmerRunner`) runs the hosted
 * table: it hosts the harness table before it boots it, boots the rows the
 * hosting returned (the hosted harnesses' remote adapters among them),
 * binds the activities over those same rows, and after the worker drains
 * releases the harnesses and then closes the local proxy; a boot that fails
 * once the host is up releases them the same way and rethrows.
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
  booted: [] as unknown[],
  bound: [] as unknown[],
  release: () => {},
  bootstrapFails: false,
}));

vi.mock("../worker.js", () => ({
  startWorker: async () => {
    const drained = new Promise<void>((resolve) => {
      fakes.release = resolve;
    });
    return {
      worker: { run: () => drained, shutdown: () => fakes.release() },
      connection: { close: async () => void fakes.order.push("connection closed") },
    };
  },
}));

vi.mock("../bootstrap.js", () => ({
  resolveRunnerBootstrap: async () => {
    if (fakes.bootstrapFails) throw new Error("the control plane is unreachable");
    return { temporalAddress: "127.0.0.1:7233", temporalNamespace: "default" };
  },
  refreshRunnerAccessToken: async () => null,
}));

vi.mock("../preflight.js", () => ({ assertLlmBackendsPreflight: () => {} }));

vi.mock("../harness-adapters.js", () => ({ HARNESS_ADAPTERS: [{ harness: "deep-agent", adapter: { name: "table" } }] }));

vi.mock("../agent-host/hosting.js", () => ({
  hostHarnesses: async (rows: unknown) => {
    fakes.hostedArgs.push(rows);
    return {
      rows: [{ harness: "deep-agent", adapter: { name: "remote" } }],
      close: async () => void fakes.order.push("proxy closed"),
    };
  },
}));

vi.mock("../harness/registry.js", () => ({
  adaptersOf: (rows: readonly { adapter: unknown }[]) => rows.map((r) => r.adapter),
  bootHarnesses: async (adapters: unknown) => void fakes.booted.push(adapters),
  createHarnessActivities: async (rows: unknown) => {
    fakes.bound.push(rows);
    return {};
  },
  shutdownHarnesses: async () => void fakes.order.push("harnesses shut down"),
}));

import { createStigmerRunner } from "../runner.js";

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

    expect(fakes.hostedArgs).toEqual([[{ harness: "deep-agent", adapter: { name: "table" } }]]);
    expect(fakes.booted, "the hosted rows are what boots").toEqual([[{ name: "remote" }]]);
    expect(fakes.bound, "and what the activities bind").toEqual([[{ harness: "deep-agent", adapter: { name: "remote" } }]]);

    const started = runner.start();
    runner.shutdown();
    await started;
    expect(fakes.order).toEqual(["harnesses shut down", "proxy closed", "connection closed"]);
  });

  it("releases the hosted harnesses and the proxy when the boot fails after hosting", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    fakes.order.length = 0;
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
    expect(fakes.order).toEqual(["harnesses shut down", "proxy closed"]);
  });
});
