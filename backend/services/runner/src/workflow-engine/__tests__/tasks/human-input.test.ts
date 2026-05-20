import { describe, it, expect, vi } from "vitest";
import { executeHumanInputTask } from "../../tasks/human-input.js";
import { createState } from "../../state.js";
import type {
  HumanInputTaskDef,
  TaskExecutionContext,
  HumanInputExecutionConfig,
  HumanInputResult,
  AwaitHumanInputFn,
} from "../../types.js";

const notAvailable = () => { throw new Error("not available in test"); };

function makeCtx(awaitFn?: AwaitHumanInputFn): TaskExecutionContext {
  return {
    evaluateExpressions: async () => ({}),
    doc: { document: { dsl: "1.0.0", name: "test" }, do: [] },
    sleep: notAvailable,
    listen: notAvailable,
    runCommand: notAvailable,
    runWorkflow: notAvailable,
    awaitHumanInput: awaitFn ?? (async () => ({ outcome: "approve" })),
    callHttp: notAvailable,
    callGrpc: notAvailable,
    callFunction: notAvailable,
    callAgent: notAvailable,
  };
}

describe("executeHumanInputTask", () => {
  describe("config validation", () => {
    it("throws when prompt is missing", async () => {
      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "" },
      };

      await expect(
        executeHumanInputTask(taskDef, "approve", createState(), makeCtx()),
      ).rejects.toThrow("'prompt' is required");
    });
  });

  describe("signal handling", () => {
    it("calls ctx.awaitHumanInput with correct signal name", async () => {
      let capturedConfig: HumanInputExecutionConfig | undefined;
      const awaitFn: AwaitHumanInputFn = async (config) => {
        capturedConfig = config;
        return { outcome: "approve", reviewer: "alice" };
      };

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Please review" },
      };

      await executeHumanInputTask(taskDef, "reviewGate", createState(), makeCtx(awaitFn));

      expect(capturedConfig!.signalName).toBe("human_input_reviewGate");
    });

    it("returns the human input result", async () => {
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "approve",
        reviewer: "bob@example.com",
        responded_at: "2026-05-20T10:00:00Z",
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Approve deployment?" },
      };

      const result = await executeHumanInputTask(
        taskDef, "deploy", createState(), makeCtx(awaitFn),
      );

      expect(result).toEqual({
        outcome: "approve",
        reviewer: "bob@example.com",
        responded_at: "2026-05-20T10:00:00Z",
      });
    });

    it("stores result in state under task name", async () => {
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "deny",
        reviewer: "carol",
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Confirm?" },
      };

      const state = createState();
      await executeHumanInputTask(taskDef, "confirmation", state, makeCtx(awaitFn));

      expect(state.data.confirmation).toEqual({ outcome: "deny", reviewer: "carol" });
    });
  });

  describe("timeout configuration", () => {
    it("passes timeout from config", async () => {
      let capturedConfig: HumanInputExecutionConfig | undefined;
      const awaitFn: AwaitHumanInputFn = async (config) => {
        capturedConfig = config;
        return { outcome: "approve" };
      };

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 300 },
      };

      await executeHumanInputTask(taskDef, "t", createState(), makeCtx(awaitFn));

      expect(capturedConfig!.timeoutSeconds).toBe(300);
    });

    it("defaults timeout to 0 (infinite) when not set", async () => {
      let capturedConfig: HumanInputExecutionConfig | undefined;
      const awaitFn: AwaitHumanInputFn = async (config) => {
        capturedConfig = config;
        return { outcome: "approve" };
      };

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review" },
      };

      await executeHumanInputTask(taskDef, "t", createState(), makeCtx(awaitFn));

      expect(capturedConfig!.timeoutSeconds).toBe(0);
    });

    it("passes onTimeout policy from config", async () => {
      let capturedConfig: HumanInputExecutionConfig | undefined;
      const awaitFn: AwaitHumanInputFn = async (config) => {
        capturedConfig = config;
        return { outcome: "approve", auto_resolved: true, reason: "timeout" };
      };

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 60, onTimeout: "approve" },
      };

      await executeHumanInputTask(taskDef, "t", createState(), makeCtx(awaitFn));

      expect(capturedConfig!.onTimeout).toBe("approve");
    });

    it("defaults onTimeout to 'fail' when not set", async () => {
      let capturedConfig: HumanInputExecutionConfig | undefined;
      const awaitFn: AwaitHumanInputFn = async (config) => {
        capturedConfig = config;
        return { outcome: "approve" };
      };

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 60 },
      };

      await executeHumanInputTask(taskDef, "t", createState(), makeCtx(awaitFn));

      expect(capturedConfig!.onTimeout).toBe("fail");
    });
  });

  describe("error propagation", () => {
    it("propagates timeout failure errors from orchestrator", async () => {
      const awaitFn: AwaitHumanInputFn = async () => {
        throw new Error("human_input task timed out");
      };

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 10, onTimeout: "fail" },
      };

      await expect(
        executeHumanInputTask(taskDef, "t", createState(), makeCtx(awaitFn)),
      ).rejects.toThrow("timed out");
    });
  });

  describe("auto-resolved results", () => {
    it("handles auto-approve timeout result", async () => {
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "approve",
        auto_resolved: true,
        reason: "timeout",
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 5, onTimeout: "approve" },
      };

      const state = createState();
      const result = await executeHumanInputTask(taskDef, "gate", state, makeCtx(awaitFn));

      expect(result).toEqual({ outcome: "approve", auto_resolved: true, reason: "timeout" });
      expect(state.data.gate).toEqual({ outcome: "approve", auto_resolved: true, reason: "timeout" });
    });

    it("handles auto-deny timeout result", async () => {
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "deny",
        auto_resolved: true,
        reason: "timeout",
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 5, onTimeout: "deny" },
      };

      const result = await executeHumanInputTask(taskDef, "gate", createState(), makeCtx(awaitFn));

      expect(result).toEqual({ outcome: "deny", auto_resolved: true, reason: "timeout" });
    });
  });
});
