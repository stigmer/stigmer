import { describe, it, expect, vi, beforeEach } from "vitest";
import { CallHttpTaskBuilder } from "../../tasks/call-http.js";
import { createState } from "../../state.js";
import { evaluateExpressionBatch } from "../../expression.js";
import type { CallHttpTaskDef, TaskExecutionContext } from "../../types.js";

let mockCallHttp: ReturnType<typeof vi.fn>;

function makeCtx(): TaskExecutionContext {
  return {
    evaluateExpressions: evaluateExpressionBatch,
    doc: { document: { dsl: "1.0.0", name: "test" }, do: [] },
    sleep: () => { throw new Error("not used"); },
    listen: () => { throw new Error("not used"); },
    runCommand: () => { throw new Error("not used"); },
    runWorkflow: () => { throw new Error("not used"); },
    awaitHumanInput: () => { throw new Error("not used"); },
    callHttp: (...args: Parameters<TaskExecutionContext["callHttp"]>) => mockCallHttp(...args),
    callGrpc: () => { throw new Error("not used"); },
    callFunction: () => { throw new Error("not used"); },
    callAgent: () => { throw new Error("not used"); },
  };
}

describe("CallHttpTaskBuilder", () => {
  beforeEach(() => {
    mockCallHttp = vi.fn();
  });
  it("calls ctx.callHttp with static config", async () => {
    mockCallHttp.mockResolvedValue({ id: 1 });

    const taskDef: CallHttpTaskDef = {
      kind: "call:http",
      call: "http",
      with: {
        method: "GET",
        endpoint: { uri: "https://api.example.com/posts/1" },
      },
    };

    const builder = new CallHttpTaskBuilder("fetchPost", taskDef);
    const executor = builder.build();
    const state = createState();

    const result = await executor(null, state, makeCtx());

    expect(result).toEqual({ id: 1 });
    expect(mockCallHttp).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        endpoint: expect.objectContaining({ uri: "https://api.example.com/posts/1" }),
      }),
      expect.any(Object),
    );
  });

  it("evaluates expressions in the with config", async () => {
    mockCallHttp.mockResolvedValue({ id: 42 });

    const taskDef: CallHttpTaskDef = {
      kind: "call:http",
      call: "http",
      with: {
        method: "POST",
        endpoint: { uri: "https://api.example.com/posts" },
        body: {
          userId: "${ $context.userId }",
          title: "Static Title",
        },
      },
    };

    const builder = new CallHttpTaskBuilder("createPost", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { userId: 7 };

    await executor(null, state, makeCtx());

    const calledConfig = mockCallHttp.mock.calls[0][0];
    expect(calledConfig.body.userId).toBe(7);
    expect(calledConfig.body.title).toBe("Static Title");
  });

  it("evaluates expressions in endpoint URI", async () => {
    mockCallHttp.mockResolvedValue({});

    const taskDef: CallHttpTaskDef = {
      kind: "call:http",
      call: "http",
      with: {
        method: "GET",
        endpoint: { uri: "${ $context.apiBase + \"/posts/\" + ($context.postId | tostring) }" },
      },
    };

    const builder = new CallHttpTaskBuilder("dynamicUrl", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { apiBase: "https://api.example.com", postId: 5 };

    await executor(null, state, makeCtx());

    const calledConfig = mockCallHttp.mock.calls[0][0];
    expect(calledConfig.endpoint.uri).toBe("https://api.example.com/posts/5");
  });

  it("passes state.env as runtimeEnv", async () => {
    mockCallHttp.mockResolvedValue({});

    const taskDef: CallHttpTaskDef = {
      kind: "call:http",
      call: "http",
      with: { method: "GET", endpoint: "https://example.com" },
    };

    const builder = new CallHttpTaskBuilder("envTest", taskDef);
    const executor = builder.build();
    const state = createState();
    state.env = { API_TOKEN: "secret-123" };

    await executor(null, state, makeCtx());

    const calledEnv = mockCallHttp.mock.calls[0][1];
    expect(calledEnv).toEqual({ API_TOKEN: "secret-123" });
  });

  it("leaves runtime placeholders intact for activity-side resolution", async () => {
    mockCallHttp.mockResolvedValue({});

    const taskDef: CallHttpTaskDef = {
      kind: "call:http",
      call: "http",
      with: {
        method: "GET",
        endpoint: "https://example.com",
        headers: { Authorization: "Bearer ${.secrets.TOKEN}" },
      },
    };

    const builder = new CallHttpTaskBuilder("secretTest", taskDef);
    const executor = builder.build();
    const state = createState();

    await executor(null, state, makeCtx());

    const calledConfig = mockCallHttp.mock.calls[0][0];
    expect(calledConfig.headers.Authorization).toBe("Bearer ${.secrets.TOKEN}");
  });
});
