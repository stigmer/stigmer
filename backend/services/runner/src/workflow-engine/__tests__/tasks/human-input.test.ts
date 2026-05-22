import { describe, it, expect, vi } from "vitest";
import { executeHumanInputTask } from "../../tasks/human-input.js";
import { createState } from "../../state.js";
import type {
  HumanInputTaskDef,
  TaskExecutionContext,
  HumanInputExecutionConfig,
  HumanInputResult,
  AwaitHumanInputFn,
  EmitEventsFn,
  WorkflowEventDescriptor,
} from "../../types.js";

const notAvailable = () => { throw new Error("not available in test"); };

function makeCtx(awaitFn?: AwaitHumanInputFn, emitFn?: EmitEventsFn): TaskExecutionContext {
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
    emitEvents: emitFn,
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

  describe("event emission", () => {
    it("emits approval_requested before blocking with correct fields", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };
      const awaitFn: AwaitHumanInputFn = async () => ({ outcome: "approve", reviewer: "alice" });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: {
          prompt: "Please review the deployment",
          approvers: ["alice", "bob"],
          timeout: 300,
          outcomes: [
            { name: "approve", label: "Approve Plan" },
            { name: "reject", label: "Reject" },
          ],
          formSchema: { type: "object", properties: { feedback: { type: "string" } } },
        },
      };

      await executeHumanInputTask(taskDef, "reviewGate", createState(), makeCtx(awaitFn, emitFn));

      expect(emitted.length).toBeGreaterThanOrEqual(1);
      const requestedBatch = emitted[0];
      expect(requestedBatch).toHaveLength(1);

      const requested = requestedBatch[0];
      expect(requested.type).toBe("approval_requested");
      if (requested.type !== "approval_requested") throw new Error("unexpected");

      expect(requested.taskName).toBe("reviewGate");
      expect(requested.prompt).toBe("Please review the deployment");
      expect(requested.approvers).toEqual(["alice", "bob"]);
      expect(requested.timeoutSeconds).toBe(300);
      expect(requested.outcomes).toEqual([
        { name: "approve", label: "Approve Plan" },
        { name: "reject", label: "Reject" },
      ]);
      expect(requested.formSchema).toEqual({
        type: "object",
        properties: { feedback: { type: "string" } },
      });
    });

    it("emits approval_resolved after signal with correct fields", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "reject",
        reviewer: "carol",
        auto_resolved: false,
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Confirm?" },
      };

      await executeHumanInputTask(taskDef, "gate", createState(), makeCtx(awaitFn, emitFn));

      expect(emitted).toHaveLength(2);
      const resolvedBatch = emitted[1];
      expect(resolvedBatch).toHaveLength(1);

      const resolved = resolvedBatch[0];
      expect(resolved.type).toBe("approval_resolved");
      if (resolved.type !== "approval_resolved") throw new Error("unexpected");

      expect(resolved.taskName).toBe("gate");
      expect(resolved.outcome).toBe("reject");
      expect(resolved.resolvedBy).toBe("carol");
      expect(resolved.autoResolved).toBe(false);
      expect(resolved.waitDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("does not error when emitEvents is undefined (backward compat)", async () => {
      const awaitFn: AwaitHumanInputFn = async () => ({ outcome: "approve" });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review" },
      };

      const ctx = makeCtx(awaitFn, undefined);
      const result = await executeHumanInputTask(taskDef, "t", createState(), ctx);

      expect(result).toEqual({ outcome: "approve" });
    });

    it("maps outcomes correctly with and without labels", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };
      const awaitFn: AwaitHumanInputFn = async () => ({ outcome: "approve" });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: {
          prompt: "Review",
          outcomes: [
            { name: "approve", label: "Approve Plan" },
            { name: "monitor" },
          ],
        },
      };

      await executeHumanInputTask(taskDef, "t", createState(), makeCtx(awaitFn, emitFn));

      const requested = emitted[0][0];
      if (requested.type !== "approval_requested") throw new Error("unexpected");

      expect(requested.outcomes).toEqual([
        { name: "approve", label: "Approve Plan" },
        { name: "monitor", label: "" },
      ]);
    });

    it("includes formSchema in approval_requested when provided", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };
      const awaitFn: AwaitHumanInputFn = async () => ({ outcome: "approve" });

      const schema = {
        type: "object",
        properties: {
          budget_override: { type: "number", description: "New budget amount" },
          justification: { type: "string", description: "Reason for change" },
        },
      };

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Approve budget?", formSchema: schema },
      };

      await executeHumanInputTask(taskDef, "budgetGate", createState(), makeCtx(awaitFn, emitFn));

      const requested = emitted[0][0];
      if (requested.type !== "approval_requested") throw new Error("unexpected");

      expect(requested.formSchema).toEqual(schema);
    });

    it("defaults approvers and outcomes when not configured", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };
      const awaitFn: AwaitHumanInputFn = async () => ({ outcome: "approve" });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Simple gate" },
      };

      await executeHumanInputTask(taskDef, "simple", createState(), makeCtx(awaitFn, emitFn));

      const requested = emitted[0][0];
      if (requested.type !== "approval_requested") throw new Error("unexpected");

      expect(requested.approvers).toEqual([]);
      expect(requested.outcomes).toEqual([]);
      expect(requested.formSchema).toBeUndefined();
    });

    it("emits approval_resolved with autoResolved true on timeout auto-approve", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "approve",
        auto_resolved: true,
        reason: "timeout",
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 5, onTimeout: "approve" },
      };

      await executeHumanInputTask(taskDef, "autoGate", createState(), makeCtx(awaitFn, emitFn));

      const resolved = emitted[1][0];
      if (resolved.type !== "approval_resolved") throw new Error("unexpected");

      expect(resolved.autoResolved).toBe(true);
      expect(resolved.outcome).toBe("approve");
    });
  });
});
