import { describe, it, expect, vi } from "vitest";
import { executeHumanInputTask } from "../../tasks/human-input.js";
import { createState } from "../../state.js";
import { evaluateExpressionBatch } from "../../expression.js";
import { TaskStatusAccumulator } from "../../task-status-accumulator.js";
import type {
  HumanInputTaskDef,
  TaskExecutionContext,
  HumanInputExecutionConfig,
  HumanInputResult,
  AwaitHumanInputFn,
  EmitEventsFn,
  ExpressionEvaluator,
  PromoteTaskOutputFn,
  WorkflowEventDescriptor,
} from "../../types.js";

const notAvailable = () => { throw new Error("not available in test"); };

interface CtxOptions {
  readonly awaitFn?: AwaitHumanInputFn;
  readonly emitFn?: EmitEventsFn;
  readonly evaluateExpressions?: ExpressionEvaluator;
  readonly promoteTaskOutput?: PromoteTaskOutputFn;
  readonly taskStatusAccumulator?: TaskStatusAccumulator;
}

function makeCtx(
  awaitFn?: AwaitHumanInputFn,
  emitFn?: EmitEventsFn,
  options?: CtxOptions,
): TaskExecutionContext {
  return {
    evaluateExpressions: options?.evaluateExpressions ?? (async () => ({})),
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
    promoteTaskOutput: options?.promoteTaskOutput,
    taskStatusAccumulator: options?.taskStatusAccumulator,
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

  // HumanInputTaskConfig.outcomes contract (human_input.proto): with custom
  // outcomes, timeout auto-approve resolves to the FIRST outcome and timeout
  // auto-deny to the LAST — downstream `then` routing and outcome switches
  // must see declared outcome names, never the internal approve/deny words a
  // reviewer was never offered. stigmer/stigmer#779 made this path reachable
  // for the first time.
  describe("timeout outcome mapping with custom outcomes", () => {
    const outcomes = [
      { name: "proceed", label: "Proceed", then: "deployStep" },
      { name: "needs_revision", label: "Needs revision", then: "gatherMore" },
      { name: "reject", label: "Reject" },
    ];

    it("maps timeout auto-approve to the FIRST outcome and routes its then", async () => {
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "approve",
        auto_resolved: true,
        reason: "timeout",
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 5, onTimeout: "approve", outcomes },
      };

      const state = createState();
      const result = await executeHumanInputTask(taskDef, "gate", state, makeCtx(awaitFn));

      expect(result).toEqual({
        outcome: "proceed",
        auto_resolved: true,
        reason: "timeout",
        __flow_directive__: "deployStep",
      });
      expect(state.data.gate).toEqual({
        outcome: "proceed",
        auto_resolved: true,
        reason: "timeout",
      });
    });

    it("maps timeout auto-deny to the LAST outcome", async () => {
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "deny",
        auto_resolved: true,
        reason: "timeout",
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 5, onTimeout: "deny", outcomes },
      };

      const result = await executeHumanInputTask(taskDef, "gate", createState(), makeCtx(awaitFn));

      // "reject" is the last outcome and declares no `then` — no directive.
      expect(result).toEqual({ outcome: "reject", auto_resolved: true, reason: "timeout" });
    });

    it("reports the mapped outcome on the approval_resolved event", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "approve",
        auto_resolved: true,
        reason: "timeout",
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 5, onTimeout: "approve", outcomes },
      };

      await executeHumanInputTask(taskDef, "gate", createState(), makeCtx(awaitFn, emitFn));

      const resolved = emitted.flat().find((e) => e.type === "approval_resolved");
      expect(resolved).toMatchObject({ outcome: "proceed", autoResolved: true });
    });

    it("leaves reviewer-selected outcomes untouched", async () => {
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "needs_revision",
        reviewer: "alice",
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 5, onTimeout: "approve", outcomes },
      };

      const result = await executeHumanInputTask(taskDef, "gate", createState(), makeCtx(awaitFn));

      expect(result).toEqual({
        outcome: "needs_revision",
        reviewer: "alice",
        __flow_directive__: "gatherMore",
      });
    });

    it("keeps plain approve/deny for binary gates without custom outcomes", async () => {
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "approve",
        auto_resolved: true,
        reason: "timeout",
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Review", timeout: 5, onTimeout: "approve" },
      };

      const result = await executeHumanInputTask(taskDef, "gate", createState(), makeCtx(awaitFn));

      expect(result).toEqual({ outcome: "approve", auto_resolved: true, reason: "timeout" });
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
      expect(resolved.resolvedByActor).toBeUndefined();
      expect(resolved.autoResolved).toBe(false);
      expect(resolved.waitDurationMs).toBeGreaterThanOrEqual(0);
    });

    it("carries the reviewer_actor display snapshot into approval_resolved and the task output", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };
      const reviewerActor = {
        id: "ida_01abc",
        display_name: "Ada Lovelace",
        email: "ada@example.com",
        avatar: "https://example.com/ada.png",
      };
      const awaitFn: AwaitHumanInputFn = async () => ({
        outcome: "approve",
        reviewer: "ida_01abc",
        reviewer_actor: reviewerActor,
        responded_at: "2026-05-20T10:00:00Z",
      });

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Confirm?" },
      };

      const state = createState();
      await executeHumanInputTask(taskDef, "gate", state, makeCtx(awaitFn, emitFn));

      const resolved = emitted[1][0];
      if (resolved.type !== "approval_resolved") throw new Error("unexpected");
      expect(resolved.resolvedBy).toBe("ida_01abc");
      expect(resolved.resolvedByActor).toEqual(reviewerActor);

      // The whole signal payload IS the task output — the actor lands there
      // for downstream tasks (e.g. notification templates) without copying.
      expect(state.data.gate).toEqual({
        outcome: "approve",
        reviewer: "ida_01abc",
        reviewer_actor: reviewerActor,
        responded_at: "2026-05-20T10:00:00Z",
      });
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

  describe("review payload", () => {
    const awaitApprove: AwaitHumanInputFn = async () => ({ outcome: "approve" });

    function gateWith(payload: unknown, uiHint?: string): HumanInputTaskDef {
      return {
        kind: "human_input",
        humanInput: { prompt: "Review the material", payload, uiHint },
      };
    }

    /** Captures emitted batches and returns the approval_requested event. */
    function captureRequested(emitted: WorkflowEventDescriptor[][]) {
      const requested = emitted[0].find((e) => e.type === "approval_requested");
      if (!requested || requested.type !== "approval_requested") {
        throw new Error("approval_requested not emitted");
      }
      return requested;
    }

    it("resolves a whole-value expression payload against workflow state", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };

      const state = createState();
      state.context = { draft: { title: "Q3 plan", items: [1, 2, 3] } };

      await executeHumanInputTask(
        gateWith("${ $context.draft }", "plan-review"),
        "gate", state,
        makeCtx(awaitApprove, emitFn, { evaluateExpressions: evaluateExpressionBatch }),
      );

      const requested = captureRequested(emitted);
      expect(requested.payload).toEqual({ title: "Q3 plan", items: [1, 2, 3] });
      expect(requested.uiHint).toBe("plan-review");
      expect(requested.payloadArtifactId).toBeUndefined();
    });

    it("records the uiHint on the task status entry so listPendingApprovals can badge by review type", async () => {
      const accumulator = new TaskStatusAccumulator();
      accumulator.taskStarted("gate", "human_input");

      await executeHumanInputTask(
        gateWith({ text: "inline" }, "plan-review"),
        "gate", createState(),
        makeCtx(awaitApprove, undefined, {
          evaluateExpressions: evaluateExpressionBatch,
          taskStatusAccumulator: accumulator,
        }),
      );

      const entry = accumulator.toArray().find((e) => e.taskName === "gate");
      expect(entry?.uiHint).toBe("plan-review");
    });

    it("resolves embedded expressions inside an inline object payload", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };

      const state = createState();
      state.context = { triage: { severity: "P1" } };

      await executeHumanInputTask(
        gateWith({ summary: "Severity: ${ $context.triage.severity }", static: true }),
        "gate", state,
        makeCtx(awaitApprove, emitFn, { evaluateExpressions: evaluateExpressionBatch }),
      );

      const requested = captureRequested(emitted);
      expect(requested.payload).toEqual({ summary: "Severity: P1", static: true });
      expect(requested.uiHint).toBeUndefined();
    });

    it("does not re-evaluate literal ${ } text inside resolved payload data (injection safety)", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };

      // External data (e.g. a webhook body) containing literal expression
      // syntax must survive resolution verbatim.
      const state = createState();
      state.context = { article: { body: "Use ${ .secrets.KEY } to authenticate" } };

      await executeHumanInputTask(
        gateWith("${ $context.article }"),
        "gate", state,
        makeCtx(awaitApprove, emitFn, { evaluateExpressions: evaluateExpressionBatch }),
      );

      const requested = captureRequested(emitted);
      expect(requested.payload).toEqual({ body: "Use ${ .secrets.KEY } to authenticate" });
    });

    it("fails the task when payload resolution errors", async () => {
      const failingEvaluator: ExpressionEvaluator = async () => {
        throw new Error("jq: compile error");
      };

      await expect(
        executeHumanInputTask(
          gateWith("${ $context.draft | invalid_filter }"),
          "gate", createState(),
          makeCtx(awaitApprove, undefined, { evaluateExpressions: failingEvaluator }),
        ),
      ).rejects.toThrow("failed to resolve 'payload' expressions");
    });

    it("fails the task when payload resolves to null (missing context path)", async () => {
      await expect(
        executeHumanInputTask(
          gateWith("${ $context.does_not_exist }"),
          "gate", createState(),
          makeCtx(awaitApprove, undefined, { evaluateExpressions: evaluateExpressionBatch }),
        ),
      ).rejects.toThrow("'payload' resolved to null");
    });

    it("promotes the payload and emits an artifact reference instead of inline data", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };

      const promoteFn: PromoteTaskOutputFn = vi.fn(async () => ({
        output: { _artifact_ref: "art_review123" },
        artifactIds: ["art_review123"],
        artifactCreatedEvents: [{
          type: "artifact_created" as const,
          artifactId: "art_review123",
          displayName: "gate — review-payload.json",
          contentType: "application/json",
          sizeBytes: 300_000,
          occurredAt: new Date().toISOString(),
        }],
      }));

      const state = createState();
      state.context = { proposal: { records: ["huge"] } };

      await executeHumanInputTask(
        gateWith("${ $context.proposal }", "infra-proposal"),
        "gate", state,
        makeCtx(awaitApprove, emitFn, {
          evaluateExpressions: evaluateExpressionBatch,
          promoteTaskOutput: promoteFn,
        }),
      );

      expect(promoteFn).toHaveBeenCalledWith(
        { records: ["huge"] }, "", "gate", "gate — review-payload.json",
      );

      const requested = captureRequested(emitted);
      expect(requested.payload).toBeUndefined();
      expect(requested.payloadArtifactId).toBe("art_review123");
      expect(requested.uiHint).toBe("infra-proposal");

      const artifactEvent = emitted[0].find((e) => e.type === "artifact_created");
      expect(artifactEvent).toBeDefined();
      if (artifactEvent?.type !== "artifact_created") throw new Error("unexpected");
      expect(artifactEvent.artifactId).toBe("art_review123");
    });

    it("delivers inline when the promotion activity returns no artifacts (below threshold)", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };

      const promoteFn: PromoteTaskOutputFn = async (taskOutput) => ({
        output: taskOutput, artifactIds: [], artifactCreatedEvents: [],
      });

      const state = createState();
      state.context = { note: "small" };

      await executeHumanInputTask(
        gateWith("${ $context.note }"),
        "gate", state,
        makeCtx(awaitApprove, emitFn, {
          evaluateExpressions: evaluateExpressionBatch,
          promoteTaskOutput: promoteFn,
        }),
      );

      const requested = captureRequested(emitted);
      expect(requested.payload).toBe("small");
      expect(requested.payloadArtifactId).toBeUndefined();
    });

    it("falls back to inline delivery when promotion fails (best-effort policy)", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };

      const promoteFn: PromoteTaskOutputFn = async () => {
        throw new Error("artifact store unavailable");
      };

      const state = createState();
      state.context = { doc: { text: "content" } };

      await executeHumanInputTask(
        gateWith("${ $context.doc }"),
        "gate", state,
        makeCtx(awaitApprove, emitFn, {
          evaluateExpressions: evaluateExpressionBatch,
          promoteTaskOutput: promoteFn,
        }),
      );

      const requested = captureRequested(emitted);
      expect(requested.payload).toEqual({ text: "content" });
      expect(requested.payloadArtifactId).toBeUndefined();
    });

    it("omits payload fields entirely when the task config has no payload", async () => {
      const emitted: WorkflowEventDescriptor[][] = [];
      const emitFn: EmitEventsFn = async (events) => { emitted.push(events); };

      const taskDef: HumanInputTaskDef = {
        kind: "human_input",
        humanInput: { prompt: "Simple gate" },
      };

      await executeHumanInputTask(taskDef, "gate", createState(), makeCtx(awaitApprove, emitFn));

      const requested = captureRequested(emitted);
      expect(requested.payload).toBeUndefined();
      expect(requested.uiHint).toBeUndefined();
      expect(requested.payloadArtifactId).toBeUndefined();
    });
  });
});
