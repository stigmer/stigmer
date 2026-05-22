import { describe, it, expect } from "vitest";
import { RaiseTaskBuilder } from "../../tasks/raise.js";
import { createState } from "../../state.js";
import { evaluateExpressionBatch } from "../../expression.js";
import { WorkflowError } from "../../errors.js";
import type { RaiseTaskDef, TaskExecutionContext } from "../../types.js";

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

describe("RaiseTaskBuilder", () => {
  it("throws a WorkflowError with static error definition", async () => {
    const taskDef: RaiseTaskDef = {
      kind: "raise",
      raise: {
        error: {
          type: "https://serverlessworkflow.io/spec/1.0.0/errors/validation",
          status: 400,
          title: "Validation failed",
          detail: "Missing required field",
        },
      },
    };

    const builder = new RaiseTaskBuilder("throwError", taskDef);
    const executor = builder.build();
    const state = createState();

    try {
      await executor(null, state, makeCtx());
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WorkflowError);
      const wErr = err as WorkflowError;
      expect(wErr.type).toBe("https://serverlessworkflow.io/spec/1.0.0/errors/validation");
      expect(wErr.status).toBe(400);
      expect(wErr.title).toBe("Validation failed");
      expect(wErr.detail).toBe("Missing required field");
    }
  });

  it("evaluates jq expression in title", async () => {
    const taskDef: RaiseTaskDef = {
      kind: "raise",
      raise: {
        error: {
          type: "custom/error",
          status: 422,
          title: "${ $data.error_title }",
        },
      },
    };

    const builder = new RaiseTaskBuilder("dynamicTitle", taskDef);
    const executor = builder.build();
    const state = createState();
    state.addData({ error_title: "Dynamic Title" });

    try {
      await executor(null, state, makeCtx());
      expect.fail("should have thrown");
    } catch (err) {
      const wErr = err as WorkflowError;
      expect(wErr.title).toBe("Dynamic Title");
    }
  });

  it("evaluates jq expression in detail", async () => {
    const taskDef: RaiseTaskDef = {
      kind: "raise",
      raise: {
        error: {
          type: "custom/error",
          status: 500,
          detail: "${ $data.message }",
        },
      },
    };

    const builder = new RaiseTaskBuilder("dynamicDetail", taskDef);
    const executor = builder.build();
    const state = createState();
    state.addData({ message: "Something specific went wrong" });

    try {
      await executor(null, state, makeCtx());
      expect.fail("should have thrown");
    } catch (err) {
      const wErr = err as WorkflowError;
      expect(wErr.detail).toBe("Something specific went wrong");
    }
  });

  it("populates all fields including instance", async () => {
    const taskDef: RaiseTaskDef = {
      kind: "raise",
      raise: {
        error: {
          type: "https://serverlessworkflow.io/spec/1.0.0/errors/timeout",
          status: 408,
          title: "Operation Timeout",
          detail: "Exceeded 30s limit",
          instance: "exec-789",
        },
      },
    };

    const builder = new RaiseTaskBuilder("timeout", taskDef);
    const executor = builder.build();
    const state = createState();

    try {
      await executor(null, state, makeCtx());
      expect.fail("should have thrown");
    } catch (err) {
      const wErr = err as WorkflowError;
      expect(wErr.type).toBe("https://serverlessworkflow.io/spec/1.0.0/errors/timeout");
      expect(wErr.status).toBe(408);
      expect(wErr.title).toBe("Operation Timeout");
      expect(wErr.detail).toBe("Exceeded 30s limit");
      expect(wErr.instance).toBe("exec-789");
    }
  });

  it("handles missing optional fields gracefully", async () => {
    const taskDef: RaiseTaskDef = {
      kind: "raise",
      raise: {
        error: {
          type: "minimal/error",
          status: 500,
        },
      },
    };

    const builder = new RaiseTaskBuilder("minimal", taskDef);
    const executor = builder.build();
    const state = createState();

    try {
      await executor(null, state, makeCtx());
      expect.fail("should have thrown");
    } catch (err) {
      const wErr = err as WorkflowError;
      expect(wErr.type).toBe("minimal/error");
      expect(wErr.status).toBe(500);
      expect(wErr.title).toBe("");
      expect(wErr.detail).toBe("");
    }
  });
});
