import { describe, it, expect, vi } from "vitest";
import { executeListenTask } from "../../tasks/listen.js";
import { createState } from "../../state.js";
import type { ListenTaskDef, TaskExecutionContext, ListenExecutionConfig, ListenFn } from "../../types.js";

const notAvailable = () => { throw new Error("not available in test"); };

function makeCtx(listenFn?: (config: ListenExecutionConfig) => Promise<unknown>): TaskExecutionContext {
  return {
    evaluateExpressions: async () => ({}),
    doc: { document: { dsl: "1.0.0", name: "test" }, do: [] },
    sleep: notAvailable,
    listen: listenFn ?? (async () => undefined),
    runCommand: notAvailable,
    runWorkflow: notAvailable,
    awaitHumanInput: notAvailable,
    callHttp: notAvailable,
    callGrpc: notAvailable,
    callFunction: notAvailable,
    callAgent: notAvailable,
  };
}

describe("executeListenTask", () => {
  describe("config validation", () => {
    it("throws when 'to' is missing", async () => {
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: { to: {} as any },
      };

      await expect(
        executeListenTask(taskDef, "waitTask", createState(), makeCtx()),
      ).rejects.toThrow("at least one event must be defined");
    });

    it("throws when event filter has no 'with'", async () => {
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: { to: { one: {} } },
      };

      await expect(
        executeListenTask(taskDef, "waitTask", createState(), makeCtx()),
      ).rejects.toThrow("must have a 'with' configuration");
    });

    it("throws when event filter has no id", async () => {
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: { to: { one: { with: { type: "signal" } } } },
      };

      await expect(
        executeListenTask(taskDef, "waitTask", createState(), makeCtx()),
      ).rejects.toThrow("with.id is required");
    });

    it("throws when event filter has no type", async () => {
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: { to: { one: { with: { id: "sig1" } } } },
      };

      await expect(
        executeListenTask(taskDef, "waitTask", createState(), makeCtx()),
      ).rejects.toThrow("with.type is required");
    });

    it("throws when event type is unsupported", async () => {
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: { to: { one: { with: { id: "q1", type: "query" } } } },
      };

      await expect(
        executeListenTask(taskDef, "waitTask", createState(), makeCtx()),
      ).rejects.toThrow("'query' is not supported");
    });
  });

  describe("single event (to.one)", () => {
    it("calls ctx.listen with normalized config for to.one", async () => {
      const listenFn = vi.fn(async () => ({ approved: true }));
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: {
          to: {
            one: { with: { id: "approval_signal", type: "signal" } },
          },
        },
      };

      const state = createState();
      const result = await executeListenTask(taskDef, "waitApproval", state, makeCtx(listenFn));

      expect(listenFn).toHaveBeenCalledWith({
        events: [{ id: "approval_signal", type: "signal", acceptIf: undefined }],
        mode: "all",
        timeoutMs: 60_000,
      });
      expect(result).toEqual({ approved: true });
    });

    it("stores signal payload in state under task name", async () => {
      const listenFn = vi.fn(async () => ({ status: "approved" }));
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: {
          to: { one: { with: { id: "sig1", type: "signal" } } },
        },
      };

      const state = createState();
      await executeListenTask(taskDef, "myListener", state, makeCtx(listenFn));

      expect(state.data.myListener).toEqual({ status: "approved" });
    });

    it("does not store null/undefined results in state", async () => {
      const listenFn = vi.fn(async () => undefined);
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: {
          to: { one: { with: { id: "sig1", type: "signal" } } },
        },
      };

      const state = createState();
      state.addData({ existing: "data" });
      await executeListenTask(taskDef, "listener", state, makeCtx(listenFn));

      expect(state.data.existing).toBe("data");
      expect("listener" in state.data).toBe(false);
    });
  });

  describe("all events (to.all)", () => {
    it("normalizes to.all with mode 'all'", async () => {
      const listenFn = vi.fn(async () => ({ sig1: "a", sig2: "b" }));
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: {
          to: {
            all: [
              { with: { id: "sig1", type: "signal" } },
              { with: { id: "sig2", type: "signal" } },
            ],
          },
        },
      };

      const state = createState();
      await executeListenTask(taskDef, "waitAll", state, makeCtx(listenFn));

      expect(listenFn).toHaveBeenCalledWith({
        events: [
          { id: "sig1", type: "signal", acceptIf: undefined },
          { id: "sig2", type: "signal", acceptIf: undefined },
        ],
        mode: "all",
        timeoutMs: 60_000,
      });
    });
  });

  describe("any event (to.any)", () => {
    it("normalizes to.any with mode 'any'", async () => {
      const listenFn = vi.fn(async () => ({ __event_id__: "sig2", payload: "first" }));
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: {
          to: {
            any: [
              { with: { id: "sig1", type: "signal" } },
              { with: { id: "sig2", type: "signal" } },
            ],
          },
        },
      };

      const state = createState();
      const result = await executeListenTask(taskDef, "waitAny", state, makeCtx(listenFn));

      expect(listenFn).toHaveBeenCalledWith({
        events: [
          { id: "sig1", type: "signal", acceptIf: undefined },
          { id: "sig2", type: "signal", acceptIf: undefined },
        ],
        mode: "any",
        timeoutMs: 60_000,
      });
      expect(result).toEqual({ __event_id__: "sig2", payload: "first" });
    });
  });

  describe("acceptIf", () => {
    it("passes acceptIf expression through to the config", async () => {
      let capturedConfig: ListenExecutionConfig | undefined;
      const listenFn: ListenFn = async (config) => {
        capturedConfig = config;
        return { accepted: true };
      };
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: {
          to: {
            one: { with: { id: "sig1", type: "signal", acceptIf: "${ .status == \"approved\" }" } },
          },
        },
      };

      const state = createState();
      await executeListenTask(taskDef, "conditional", state, makeCtx(listenFn));

      expect(capturedConfig!.events[0].acceptIf).toBe("${ .status == \"approved\" }");
    });
  });

  describe("timeout configuration", () => {
    it("uses default 60s timeout when metadata not set", async () => {
      let capturedConfig: ListenExecutionConfig | undefined;
      const listenFn: ListenFn = async (config) => { capturedConfig = config; return null; };
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: {
          to: { one: { with: { id: "sig1", type: "signal" } } },
        },
      };

      await executeListenTask(taskDef, "t", createState(), makeCtx(listenFn));

      expect(capturedConfig!.timeoutMs).toBe(60_000);
    });

    it("parses timeout from metadata (seconds string)", async () => {
      let capturedConfig: ListenExecutionConfig | undefined;
      const listenFn: ListenFn = async (config) => { capturedConfig = config; return null; };
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: {
          to: { one: { with: { id: "sig1", type: "signal" } } },
        } as any,
        metadata: undefined,
      };
      (taskDef.listen as any).metadata = { timeout: "30s" };

      await executeListenTask(taskDef, "t", createState(), makeCtx(listenFn));

      expect(capturedConfig!.timeoutMs).toBe(30_000);
    });

    it("parses timeout from metadata (minutes string)", async () => {
      let capturedConfig: ListenExecutionConfig | undefined;
      const listenFn: ListenFn = async (config) => { capturedConfig = config; return null; };
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: {
          to: { one: { with: { id: "sig1", type: "signal" } } },
        } as any,
      };
      (taskDef.listen as any).metadata = { timeout: "5m" };

      await executeListenTask(taskDef, "t", createState(), makeCtx(listenFn));

      expect(capturedConfig!.timeoutMs).toBe(300_000);
    });

    it("parses timeout from metadata (numeric seconds)", async () => {
      let capturedConfig: ListenExecutionConfig | undefined;
      const listenFn: ListenFn = async (config) => { capturedConfig = config; return null; };
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: {
          to: { one: { with: { id: "sig1", type: "signal" } } },
        } as any,
      };
      (taskDef.listen as any).metadata = { timeout: 120 };

      await executeListenTask(taskDef, "t", createState(), makeCtx(listenFn));

      expect(capturedConfig!.timeoutMs).toBe(120_000);
    });
  });

  describe("error propagation", () => {
    it("propagates timeout errors from ctx.listen", async () => {
      const listenFn = vi.fn(async () => {
        throw new Error("timed out");
      });
      const taskDef: ListenTaskDef = {
        kind: "listen",
        listen: {
          to: { one: { with: { id: "sig1", type: "signal" } } },
        },
      };

      await expect(
        executeListenTask(taskDef, "t", createState(), makeCtx(listenFn)),
      ).rejects.toThrow("timed out");
    });
  });
});
