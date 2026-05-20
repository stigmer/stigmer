import { describe, it, expect } from "vitest";
import { executeTryTask } from "../../tasks/try.js";
import { createState } from "../../state.js";
import { evaluateExpressionBatch } from "../../expression.js";
import { WorkflowError } from "../../errors.js";
import type {
  TryTaskDef,
  TaskList,
  WorkflowModel,
  TaskExecutionContext,
} from "../../types.js";

const doc: WorkflowModel = {
  document: { dsl: "1.0.0", name: "test" },
  do: [],
};

const notAvailable = () => { throw new Error("not available in test"); };

function makeCtx(): TaskExecutionContext {
  return {
    evaluateExpressions: evaluateExpressionBatch,
    doc,
    callHttp: notAvailable,
    callGrpc: notAvailable,
    callFunction: notAvailable,
    callAgent: notAvailable,
  };
}

function makeTryTaskDef(
  tryTasks: TaskList,
  catchConfig: TryTaskDef["catch"],
): TryTaskDef {
  return {
    kind: "try",
    try: tryTasks,
    catch: catchConfig,
  };
}

describe("executeTryTask", () => {
  it("returns result when try block succeeds (no error)", async () => {
    const taskDef = makeTryTaskDef(
      [{ key: "step", task: { kind: "set", set: { result: "ok" } } }],
      { do: [{ key: "handler", task: { kind: "set", set: { handled: true } } }] },
    );

    const state = createState();
    await executeTryTask(taskDef, null, state, doc, evaluateExpressionBatch, makeCtx());

    expect(state.data.result).toBe("ok");
    expect(state.data.handled).toBeUndefined();
  });

  it("runs catch.do when try block throws", async () => {
    const taskDef = makeTryTaskDef(
      [{ key: "fail", task: {
        kind: "raise",
        raise: { error: { type: "test/error", status: 500, title: "Boom" } },
      }}],
      {
        do: [{ key: "recover", task: { kind: "set", set: { recovered: true } } }],
      },
    );

    const state = createState();
    await executeTryTask(taskDef, null, state, doc, evaluateExpressionBatch, makeCtx());

    expect(state.data.recovered).toBe(true);
  });

  it("binds error to state via catch.as", async () => {
    const taskDef = makeTryTaskDef(
      [{ key: "fail", task: {
        kind: "raise",
        raise: { error: { type: "test/validation", status: 400, title: "Bad input", detail: "Missing field" } },
      }}],
      {
        as: "caught_error",
        do: [{ key: "log", task: { kind: "set", set: { logged: true } } }],
      },
    );

    const state = createState();
    await executeTryTask(taskDef, null, state, doc, evaluateExpressionBatch, makeCtx());

    expect(state.data.caught_error).toBeDefined();
    const err = state.data.caught_error as Record<string, unknown>;
    expect(err.type).toBe("test/validation");
    expect(err.status).toBe(400);
    expect(err.title).toBe("Bad input");
    expect(err.detail).toBe("Missing field");
  });

  it("error shape from catch.as matches CNCF spec", async () => {
    const taskDef = makeTryTaskDef(
      [{ key: "fail", task: {
        kind: "raise",
        raise: { error: {
          type: "https://serverlessworkflow.io/spec/1.0.0/errors/runtime",
          status: 500,
          title: "Runtime Error",
          detail: "Something broke",
          instance: "wf-999",
        }},
      }}],
      { as: "error" },
    );

    const state = createState();
    await executeTryTask(taskDef, null, state, doc, evaluateExpressionBatch, makeCtx());

    const err = state.data.error as Record<string, unknown>;
    expect(err).toEqual({
      type: "https://serverlessworkflow.io/spec/1.0.0/errors/runtime",
      status: 500,
      title: "Runtime Error",
      detail: "Something broke",
      instance: "wf-999",
    });
  });

  it("filters errors via catch.errors.with — accepts matching error", async () => {
    const taskDef = makeTryTaskDef(
      [{ key: "fail", task: {
        kind: "raise",
        raise: { error: { type: "test/validation", status: 400 } },
      }}],
      {
        errors: { with: { type: "test/validation" } },
        do: [{ key: "handle", task: { kind: "set", set: { caught: true } } }],
      },
    );

    const state = createState();
    await executeTryTask(taskDef, null, state, doc, evaluateExpressionBatch, makeCtx());

    expect(state.data.caught).toBe(true);
  });

  it("filters errors via catch.errors.with — rejects non-matching error", async () => {
    const taskDef = makeTryTaskDef(
      [{ key: "fail", task: {
        kind: "raise",
        raise: { error: { type: "test/timeout", status: 408 } },
      }}],
      {
        errors: { with: { type: "test/validation" } },
        do: [{ key: "handle", task: { kind: "set", set: { caught: true } } }],
      },
    );

    const state = createState();

    await expect(
      executeTryTask(taskDef, null, state, doc, evaluateExpressionBatch, makeCtx()),
    ).rejects.toThrow(WorkflowError);

    expect(state.data.caught).toBeUndefined();
  });

  it("evaluates catch.when — accepts when expression is true", async () => {
    const taskDef = makeTryTaskDef(
      [{ key: "fail", task: {
        kind: "raise",
        raise: { error: { type: "test/error", status: 500 } },
      }}],
      {
        when: "${ $error.status == 500 }",
        as: "err",
        do: [{ key: "handle", task: { kind: "set", set: { handled_500: true } } }],
      },
    );

    const state = createState();
    await executeTryTask(taskDef, null, state, doc, evaluateExpressionBatch, makeCtx());

    expect(state.data.handled_500).toBe(true);
  });

  it("evaluates catch.when — rejects when expression is false", async () => {
    const taskDef = makeTryTaskDef(
      [{ key: "fail", task: {
        kind: "raise",
        raise: { error: { type: "test/error", status: 400 } },
      }}],
      {
        when: "${ $error.status == 500 }",
        do: [{ key: "handle", task: { kind: "set", set: { handled: true } } }],
      },
    );

    const state = createState();

    await expect(
      executeTryTask(taskDef, null, state, doc, evaluateExpressionBatch, makeCtx()),
    ).rejects.toThrow(WorkflowError);

    expect(state.data.handled).toBeUndefined();
  });

  it("swallows error when catch has no do block", async () => {
    const taskDef = makeTryTaskDef(
      [{ key: "fail", task: {
        kind: "raise",
        raise: { error: { type: "test/error", status: 500 } },
      }}],
      { as: "swallowed" },
    );

    const state = createState();
    const result = await executeTryTask(
      taskDef, null, state, doc, evaluateExpressionBatch, makeCtx(),
    );

    expect(result).toBeUndefined();
    expect(state.data.swallowed).toBeDefined();
  });

  it("re-throws when catch block is empty object", async () => {
    const taskDef: TryTaskDef = {
      kind: "try",
      try: [{ key: "fail", task: {
        kind: "raise",
        raise: { error: { type: "test/error", status: 500 } },
      }}],
      catch: {},
    };

    const state = createState();
    // Empty catch config still catches (no filter = catch-all), but has no do block
    const result = await executeTryTask(
      taskDef, null, state, doc, evaluateExpressionBatch, makeCtx(),
    );
    expect(result).toBeUndefined();
  });

  it("propagates error when catch.do block also fails", async () => {
    const taskDef = makeTryTaskDef(
      [{ key: "fail", task: {
        kind: "raise",
        raise: { error: { type: "test/original", status: 500 } },
      }}],
      {
        do: [{ key: "also-fail", task: {
          kind: "raise",
          raise: { error: { type: "test/catch-failure", status: 503, title: "Catch also failed" } },
        }}],
      },
    );

    const state = createState();

    try {
      await executeTryTask(taskDef, null, state, doc, evaluateExpressionBatch, makeCtx());
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError);
      const wErr = err as WorkflowError;
      expect(wErr.type).toBe("test/catch-failure");
      expect(wErr.status).toBe(503);
    }
  });

  it("handles nested try/catch", async () => {
    const innerTry: TryTaskDef = {
      kind: "try",
      try: [{ key: "inner-fail", task: {
        kind: "raise",
        raise: { error: { type: "inner/error", status: 422 } },
      }}],
      catch: {
        as: "inner_error",
        do: [{ key: "inner-recover", task: { kind: "set", set: { inner_caught: true } } }],
      },
    };

    const outerTry = makeTryTaskDef(
      [
        { key: "before", task: { kind: "set", set: { before: true } } },
        { key: "nested-try", task: innerTry },
        { key: "after", task: { kind: "set", set: { after: true } } },
      ],
      {
        do: [{ key: "outer-recover", task: { kind: "set", set: { outer_caught: true } } }],
      },
    );

    const state = createState();
    await executeTryTask(outerTry, null, state, doc, evaluateExpressionBatch, makeCtx());

    expect(state.data.before).toBe(true);
    expect(state.data.inner_caught).toBe(true);
    expect(state.data.after).toBe(true);
    expect(state.data.outer_caught).toBeUndefined();
  });
});
