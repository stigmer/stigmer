/**
 * Extended gRPC retry tests — ported from Python test_grpc_retry.py.
 *
 * Covers config validation, backoff timing, INTERNAL error handling,
 * mixed error sequences, and max-retries edge cases beyond the core
 * 15 tests in grpc-retry.test.ts.
 */

import { describe, it, expect, vi } from "vitest";
import { ConnectError, Code } from "@connectrpc/connect";
import { create } from "@bufbuild/protobuf";
import { AgentExecutionStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionControlSignal } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { persistWithRetry, isRetryableError, isTerminalError } from "../grpc-retry.js";
import type { StigmerClient } from "../../client/stigmer-client.js";

function makeStatus() {
  return create(AgentExecutionStatusSchema, {});
}

function mockClient(
  impl: (...args: unknown[]) => Promise<{ signal: ExecutionControlSignal }>,
): StigmerClient {
  return { updateStatus: impl } as unknown as StigmerClient;
}

const noDelay = async () => {};

describe("isRetryableError — extended codes", () => {
  it("returns false for INTERNAL", () => {
    expect(isRetryableError(new ConnectError("err", Code.Internal))).toBe(false);
  });

  it("returns false for ALREADY_EXISTS", () => {
    expect(isRetryableError(new ConnectError("dup", Code.AlreadyExists))).toBe(false);
  });

  it("returns false for CANCELLED", () => {
    expect(isRetryableError(new ConnectError("cancelled", Code.Canceled))).toBe(false);
  });
});

describe("isTerminalError — extended codes", () => {
  it("returns false for INTERNAL", () => {
    expect(isTerminalError(new ConnectError("err", Code.Internal))).toBe(false);
  });

  it("returns false for DEADLINE_EXCEEDED", () => {
    expect(isTerminalError(new ConnectError("slow", Code.DeadlineExceeded))).toBe(false);
  });

  it("returns false for non-ConnectError", () => {
    expect(isTerminalError(new Error("random"))).toBe(false);
  });
});

describe("persistWithRetry — extended scenarios", () => {
  it("does not retry INTERNAL errors (neither retryable nor terminal)", async () => {
    let attempt = 0;
    const client = mockClient(async () => {
      attempt++;
      throw new ConnectError("internal", Code.Internal);
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await persistWithRetry(client, "exec-int", makeStatus(), {
      maxRetries: 3,
      delayFn: noDelay,
    });
    errorSpy.mockRestore();

    expect(attempt).toBe(1);
  });

  it("does not retry ALREADY_EXISTS", async () => {
    let attempt = 0;
    const client = mockClient(async () => {
      attempt++;
      throw new ConnectError("exists", Code.AlreadyExists);
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await persistWithRetry(client, "exec-ae", makeStatus(), {
      maxRetries: 3,
      delayFn: noDelay,
    });
    errorSpy.mockRestore();

    expect(attempt).toBe(1);
  });

  it("handles mixed error sequence: retryable then terminal", async () => {
    let attempt = 0;
    const client = mockClient(async () => {
      attempt++;
      if (attempt === 1) throw new ConnectError("down", Code.Unavailable);
      throw new ConnectError("gone", Code.NotFound);
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const signal = await persistWithRetry(client, "exec-mix", makeStatus(), {
      delayFn: noDelay,
    });
    warnSpy.mockRestore();
    errorSpy.mockRestore();

    expect(attempt).toBe(2);
    expect(signal).toBe(ExecutionControlSignal.UNSPECIFIED);
  });

  it("handles retryable then success", async () => {
    let attempt = 0;
    const client = mockClient(async () => {
      attempt++;
      if (attempt <= 2) throw new ConnectError("timeout", Code.DeadlineExceeded);
      return { signal: ExecutionControlSignal.STOP };
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const signal = await persistWithRetry(client, "exec-ret", makeStatus(), {
      maxRetries: 5,
      delayFn: noDelay,
    });
    warnSpy.mockRestore();

    expect(signal).toBe(ExecutionControlSignal.STOP);
    expect(attempt).toBe(3);
  });

  it("maxRetries = 0 means one attempt only", async () => {
    let attempt = 0;
    const client = mockClient(async () => {
      attempt++;
      throw new ConnectError("down", Code.Unavailable);
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await persistWithRetry(client, "exec-0", makeStatus(), {
      maxRetries: 0,
      delayFn: noDelay,
    });
    errorSpy.mockRestore();

    expect(attempt).toBe(1);
  });

  it("respects custom backoff factor", async () => {
    const delays: number[] = [];
    const client = mockClient(async () => {
      throw new ConnectError("down", Code.Unavailable);
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await persistWithRetry(client, "exec-bf", makeStatus(), {
      baseDelayMs: 50,
      backoffFactor: 3,
      maxRetries: 3,
      delayFn: async (ms) => { delays.push(ms); },
    });
    warnSpy.mockRestore();
    errorSpy.mockRestore();

    expect(delays).toEqual([50, 150, 450]);
  });

  it("uses default options when none provided", async () => {
    const client = mockClient(async () => ({
      signal: ExecutionControlSignal.UNSPECIFIED,
    }));

    const signal = await persistWithRetry(client, "exec-default", makeStatus());
    expect(signal).toBe(ExecutionControlSignal.UNSPECIFIED);
  });
});
