import { describe, it, expect } from "vitest";
import { SetTaskBuilder } from "../../tasks/set.js";
import { WorkflowStateImpl, createState } from "../../state.js";
import { evaluateExpressionBatch } from "../../expression.js";
import type { SetTaskDef, TaskExecutionContext, WorkflowModel } from "../../types.js";

const notAvailable = () => { throw new Error("not available in test"); };

function makeCtx(): TaskExecutionContext {
  return {
    evaluateExpressions: evaluateExpressionBatch,
    doc: { document: { dsl: "1.0.0", name: "test" }, do: [] },
    sleep: notAvailable,
    listen: notAvailable,
    runCommand: notAvailable,
    runWorkflow: notAvailable,
    awaitHumanInput: notAvailable,
    callHttp: notAvailable,
    callGrpc: notAvailable,
    callFunction: notAvailable,
    callAgent: notAvailable,
  };
}

describe("SetTaskBuilder", () => {
  it("sets static values into state.data", async () => {
    const taskDef: SetTaskDef = {
      kind: "set",
      set: { workflow_started: true, message: "hello" },
    };
    const builder = new SetTaskBuilder("initialize", taskDef);
    const executor = builder.build();
    const state = createState();

    await executor(null, state, makeCtx());

    expect(state.data.workflow_started).toBe(true);
    expect(state.data.message).toBe("hello");
  });

  it("evaluates jq expressions in set object", async () => {
    const taskDef: SetTaskDef = {
      kind: "set",
      set: { computed: "${ $data.a + $data.b }", message: "Data injected" },
    };
    const builder = new SetTaskBuilder("injectData", taskDef);
    const executor = builder.build();
    const state = createState();
    state.addData({ a: 10, b: 32 });

    await executor(null, state, makeCtx());

    expect(state.data.computed).toBe(42);
    expect(state.data.message).toBe("Data injected");
  });

  it("returns the evaluated set object as output", async () => {
    const taskDef: SetTaskDef = {
      kind: "set",
      set: { status: "success", count: 42 },
    };
    const builder = new SetTaskBuilder("step", taskDef);
    const executor = builder.build();
    const state = createState();

    const output = await executor(null, state, makeCtx());

    expect(output).toEqual({ status: "success", count: 42 });
  });

  it("does not mutate the original task definition", async () => {
    const taskDef: SetTaskDef = {
      kind: "set",
      set: { value: "${ .x }" },
    };
    const builder = new SetTaskBuilder("step", taskDef);
    const executor = builder.build();
    const state = createState();
    state.addData({ x: 99 });

    await executor(null, state, makeCtx());

    expect(taskDef.set.value).toBe("${ .x }");
  });

  it("handles mixed static and expression values", async () => {
    const taskDef: SetTaskDef = {
      kind: "set",
      set: {
        staticKey: "constant",
        dynamicKey: "${ $data.name }",
        nested: { inner: "${ $data.value }" },
      },
    };
    const builder = new SetTaskBuilder("step", taskDef);
    const executor = builder.build();
    const state = createState();
    state.addData({ name: "hello", value: 42 });

    await executor(null, state, makeCtx());

    expect(state.data.staticKey).toBe("constant");
    expect(state.data.dynamicKey).toBe("hello");
    expect(state.data.nested).toEqual({ inner: 42 });
  });

  it("matches golden YAML 01 — three sequential set tasks", async () => {
    const state = createState();
    const ctx = makeCtx();

    const task1: SetTaskDef = { kind: "set", set: { workflow_started: true } };
    await new SetTaskBuilder("initialize", task1).build()(null, state, ctx);
    expect(state.data.workflow_started).toBe(true);

    const task2: SetTaskDef = {
      kind: "set",
      set: { message: "Hello, Zigflow!", status: "success", executed: true },
    };
    await new SetTaskBuilder("hello", task2).build()(null, state, ctx);
    expect(state.data.message).toBe("Hello, Zigflow!");
    expect(state.data.status).toBe("success");

    const task3: SetTaskDef = { kind: "set", set: { workflow_completed: true } };
    await new SetTaskBuilder("finalize", task3).build()(null, state, ctx);
    expect(state.data.workflow_completed).toBe(true);
  });
});
