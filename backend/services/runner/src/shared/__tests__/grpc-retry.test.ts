import { describe, it, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionControlSignal } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  persistWithRetry,
  isRetryableError,
  isTerminalError,
} from "../grpc-retry.js";
import type { StigmerClient } from "../../client/stigmer-client.js";

function makeStatus() {
  return create(AgentExecutionStatusSchema, {});
}

function mockClient(
  updateStatusImpl: (...args: unknown[]) => Promise<{ signal: ExecutionControlSignal }>,
): StigmerClient {
  return { updateStatus: updateStatusImpl } as unknown as StigmerClient;
}

const noDelay = async () => {};

describe("isRetryableError", () => {
  it("returns true for UNAVAILABLE", () => {
    expect(isRetryableError(new ConnectError("down", Code.Unavailable))).toBe(true);
  });

  it("returns true for DEADLINE_EXCEEDED", () => {
    expect(isRetryableError(new ConnectError("slow", Code.DeadlineExceeded))).toBe(true);
  });

  it("returns false for NOT_FOUND", () => {
    expect(isRetryableError(new ConnectError("gone", Code.NotFound))).toBe(false);
  });

  it("returns false for non-ConnectError", () => {
    expect(isRetryableError(new Error("random"))).toBe(false);
  });
});

describe("isTerminalError", () => {
  it("returns true for INVALID_ARGUMENT", () => {
    expect(isTerminalError(new ConnectError("bad", Code.InvalidArgument))).toBe(true);
  });

  it("returns true for NOT_FOUND", () => {
    expect(isTerminalError(new ConnectError("gone", Code.NotFound))).toBe(true);
  });

  it("returns true for PERMISSION_DENIED", () => {
    expect(isTerminalError(new ConnectError("nope", Code.PermissionDenied))).toBe(true);
  });

  it("returns false for UNAVAILABLE", () => {
    expect(isTerminalError(new ConnectError("down", Code.Unavailable))).toBe(false);
  });
});

describe("persistWithRetry", () => {
  it("returns signal on successful first attempt", async () => {
    const client = mockClient(async () => ({
      signal: ExecutionControlSignal.STOP,
    }));

    const signal = await persistWithRetry(client, "exec-1", makeStatus(), {
      delayFn: noDelay,
    });

    expect(signal).toBe(ExecutionControlSignal.STOP);
  });

  it("retries on UNAVAILABLE and succeeds", async () => {
    let attempt = 0;
    const client = mockClient(async () => {
      attempt++;
      if (attempt === 1) throw new ConnectError("down", Code.Unavailable);
      return { signal: ExecutionControlSignal.UNSPECIFIED };
    });

    const signal = await persistWithRetry(client, "exec-2", makeStatus(), {
      delayFn: noDelay,
    });

    expect(signal).toBe(ExecutionControlSignal.UNSPECIFIED);
    expect(attempt).toBe(2);
  });

  it("does not retry terminal errors (NOT_FOUND)", async () => {
    let attempt = 0;
    const client = mockClient(async () => {
      attempt++;
      throw new ConnectError("gone", Code.NotFound);
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const signal = await persistWithRetry(client, "exec-3", makeStatus(), {
      delayFn: noDelay,
    });
    errorSpy.mockRestore();

    expect(signal).toBe(ExecutionControlSignal.UNSPECIFIED);
    expect(attempt).toBe(1);
  });

  it("returns UNSPECIFIED after all retries exhausted", async () => {
    const client = mockClient(async () => {
      throw new ConnectError("down", Code.Unavailable);
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const signal = await persistWithRetry(client, "exec-4", makeStatus(), {
      maxRetries: 3,
      delayFn: noDelay,
    });
    warnSpy.mockRestore();
    errorSpy.mockRestore();

    expect(signal).toBe(ExecutionControlSignal.UNSPECIFIED);
  });

  it("uses correct backoff delays", async () => {
    const delays: number[] = [];
    const client = mockClient(async () => {
      throw new ConnectError("down", Code.Unavailable);
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await persistWithRetry(client, "exec-5", makeStatus(), {
      baseDelayMs: 100,
      backoffFactor: 2,
      maxRetries: 3,
      delayFn: async (ms) => { delays.push(ms); },
    });
    warnSpy.mockRestore();
    errorSpy.mockRestore();

    expect(delays).toEqual([100, 200, 400]);
  });

  it("handles non-ConnectError by not retrying", async () => {
    let attempt = 0;
    const client = mockClient(async () => {
      attempt++;
      throw new Error("unexpected");
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const signal = await persistWithRetry(client, "exec-6", makeStatus(), {
      delayFn: noDelay,
    });
    errorSpy.mockRestore();

    expect(signal).toBe(ExecutionControlSignal.UNSPECIFIED);
    expect(attempt).toBe(1);
  });

  it("never throws regardless of error type", async () => {
    const client = mockClient(async () => {
      throw new ConnectError("server exploded", Code.Internal);
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      persistWithRetry(client, "exec-7", makeStatus(), { delayFn: noDelay }),
    ).resolves.toBe(ExecutionControlSignal.UNSPECIFIED);
    errorSpy.mockRestore();
  });
});
