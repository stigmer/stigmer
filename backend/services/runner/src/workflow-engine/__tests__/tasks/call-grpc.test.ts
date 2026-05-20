import { describe, it, expect, vi, beforeEach } from "vitest";
import { CallGrpcTaskBuilder } from "../../tasks/call-grpc.js";
import { createState } from "../../state.js";
import { evaluateExpressionBatch } from "../../expression.js";
import type { CallGrpcTaskDef, TaskExecutionContext } from "../../types.js";

let mockCallGrpc: ReturnType<typeof vi.fn>;

function makeCtx(): TaskExecutionContext {
  return {
    evaluateExpressions: evaluateExpressionBatch,
    doc: { document: { dsl: "1.0.0", name: "test" }, do: [] },
    callHttp: () => { throw new Error("not used"); },
    callGrpc: (...args: Parameters<TaskExecutionContext["callGrpc"]>) => mockCallGrpc(...args),
    callFunction: () => { throw new Error("not used"); },
    callAgent: () => { throw new Error("not used"); },
  };
}

describe("CallGrpcTaskBuilder", () => {
  beforeEach(() => {
    mockCallGrpc = vi.fn();
  });

  it("calls ctx.callGrpc with static config", async () => {
    mockCallGrpc.mockResolvedValue({ user: { id: "1", name: "Alice" } });

    const taskDef: CallGrpcTaskDef = {
      kind: "call:grpc",
      call: "grpc",
      with: {
        proto: "file:///proto/user.proto",
        service: { name: "com.example.UserService", host: "localhost", port: 50051 },
        method: "GetUser",
        arguments: { userId: "1" },
      },
    };

    const builder = new CallGrpcTaskBuilder("getUser", taskDef);
    const executor = builder.build();
    const state = createState();

    const result = await executor(null, state, makeCtx());

    expect(result).toEqual({ user: { id: "1", name: "Alice" } });
    expect(mockCallGrpc).toHaveBeenCalledWith(
      expect.objectContaining({
        proto: "file:///proto/user.proto",
        service: expect.objectContaining({ name: "com.example.UserService" }),
        method: "GetUser",
      }),
      expect.any(Object),
    );
  });

  it("evaluates expressions in arguments", async () => {
    mockCallGrpc.mockResolvedValue({ success: true });

    const taskDef: CallGrpcTaskDef = {
      kind: "call:grpc",
      call: "grpc",
      with: {
        proto: "file:///proto/api.proto",
        service: { name: "api.Service", host: "localhost" },
        method: "Update",
        arguments: { id: "${ $context.entityId }" },
      },
    };

    const builder = new CallGrpcTaskBuilder("updateEntity", taskDef);
    const executor = builder.build();
    const state = createState();
    state.context = { entityId: "abc-123" };

    await executor(null, state, makeCtx());

    const calledConfig = mockCallGrpc.mock.calls[0][0];
    expect(calledConfig.arguments.id).toBe("abc-123");
  });

  it("evaluates expressions in service host", async () => {
    mockCallGrpc.mockResolvedValue({});

    const taskDef: CallGrpcTaskDef = {
      kind: "call:grpc",
      call: "grpc",
      with: {
        proto: "file:///proto/api.proto",
        service: { name: "api.Service", host: "${ $env.GRPC_HOST }" },
        method: "Ping",
      },
    };

    const builder = new CallGrpcTaskBuilder("ping", taskDef);
    const executor = builder.build();
    const state = createState();
    state.env = { GRPC_HOST: "grpc.internal.svc" };

    await executor(null, state, makeCtx());

    const calledConfig = mockCallGrpc.mock.calls[0][0];
    expect(calledConfig.service.host).toBe("grpc.internal.svc");
  });

  it("passes state.env as runtimeEnv", async () => {
    mockCallGrpc.mockResolvedValue({});

    const taskDef: CallGrpcTaskDef = {
      kind: "call:grpc",
      call: "grpc",
      with: {
        proto: "file:///proto/api.proto",
        service: { name: "api.Service", host: "localhost" },
        method: "Call",
      },
    };

    const builder = new CallGrpcTaskBuilder("envTest", taskDef);
    const executor = builder.build();
    const state = createState();
    state.env = { GRPC_TOKEN: "tok-456" };

    await executor(null, state, makeCtx());

    const calledEnv = mockCallGrpc.mock.calls[0][1];
    expect(calledEnv).toEqual({ GRPC_TOKEN: "tok-456" });
  });
});
