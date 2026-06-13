import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useExecutionStream } from "../useExecutionStream";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a controllable async generator. Call `push(value)` to yield
 * the next value, `finish()` to end the stream, or `fail(err)` to
 * throw an error from the stream.
 */
function createControllableStream<T>() {
  let resolve: ((v: IteratorResult<T>) => void) | null = null;
  let reject: ((err: unknown) => void) | null = null;

  const generator: AsyncGenerator<T> = {
    next() {
      return new Promise<IteratorResult<T>>((res, rej) => {
        resolve = res;
        reject = rej;
      });
    },
    return(value?: unknown) {
      return Promise.resolve({ done: true as const, value: value as T });
    },
    throw(err?: unknown) {
      return Promise.reject(err);
    },
    [Symbol.asyncIterator]() {
      return generator;
    },
  };

  return {
    generator,
    push(value: T) {
      resolve?.({ done: false, value });
    },
    finish() {
      resolve?.({ done: true, value: undefined as unknown as T });
    },
    fail(err: Error) {
      reject?.(err);
    },
  };
}

function makeSnapshot(phase: ExecutionPhase): AgentExecution {
  const exec = create(AgentExecutionSchema);
  const status = create(AgentExecutionStatusSchema);
  status.phase = phase;
  exec.status = status;
  return exec;
}

function createMockStigmer(
  subscribeFn: Stigmer["agentExecution"]["subscribe"],
) {
  return {
    agentExecution: { subscribe: subscribeFn },
  } as unknown as Stigmer;
}

function createWrapper(client: Stigmer) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client}>
        {children}
      </StigmerContext.Provider>
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useExecutionStream", () => {
  let stream: ReturnType<typeof createControllableStream<AgentExecution>>;
  let subscribeFn: ReturnType<typeof vi.fn>;
  let mockStigmer: Stigmer;

  beforeEach(() => {
    stream = createControllableStream<AgentExecution>();
    subscribeFn = vi.fn().mockReturnValue(stream.generator);
    mockStigmer = createMockStigmer(subscribeFn);
  });

  it("returns idle state when executionId is null", () => {
    const { result } = renderHook(() => useExecutionStream(null), {
      wrapper: createWrapper(mockStigmer),
    });

    expect(result.current.execution).toBeNull();
    expect(result.current.isConnecting).toBe(false);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(subscribeFn).not.toHaveBeenCalled();
  });

  it("starts in isConnecting state when given an ID", async () => {
    const { result } = renderHook(() => useExecutionStream("exec-1"), {
      wrapper: createWrapper(mockStigmer),
    });

    await waitFor(() => {
      expect(result.current.isConnecting).toBe(true);
    });
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.execution).toBeNull();
  });

  it("transitions to isStreaming after first non-terminal snapshot", async () => {
    const { result } = renderHook(() => useExecutionStream("exec-1"), {
      wrapper: createWrapper(mockStigmer),
    });

    act(() => {
      stream.push(makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS));
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
      expect(result.current.isConnecting).toBe(false);
      expect(result.current.execution).not.toBeNull();
    });
  });

  it("updates execution with each streamed snapshot", async () => {
    const { result } = renderHook(() => useExecutionStream("exec-1"), {
      wrapper: createWrapper(mockStigmer),
    });

    act(() => {
      stream.push(makeSnapshot(ExecutionPhase.EXECUTION_PENDING));
    });

    await waitFor(() => {
      expect(result.current.execution).not.toBeNull();
      expect(result.current.execution?.status?.phase).toBe(
        ExecutionPhase.EXECUTION_PENDING,
      );
    });

    act(() => {
      stream.push(makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS));
    });

    await waitFor(() => {
      expect(result.current.execution?.status?.phase).toBe(
        ExecutionPhase.EXECUTION_IN_PROGRESS,
      );
    });
  });

  it("sets isStreaming to false when a terminal phase is received", async () => {
    const { result } = renderHook(() => useExecutionStream("exec-1"), {
      wrapper: createWrapper(mockStigmer),
    });

    act(() => {
      stream.push(makeSnapshot(ExecutionPhase.EXECUTION_COMPLETED));
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.execution).not.toBeNull();
      expect(result.current.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    });
  });

  it("sets error when the stream throws", async () => {
    const { result } = renderHook(() => useExecutionStream("exec-1"), {
      wrapper: createWrapper(mockStigmer),
    });

    act(() => {
      stream.fail(new Error("connection lost"));
    });

    await waitFor(() => {
      expect(result.current.error?.message).toBe("connection lost");
      expect(result.current.isConnecting).toBe(false);
      expect(result.current.isStreaming).toBe(false);
    });
  });

  it("reconnect clears error and re-subscribes", async () => {
    const { result } = renderHook(() => useExecutionStream("exec-1"), {
      wrapper: createWrapper(mockStigmer),
    });

    act(() => stream.fail(new Error("timeout")));

    await waitFor(() => {
      expect(result.current.error?.message).toBe("timeout");
    });

    const newStream = createControllableStream<AgentExecution>();
    subscribeFn.mockReturnValue(newStream.generator);

    act(() => result.current.reconnect());

    await waitFor(() => {
      expect(result.current.error).toBeNull();
      expect(result.current.isConnecting).toBe(true);
    });

    expect(subscribeFn).toHaveBeenCalledTimes(2);
  });

  it("aborts previous subscription when executionId changes", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useExecutionStream(id),
      {
        wrapper: createWrapper(mockStigmer),
        initialProps: { id: "exec-1" },
      },
    );

    act(() => {
      stream.push(makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS));
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    const newStream = createControllableStream<AgentExecution>();
    subscribeFn.mockReturnValue(newStream.generator);

    rerender({ id: "exec-2" });

    await waitFor(() => {
      expect(result.current.isConnecting).toBe(true);
      expect(result.current.execution).toBeNull();
    });
    expect(subscribeFn).toHaveBeenCalledTimes(2);
  });

  it("cleans up subscription on unmount", () => {
    const { unmount } = renderHook(() => useExecutionStream("exec-1"), {
      wrapper: createWrapper(mockStigmer),
    });

    const signal = subscribeFn.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(false);

    unmount();

    expect(signal.aborted).toBe(true);
  });

  it("resets state when executionId becomes null", async () => {
    const { result, rerender } = renderHook(
      ({ id }: { id: string | null }) => useExecutionStream(id),
      {
        wrapper: createWrapper(mockStigmer),
        initialProps: { id: "exec-1" as string | null },
      },
    );

    act(() => {
      stream.push(makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS));
    });

    await waitFor(() => {
      expect(result.current.execution).not.toBeNull();
    });

    rerender({ id: null });

    await waitFor(() => {
      expect(result.current.execution).toBeNull();
      expect(result.current.isConnecting).toBe(false);
      expect(result.current.isStreaming).toBe(false);
    });
  });

  it("derives phase from execution snapshot", async () => {
    const { result } = renderHook(() => useExecutionStream("exec-1"), {
      wrapper: createWrapper(mockStigmer),
    });

    expect(result.current.phase).toBe(
      ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
    );

    act(() => {
      stream.push(makeSnapshot(ExecutionPhase.EXECUTION_IN_PROGRESS));
    });

    await waitFor(() => {
      expect(result.current.phase).toBe(
        ExecutionPhase.EXECUTION_IN_PROGRESS,
      );
    });
  });

  it("does not auto-retry a non-transient error (goes straight to error)", async () => {
    const { result } = renderHook(() => useExecutionStream("exec-1"), {
      wrapper: createWrapper(mockStigmer),
    });

    // A deterministic error (plain Error, not transport noise) must not retry.
    act(() => stream.fail(new Error("invalid argument")));

    await waitFor(() => {
      expect(result.current.error?.message).toBe("invalid argument");
    });
    expect(result.current.isReconnecting).toBe(false);
    expect(subscribeFn).toHaveBeenCalledTimes(1);
  });

  it("handles all terminal phases correctly", async () => {
    for (const terminalPhase of [
      ExecutionPhase.EXECUTION_COMPLETED,
      ExecutionPhase.EXECUTION_FAILED,
      ExecutionPhase.EXECUTION_CANCELLED,
      ExecutionPhase.EXECUTION_TERMINATED,
    ]) {
      const localStream = createControllableStream<AgentExecution>();
      subscribeFn.mockReturnValue(localStream.generator);

      const { result, unmount } = renderHook(
        () => useExecutionStream("exec-terminal"),
        { wrapper: createWrapper(mockStigmer) },
      );

      act(() => {
        localStream.push(makeSnapshot(terminalPhase));
      });

      await waitFor(() => {
        expect(result.current.isStreaming).toBe(false);
        expect(result.current.phase).toBe(terminalPhase);
      });

      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Auto-reconnect (#174)
// ---------------------------------------------------------------------------

describe("useExecutionStream — auto-reconnect", () => {
  const IN_PROGRESS = ExecutionPhase.EXECUTION_IN_PROGRESS;
  // Tiny backoff so retries fire near-instantly under real timers; avoids the
  // fake-timer / `waitFor` interaction that makes such tests brittle.
  const fastReconnect = { baseDelayMs: 5, maxDelayMs: 5 } as const;

  it("auto-reconnects after a transient drop and keeps the last snapshot", async () => {
    const s1 = createControllableStream<AgentExecution>();
    const s2 = createControllableStream<AgentExecution>();
    let call = 0;
    const subscribeFn = vi.fn(() => (call++ === 0 ? s1.generator : s2.generator));
    const stigmer = createMockStigmer(
      subscribeFn as unknown as Stigmer["agentExecution"]["subscribe"],
    );

    const { result } = renderHook(
      () => useExecutionStream("exec-1", { reconnectOptions: fastReconnect }),
      { wrapper: createWrapper(stigmer) },
    );

    act(() => s1.push(makeSnapshot(IN_PROGRESS)));
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    // WebKit's bare `TypeError: Load failed` — the #174 symptom.
    act(() => s1.fail(new TypeError("Load failed")));

    await waitFor(() => expect(result.current.isReconnecting).toBe(true));
    // No error surfaced and the conversation stays visible while retrying.
    expect(result.current.error).toBeNull();
    expect(result.current.execution).not.toBeNull();

    // Backoff elapses → the stream is re-subscribed (full snapshot resume).
    await waitFor(() => expect(subscribeFn).toHaveBeenCalledTimes(2));

    act(() => s2.push(makeSnapshot(IN_PROGRESS)));
    await waitFor(() => expect(result.current.isStreaming).toBe(true));
    expect(result.current.isReconnecting).toBe(false);
  });

  it("auto-reconnects when the stream ends before a terminal phase", async () => {
    const s1 = createControllableStream<AgentExecution>();
    const s2 = createControllableStream<AgentExecution>();
    let call = 0;
    const subscribeFn = vi.fn(() => (call++ === 0 ? s1.generator : s2.generator));
    const stigmer = createMockStigmer(
      subscribeFn as unknown as Stigmer["agentExecution"]["subscribe"],
    );

    const { result } = renderHook(
      () => useExecutionStream("exec-1", { reconnectOptions: fastReconnect }),
      { wrapper: createWrapper(stigmer) },
    );

    act(() => s1.push(makeSnapshot(IN_PROGRESS)));
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    // A graceful close of a still-running execution (idle timeout, LB recycle)
    // must reconnect, never be reported as "complete".
    act(() => s1.finish());

    await waitFor(() => expect(subscribeFn).toHaveBeenCalledTimes(2));
    expect(result.current.isReconnecting).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("surfaces an error only after retries are exhausted", async () => {
    const subscribeFn = vi.fn(
      () =>
        (async function* (): AsyncGenerator<AgentExecution> {
          throw new TypeError("Load failed");
        })(),
    );
    const stigmer = createMockStigmer(
      subscribeFn as unknown as Stigmer["agentExecution"]["subscribe"],
    );

    const { result } = renderHook(
      () =>
        useExecutionStream("exec-1", {
          reconnectOptions: { baseDelayMs: 1, maxDelayMs: 1, maxAttempts: 2 },
        }),
      { wrapper: createWrapper(stigmer) },
    );

    await waitFor(() => expect(result.current.error).not.toBeNull(), {
      timeout: 2000,
    });
    expect(result.current.error?.message).toBe("Load failed");
    expect(result.current.isReconnecting).toBe(false);
    // 1 initial attempt + 2 retries.
    expect(subscribeFn).toHaveBeenCalledTimes(3);
  });

  it("does not reconnect after a terminal snapshot", async () => {
    const s1 = createControllableStream<AgentExecution>();
    const subscribeFn = vi.fn(() => s1.generator);
    const stigmer = createMockStigmer(
      subscribeFn as unknown as Stigmer["agentExecution"]["subscribe"],
    );

    const { result } = renderHook(
      () => useExecutionStream("exec-1", { reconnectOptions: fastReconnect }),
      { wrapper: createWrapper(stigmer) },
    );

    act(() => s1.push(makeSnapshot(ExecutionPhase.EXECUTION_COMPLETED)));
    await waitFor(() => expect(result.current.isStreaming).toBe(false));

    await new Promise((r) => setTimeout(r, 30));
    expect(subscribeFn).toHaveBeenCalledTimes(1);
    expect(result.current.isReconnecting).toBe(false);
  });

  it("does not re-subscribe when unmounted during backoff", async () => {
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(1); // full delay
    const subscribeFn = vi.fn(
      () =>
        (async function* (): AsyncGenerator<AgentExecution> {
          throw new TypeError("Load failed");
        })(),
    );
    const stigmer = createMockStigmer(
      subscribeFn as unknown as Stigmer["agentExecution"]["subscribe"],
    );

    const { result, unmount } = renderHook(
      () =>
        useExecutionStream("exec-1", {
          reconnectOptions: { baseDelayMs: 1_000, maxDelayMs: 1_000 },
        }),
      { wrapper: createWrapper(stigmer) },
    );

    await waitFor(() => expect(result.current.isReconnecting).toBe(true));
    expect(subscribeFn).toHaveBeenCalledTimes(1);

    unmount();
    await new Promise((r) => setTimeout(r, 50));
    expect(subscribeFn).toHaveBeenCalledTimes(1);

    randomSpy.mockRestore();
  });

  it("respects autoReconnect: false (immediate error, no retry)", async () => {
    const s1 = createControllableStream<AgentExecution>();
    const subscribeFn = vi.fn(() => s1.generator);
    const stigmer = createMockStigmer(
      subscribeFn as unknown as Stigmer["agentExecution"]["subscribe"],
    );

    const { result } = renderHook(
      () => useExecutionStream("exec-1", { autoReconnect: false }),
      { wrapper: createWrapper(stigmer) },
    );

    act(() => s1.push(makeSnapshot(IN_PROGRESS)));
    await waitFor(() => expect(result.current.isStreaming).toBe(true));

    act(() => s1.fail(new TypeError("Load failed")));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.isReconnecting).toBe(false);
    expect(subscribeFn).toHaveBeenCalledTimes(1);
  });
});
