import { describe, it, expect, vi } from "vitest";
import { executeDoTasks } from "../do-executor.js";
import { createState } from "../state.js";
import { evaluateExpressionBatch } from "../expression.js";
import { TaskStatusAccumulator } from "../task-status-accumulator.js";
import type { TaskList, WorkflowModel, TaskExecutionContext, WorkflowEventDescriptor } from "../types.js";
import type { RecoveryContext } from "../recovery.js";

const doc: WorkflowModel = {
  document: { dsl: "1.0.0", name: "test-workflow" },
  do: [],
};

function buildCtxWithEvents(): {
  ctx: TaskExecutionContext;
  emittedEvents: WorkflowEventDescriptor[];
  accumulator: TaskStatusAccumulator;
} {
  const emittedEvents: WorkflowEventDescriptor[] = [];
  const accumulator = new TaskStatusAccumulator();

  const ctx: TaskExecutionContext = {
    evaluateExpressions: evaluateExpressionBatch,
    doc,
    sleep: async () => {},
    listen: async () => ({}),
    runCommand: async () => ({}),
    runWorkflow: async () => ({}),
    awaitHumanInput: async () => ({ outcome: "approve" }),
    callHttp: async () => ({}),
    callGrpc: async () => ({}),
    callFunction: async () => ({}),
    callAgent: async () => ({ structured: {} }),
    emitEvents: async (events) => { emittedEvents.push(...events); },
    taskStatusAccumulator: accumulator,
  };

  return { ctx, emittedEvents, accumulator };
}

function makeRecoveryContext(
  completed: Record<string, unknown>,
): RecoveryContext {
  const map = new Map<string, { output: unknown; isTruncated: boolean }>();
  for (const [name, output] of Object.entries(completed)) {
    map.set(name, { output, isTruncated: false });
  }
  return { completedTasks: map };
}

describe("executeDoTasks — recovery skip", () => {
  it("skips completed tasks and executes the remaining ones", async () => {
    const tasks: TaskList = [
      { key: "step1", task: { kind: "set", set: { a: 1 } } },
      { key: "step2", task: { kind: "set", set: { b: 2 } } },
      { key: "step3", task: { kind: "set", set: { c: 3 } } },
    ];

    const { ctx, emittedEvents } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({
      step1: { a: 1 },
      step2: { b: 2 },
    });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    const skippedEvents = emittedEvents.filter(e => e.type === "task_skipped");
    expect(skippedEvents).toHaveLength(2);
    expect((skippedEvents[0] as any).taskName).toBe("step1");
    expect((skippedEvents[0] as any).reason).toBe("completed in prior run (recovery)");
    expect((skippedEvents[1] as any).taskName).toBe("step2");

    expect(state.output).toEqual({ c: 3 });
  });

  it("restores $output chain through skipped tasks", async () => {
    const tasks: TaskList = [
      { key: "step1", task: { kind: "set", set: { val: "A" } } },
      { key: "step2", task: { kind: "set", set: { val: "B" } } },
      { key: "step3", task: { kind: "set", set: { val: "C" } } },
    ];

    const { ctx } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({
      step1: { val: "A" },
      step2: { val: "B" },
    });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    expect(state.output).toEqual({ val: "C" });
  });

  it("restores $context via export.as on skipped tasks", async () => {
    const tasks: TaskList = [
      {
        key: "fetch",
        task: {
          kind: "set",
          set: { userId: 1, title: "Hello" },
          export: { as: "${ . }" },
        },
      },
      {
        key: "use",
        task: { kind: "set", set: { consumed: true } },
      },
    ];

    const { ctx } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({
      fetch: { userId: 1, title: "Hello" },
    });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    expect(state.context).toEqual({
      fetch: { userId: 1, title: "Hello" },
    });
    expect(state.output).toEqual({ consumed: true });
  });

  it("applies output.as transform on skipped task output", async () => {
    const tasks: TaskList = [
      {
        key: "transform",
        task: {
          kind: "set",
          set: { result: "ok", extra: "ignored" },
          output: { as: "${ .result }" },
        },
      },
      { key: "after", task: { kind: "set", set: { done: true } } },
    ];

    const { ctx } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({
      transform: { result: "ok", extra: "ignored" },
    });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    expect(state.data.done).toBe(true);
  });

  it("applies export.as transform on skipped task output", async () => {
    const tasks: TaskList = [
      {
        key: "analyze",
        task: {
          kind: "set",
          set: { summary: { score: 95 }, raw: "lots of data" },
          export: { as: "${ .summary }" },
        },
      },
      { key: "after", task: { kind: "set", set: { done: true } } },
    ];

    const { ctx } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({
      analyze: { summary: { score: 95 }, raw: "lots of data" },
    });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    expect(state.context).toEqual({
      analyze: { score: 95 },
    });
  });

  it("respects flow directive from skipped switch task", async () => {
    const tasks: TaskList = [
      { key: "before", task: { kind: "set", set: { ran: true } } },
      {
        key: "decide",
        task: {
          kind: "switch",
          switch: [{ name: "always", when: "${ true }", then: "target" }],
        },
      },
      { key: "skipped_by_flow", task: { kind: "set", set: { should_not_run: true } } },
      { key: "target", task: { kind: "set", set: { reached: true } } },
    ];

    const { ctx } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({
      before: { ran: true },
      decide: { __flow_directive__: "target" },
    });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    expect(state.data.should_not_run).toBeUndefined();
    expect(state.data.reached).toBe(true);
  });

  it("respects static then directive on skipped task", async () => {
    const tasks: TaskList = [
      {
        key: "early_exit",
        task: { kind: "set", set: { a: 1 }, then: "end" },
      },
      { key: "unreachable", task: { kind: "set", set: { should_not_run: true } } },
    ];

    const { ctx } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({
      early_exit: { a: 1 },
    });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    expect(state.data.should_not_run).toBeUndefined();
    expect(state.output).toEqual({ a: 1 });
  });

  it("executes all tasks when recovery context is undefined", async () => {
    const tasks: TaskList = [
      { key: "s1", task: { kind: "set", set: { a: 1 } } },
      { key: "s2", task: { kind: "set", set: { b: 2 } } },
    ];

    const state = createState();
    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, undefined, undefined);

    expect(state.output).toEqual({ b: 2 });
  });

  it("executes all tasks when recovery context has no matching task names", async () => {
    const tasks: TaskList = [
      { key: "s1", task: { kind: "set", set: { a: 1 } } },
      { key: "s2", task: { kind: "set", set: { b: 2 } } },
    ];

    const { ctx } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({
      other_task: { x: 99 },
    });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    expect(state.output).toEqual({ b: 2 });
  });

  it("skips all tasks when all are in recovery context", async () => {
    const tasks: TaskList = [
      { key: "s1", task: { kind: "set", set: { a: 1 } } },
      { key: "s2", task: { kind: "set", set: { b: 2 } } },
    ];

    const { ctx, emittedEvents } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({
      s1: { a: 1 },
      s2: { b: 2 },
    });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    const skippedEvents = emittedEvents.filter(e => e.type === "task_skipped");
    expect(skippedEvents).toHaveLength(2);
    expect(state.output).toEqual({ b: 2 });
  });

  it("emits task_skipped events with correct taskKind", async () => {
    const tasks: TaskList = [
      { key: "vars", task: { kind: "set", set: { a: 1 } } },
    ];

    const { ctx, emittedEvents } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({ vars: { a: 1 } });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    const skipped = emittedEvents.find(e => e.type === "task_skipped") as any;
    expect(skipped).toBeDefined();
    expect(skipped.taskKind).toBe("set");
    expect(skipped.reason).toBe("completed in prior run (recovery)");
  });

  it("updates taskStatusAccumulator for skipped tasks", async () => {
    const tasks: TaskList = [
      { key: "s1", task: { kind: "set", set: { a: 1 } } },
      { key: "s2", task: { kind: "set", set: { b: 2 } } },
    ];

    const { ctx, accumulator } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({ s1: { a: 1 } });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    const entries = accumulator.toArray();
    const s1 = entries.find(e => e.taskName === "s1");
    const s2 = entries.find(e => e.taskName === "s2");
    expect(s1?.status).toBe("skipped");
    expect(s2?.status).toBe("completed");
  });

  it("does not skip tasks in nested do blocks even if names match recovery context", async () => {
    const tasks: TaskList = [
      { key: "outer", task: { kind: "set", set: { outer: true } } },
      {
        key: "nested",
        task: {
          kind: "do",
          do: [
            { key: "inner", task: { kind: "set", set: { inner: true } } },
          ],
        },
      },
    ];

    const { ctx } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({
      outer: { outer: true },
      inner: { inner: "should_not_match" },
    });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    expect(state.data.inner).toBe(true);
  });

  it("disables recovery after first non-skipped task", async () => {
    const tasks: TaskList = [
      { key: "s1", task: { kind: "set", set: { a: 1 } } },
      { key: "s2", task: { kind: "set", set: { b: 2 } } },
      { key: "s3", task: { kind: "set", set: { c: 3 } } },
    ];

    const { ctx, emittedEvents } = buildCtxWithEvents();
    const state = createState();
    const recovery = makeRecoveryContext({
      s1: { a: 1 },
      s3: { c: "old_value" },
    });

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    const skippedEvents = emittedEvents.filter(e => e.type === "task_skipped");
    expect(skippedEvents).toHaveLength(1);
    expect((skippedEvents[0] as any).taskName).toBe("s1");

    expect(state.output).toEqual({ c: 3 });
  });

  it("handles truncated output in recovery context", async () => {
    const tasks: TaskList = [
      {
        key: "big_task",
        task: { kind: "set", set: { data: "large" }, export: { as: "${ . }" } },
      },
      { key: "after", task: { kind: "set", set: { done: true } } },
    ];

    const truncatedOutput = { _truncated: true, _original_bytes: 100000, _preview: "{..." };
    const map = new Map<string, { output: unknown; isTruncated: boolean }>();
    map.set("big_task", { output: truncatedOutput, isTruncated: true });
    const recovery: RecoveryContext = { completedTasks: map };

    const { ctx } = buildCtxWithEvents();
    const state = createState();

    await executeDoTasks(tasks, null, state, doc, evaluateExpressionBatch, ctx, recovery);

    expect(state.context).toEqual({
      big_task: truncatedOutput,
    });
    expect(state.output).toEqual({ done: true });
  });
});
