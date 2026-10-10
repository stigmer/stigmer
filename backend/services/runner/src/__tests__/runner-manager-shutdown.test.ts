/**
 * Pins the manager's full shutdown (runner-manager.ts, `shutdown`): every
 * queue's worker-shutdown signal is aborted BEFORE any worker drains, so an
 * activity the drain cancels classifies itself as a worker shutdown and
 * persists RUN_FAILED with the shutdown copy, never the orchestrator stop a
 * user's pause is (#776). Then every worker (session, pool control) drains,
 * the harnesses release what they hold, and the Temporal connection closes.
 * A manager whose boot fails once the agent host is up releases the
 * harnesses before the error reaches its caller.
 *
 * Temporal, the control-plane bootstrap, the harness registry and the LLM
 * preflight are replaced at their module seams, so the manager's own
 * bookkeeping runs in-process without a server or a worker.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

/** One fake worker per queue: `run()` settles when `shutdown()` is called, as the SDK's drain does. */
interface FakeWorker {
  readonly taskQueue: string;
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
    create: async ({ taskQueue }: { taskQueue: string }) => {
      let release: () => void = () => {};
      const drained = new Promise<void>((resolve) => {
        release = resolve;
      });
      const worker: FakeWorker = {
        taskQueue,
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

vi.mock("../harness/registry.js", () => ({
  adaptersOf: () => [],
  bootHarnesses: async () => {},
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
    const warned = vi.mocked(console.warn);
    await manager.addPoolControl("member_1");
    // The idle pool member asks its agent host to warm the Cursor SDK; this
    // table boots no Cursor harness, so the answer is that there is none.
    await vi.waitFor(() =>
      expect(warned.mock.calls.map((c) => String(c[0]))).toContain(
        "[pool-member] Cursor SDK warm-up skipped (non-fatal): the Cursor harness is not booted (0ms)",
      ),
    );
    expect(fakes.workers.map((w) => w.taskQueue)).toEqual([
      "session:ses_1",
      "sandbox:member_1",
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
    await expect(manager.addSession("ses_2")).rejects.toThrow(
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
