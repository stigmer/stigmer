/**
 * Pins the manager's full shutdown (runner-manager.ts, `shutdown`): every
 * queue's worker-shutdown signal is aborted BEFORE any worker drains, so an
 * activity the drain cancels classifies itself as a worker shutdown and
 * persists RUN_FAILED with the shutdown copy, never the orchestrator stop a
 * user's pause is (#776). Then every worker (session, workflow run, pool
 * control) drains, the harnesses release what they hold, and the Temporal
 * connection closes.
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
  signalOf: undefined as
    | ((taskQueue: string) => AbortSignal | undefined)
    | undefined,
}));

vi.mock("@temporalio/worker", () => ({
  NativeConnection: {
    connect: async () => ({
      close: () => {
        fakes.connectionClose.calls++;
      },
    }),
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
  releaseHarnessSession: async () => {},
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
    await manager.addWorkflowExecution("wex_1");
    await manager.addPoolControl("member_1");
    expect(fakes.workers.map((w) => w.taskQueue)).toEqual([
      "session:ses_1",
      "wfexec:wex_1",
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
    expect(manager.activeWorkflowExecutions()).toEqual([]);
    await expect(manager.addSession("ses_2")).rejects.toThrow(
      "RunnerManager is shutting down",
    );
  });
});
