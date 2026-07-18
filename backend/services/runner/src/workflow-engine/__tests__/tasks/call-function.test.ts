import { describe, it, expect, vi, beforeEach } from "vitest";
import { CallFunctionTaskBuilder } from "../../tasks/call-function.js";
import { createState } from "../../state.js";
import { evaluateExpressionBatch } from "../../expression.js";
import type { CallFunctionTaskDef, TaskExecutionContext } from "../../types.js";

let mockCallFunction: ReturnType<typeof vi.fn>;

function makeCtx(): TaskExecutionContext {
  return {
    evaluateExpressions: evaluateExpressionBatch,
    doc: { document: { dsl: "1.0.0", name: "test-workflow" }, do: [] },
    sleep: () => { throw new Error("not used"); },
    listen: () => { throw new Error("not used"); },
    runCommand: () => { throw new Error("not used"); },
    runWorkflow: () => { throw new Error("not used"); },
    awaitHumanInput: () => { throw new Error("not used"); },
    callHttp: () => { throw new Error("not used"); },
    callGrpc: () => { throw new Error("not used"); },
    callFunction: (...args: Parameters<TaskExecutionContext["callFunction"]>) => mockCallFunction(...args),
    callAgent: () => { throw new Error("not used"); },
  };
}

describe("CallFunctionTaskBuilder", () => {
  beforeEach(() => {
    mockCallFunction = vi.fn();
  });

  it("calls ctx.callFunction with the correct call type", async () => {
    mockCallFunction.mockResolvedValue({
      result: "hello", model: "gpt-4o-mini", provider: "openai",
      input_tokens: 10, output_tokens: 5,
    });

    const taskDef: CallFunctionTaskDef = {
      kind: "call:function",
      call: "llm",
      with: {
        model: "gpt-4o-mini",
        prompt: "Say hello",
      },
    };

    const builder = new CallFunctionTaskBuilder("askLlm", taskDef);
    const executor = builder.build();
    const state = createState();

    const result = await executor(null, state, makeCtx());

    expect(result).toEqual({
      text: "hello",
      structured: undefined,
      model: "gpt-4o-mini",
      usage: { input_tokens: 10, output_tokens: 5 },
    });
    expect(mockCallFunction).toHaveBeenCalledWith(
      "llm",
      expect.objectContaining({ model: "gpt-4o-mini", prompt: "Say hello" }),
      expect.any(Object),
      expect.objectContaining({ workflowExecutionId: undefined }),
    );
  });

  it("normalizes llm_call with response_schema to .structured", async () => {
    const parsed = { severity: "high", category: "billing" };
    mockCallFunction.mockResolvedValue({
      result: parsed, model: "gpt-4o-mini", provider: "openai",
      input_tokens: 50, output_tokens: 20, __stigmer_cost_micros: 300,
    });

    const taskDef: CallFunctionTaskDef = {
      kind: "call:function",
      call: "llm",
      with: {
        model: "gpt-4o-mini",
        prompt: "Classify this ticket",
        response_schema: { type: "object", required: ["severity"] },
      },
    };

    const builder = new CallFunctionTaskBuilder("classify", taskDef);
    const executor = builder.build();
    const state = createState();

    const result = await executor(null, state, makeCtx());

    expect(result).toEqual({
      text: undefined,
      structured: parsed,
      model: "gpt-4o-mini",
      usage: { input_tokens: 50, output_tokens: 20 },
      __stigmer_cost_micros: 300,
    });
  });

  it("evaluates expressions in the with config", async () => {
    mockCallFunction.mockResolvedValue({
      result: "analyzed", model: "claude-sonnet-4-5", provider: "anthropic",
      input_tokens: 100, output_tokens: 30,
    });

    const taskDef: CallFunctionTaskDef = {
      kind: "call:function",
      call: "llm",
      with: {
        model: "claude-sonnet-4-5",
        prompt: "${ $context.userMessage }",
        system_prompt: "You are a helpful assistant.",
      },
    };

    const builder = new CallFunctionTaskBuilder("analyze", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { userMessage: "What is 2+2?" };

    await executor(null, state, makeCtx());

    const calledConfig = mockCallFunction.mock.calls[0][1];
    expect(calledConfig.prompt).toBe("What is 2+2?");
    expect(calledConfig.system_prompt).toBe("You are a helpful assistant.");
  });

  it("passes state.env as runtimeEnv", async () => {
    mockCallFunction.mockResolvedValue({});

    const taskDef: CallFunctionTaskDef = {
      kind: "call:function",
      call: "llm",
      with: { model: "gpt-4o", prompt: "test" },
    };

    const builder = new CallFunctionTaskBuilder("envTest", taskDef);
    const executor = builder.build();
    const state = createState();
    state.env = { LLM_KEY: "secret" };

    await executor(null, state, makeCtx());

    const calledEnv = mockCallFunction.mock.calls[0][2];
    expect(calledEnv).toEqual({ LLM_KEY: "secret" });
  });

  it("handles missing with config", async () => {
    mockCallFunction.mockResolvedValue({ ok: true });

    const taskDef: CallFunctionTaskDef = {
      kind: "call:function",
      call: "transform",
    };

    const builder = new CallFunctionTaskBuilder("noConfig", taskDef);
    const executor = builder.build();
    const state = createState();

    await executor(null, state, makeCtx());

    expect(mockCallFunction).toHaveBeenCalledWith(
      "transform",
      { input: null },
      expect.any(Object),
      expect.any(Object),
    );
  });

  it("passes workflowExecutionId from state.env.__stigmer_execution_id", async () => {
    mockCallFunction.mockResolvedValue({});

    const taskDef: CallFunctionTaskDef = {
      kind: "call:function",
      call: "llm",
      with: { model: "gpt-4o", prompt: "hi" },
    };

    const builder = new CallFunctionTaskBuilder("metaTest", taskDef);
    const executor = builder.build();
    const state = createState();
    state.env.__stigmer_execution_id = "wex_01abc123";

    await executor(null, state, makeCtx());

    const calledMeta = mockCallFunction.mock.calls[0][3];
    expect(calledMeta.workflowExecutionId).toBe("wex_01abc123");
  });

  it("leaves workflowExecutionId undefined when no execution ID in state", async () => {
    mockCallFunction.mockResolvedValue({});

    const taskDef: CallFunctionTaskDef = {
      kind: "call:function",
      call: "llm",
      with: { model: "gpt-4o", prompt: "hi" },
    };

    const builder = new CallFunctionTaskBuilder("metaTest", taskDef);
    const executor = builder.build();
    const state = createState();

    await executor(null, state, makeCtx());

    const calledMeta = mockCallFunction.mock.calls[0][3];
    expect(calledMeta.workflowExecutionId).toBeUndefined();
  });

  // Deferred-code fields (upstream #7 regression): rule/transform
  // expressions are jq CODE the activity evaluates against its own data.
  // The config resolver must never pre-evaluate them — the pre-fix
  // behavior substituted the evaluated boolean back into the config and
  // crashed the validate activity with `expr.includes is not a function`.
  describe("deferred expression fields", () => {
    it("passes validate rules[].expression through unresolved while input and message interpolate", async () => {
      mockCallFunction.mockResolvedValue({ valid: true, errors: [] });

      const taskDef: CallFunctionTaskDef = {
        kind: "call:function",
        call: "validate",
        with: {
          input: "${ $context.total_order }",
          rules: [
            {
              name: "total_is_positive",
              expression: "${ .total > 0 }",
              message: "Total ${ $context.total_order.currency } must be positive",
            },
          ],
          on_fail: "VALIDATION_FAIL_RAISE",
        },
      };

      const builder = new CallFunctionTaskBuilder("check_order", taskDef);
      const executor = builder.build();
      const state = createState();
      state.context = { total_order: { total: 150, currency: "USD" } };

      await executor(null, state, makeCtx());

      const calledConfig = mockCallFunction.mock.calls[0][1];
      // Data fields resolve...
      expect(calledConfig.input).toEqual({ total: 150, currency: "USD" });
      expect(calledConfig.rules[0].message).toBe("Total USD must be positive");
      // ...the rule predicate does NOT — it stays deferred code.
      expect(calledConfig.rules[0].expression).toBe("${ .total > 0 }");
    });

    it("passes a ${ }-wrapped transform expression through unresolved", async () => {
      mockCallFunction.mockResolvedValue({ total: 150 });

      const taskDef: CallFunctionTaskDef = {
        kind: "call:function",
        call: "transform",
        with: {
          engine: "TRANSFORM_ENGINE_JQ",
          expression: "${ { total: .qty } }",
          input: "${ $context.order }",
        },
      };

      const builder = new CallFunctionTaskBuilder("total_order", taskDef);
      const executor = builder.build();
      const state = createState();
      state.context = { order: { qty: 3 } };

      await executor(null, state, makeCtx());

      const calledConfig = mockCallFunction.mock.calls[0][1];
      expect(calledConfig.input).toEqual({ qty: 3 });
      expect(calledConfig.expression).toBe("${ { total: .qty } }");
    });

    it("does not mutate the original task definition across invocations", async () => {
      mockCallFunction.mockResolvedValue({ valid: true, errors: [] });

      const withConfig = {
        input: "${ $context.order }",
        rules: [{ name: "r", expression: "${ .total > 0 }" }],
      };
      const taskDef: CallFunctionTaskDef = {
        kind: "call:function",
        call: "validate",
        with: withConfig,
      };

      const builder = new CallFunctionTaskBuilder("check", taskDef);
      const executor = builder.build();
      const state = createState();
      state.context = { order: { total: 1 } };

      await executor(null, state, makeCtx());
      await executor(null, state, makeCtx());

      // Retry-safety: the shared definition object stays pristine.
      expect(withConfig.input).toBe("${ $context.order }");
      expect(withConfig.rules[0].expression).toBe("${ .total > 0 }");
      const secondCall = mockCallFunction.mock.calls[1][1];
      expect(secondCall.rules[0].expression).toBe("${ .total > 0 }");
    });
  });
});
