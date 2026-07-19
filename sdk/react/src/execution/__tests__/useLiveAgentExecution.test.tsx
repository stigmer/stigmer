import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { create } from "@bufbuild/protobuf";

vi.mock("../../hooks", () => ({
  useStigmer: vi.fn(),
}));
vi.mock("../useExecutionStream", () => ({
  useExecutionStream: vi.fn(),
}));

import {
  AgentExecutionSchema,
  AgentExecutionStatusSchema,
  type AgentExecution,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { StigmerError } from "@stigmer/sdk";
import { useStigmer } from "../../hooks";
import { useExecutionStream } from "../useExecutionStream";
import { useLiveAgentExecution } from "../useLiveAgentExecution";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function executionFixture(id: string, phase: ExecutionPhase): AgentExecution {
  const exec = create(AgentExecutionSchema);
  exec.metadata = create(ApiResourceMetadataSchema, { id });
  exec.status = create(AgentExecutionStatusSchema, { phase });
  return exec;
}

/** The stream hook's healthy-idle shape (not subscribed / nothing yet). */
function idleStream() {
  return {
    execution: null,
    phase: ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED,
    isStreaming: false,
    isConnecting: false,
    isReconnecting: false,
    reconnectAttempt: 0,
    error: null,
    connectTimedOut: false,
    isSlow: false,
    reconnect: vi.fn(),
  };
}

const mockUseStigmer = vi.mocked(useStigmer);
const mockUseExecutionStream = vi.mocked(useExecutionStream);

function mockGet(impl: (id: string) => Promise<AgentExecution>) {
  mockUseStigmer.mockReturnValue({
    agentExecution: { get: vi.fn(impl) },
  } as unknown as ReturnType<typeof useStigmer>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseExecutionStream.mockReturnValue(idleStream());
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useLiveAgentExecution", () => {
  it("serves a terminal execution from get() alone and never subscribes", async () => {
    const terminal = executionFixture("aex_1", ExecutionPhase.EXECUTION_COMPLETED);
    mockGet(async () => terminal);

    const { result } = renderHook(() => useLiveAgentExecution("aex_1"));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.execution).toBe(terminal));

    expect(result.current.isLoading).toBe(false);
    expect(result.current.phase).toBe(ExecutionPhase.EXECUTION_COMPLETED);
    expect(result.current.isStreaming).toBe(false);
    // The stream gate must stay closed for a terminal phase — every call
    // (pre-fetch and post-fetch renders alike) passes null.
    for (const call of mockUseExecutionStream.mock.calls) {
      expect(call[0]).toBeNull();
    }
  });

  it("layers the stream once the fetched phase is non-terminal", async () => {
    const running = executionFixture("aex_2", ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockGet(async () => running);

    const { result } = renderHook(() => useLiveAgentExecution("aex_2"));
    await waitFor(() => expect(result.current.execution).not.toBeNull());

    const lastCall =
      mockUseExecutionStream.mock.calls[mockUseExecutionStream.mock.calls.length - 1];
    expect(lastCall[0]).toBe("aex_2");
  });

  it("prefers the streamed snapshot over the fetched one once streaming", async () => {
    const fetched = executionFixture("aex_3", ExecutionPhase.EXECUTION_IN_PROGRESS);
    const streamed = executionFixture("aex_3", ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockGet(async () => fetched);
    mockUseExecutionStream.mockReturnValue({
      ...idleStream(),
      execution: streamed,
      isStreaming: true,
    });

    const { result } = renderHook(() => useLiveAgentExecution("aex_3"));
    await waitFor(() => expect(result.current.execution).toBe(streamed));
    expect(result.current.isStreaming).toBe(true);
  });

  it("treats not-found as execution: null with no error", async () => {
    mockGet(async () => {
      // The SDK client wraps every failure in StigmerError; not-found is the
      // code isNotFound() checks (a raw ConnectError would not match).
      throw new StigmerError("not-found", "execution not found", 5);
    });

    const { result } = renderHook(() => useLiveAgentExecution("aex_missing"));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.execution).toBeNull();
    expect(result.current.error).toBeNull();
    // A not-found fetch must not open a stream (fetched === null).
    for (const call of mockUseExecutionStream.mock.calls) {
      expect(call[0]).toBeNull();
    }
  });

  it("surfaces a non-not-found fetch error", async () => {
    mockGet(async () => {
      throw new StigmerError("internal", "boom", 13);
    });

    const { result } = renderHook(() => useLiveAgentExecution("aex_err"));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toContain("boom");
    expect(result.current.execution).toBeNull();
  });

  it("surfaces the stream's terminal error when the fetch is healthy", async () => {
    const running = executionFixture("aex_4", ExecutionPhase.EXECUTION_IN_PROGRESS);
    const streamError = new Error("stream exhausted retries");
    mockGet(async () => running);
    mockUseExecutionStream.mockReturnValue({
      ...idleStream(),
      error: streamError,
    });

    const { result } = renderHook(() => useLiveAgentExecution("aex_4"));
    // The stream error surfaces synchronously, but the fetched snapshot
    // arrives asynchronously — wait for both so the assertion cannot race
    // the in-flight fetch (the snapshot stays visible alongside the error).
    await waitFor(() => {
      expect(result.current.error).toBe(streamError);
      expect(result.current.execution).toBe(running);
    });
  });

  it("reconnect() retries both the fetch and the stream", async () => {
    const running = executionFixture("aex_5", ExecutionPhase.EXECUTION_IN_PROGRESS);
    const getFn = vi.fn(async () => running);
    mockUseStigmer.mockReturnValue({
      agentExecution: { get: getFn },
    } as unknown as ReturnType<typeof useStigmer>);
    const streamReconnect = vi.fn();
    mockUseExecutionStream.mockReturnValue({
      ...idleStream(),
      reconnect: streamReconnect,
    });

    const { result } = renderHook(() => useLiveAgentExecution("aex_5"));
    await waitFor(() => expect(result.current.execution).toBe(running));

    const callsBefore = getFn.mock.calls.length;
    result.current.reconnect();
    await waitFor(() =>
      expect(getFn.mock.calls.length).toBeGreaterThan(callsBefore),
    );
    expect(streamReconnect).toHaveBeenCalled();
  });

  it("is a stable no-op for a null id", () => {
    const getFn = vi.fn();
    mockUseStigmer.mockReturnValue({
      agentExecution: { get: getFn },
    } as unknown as ReturnType<typeof useStigmer>);

    const { result } = renderHook(() => useLiveAgentExecution(null));

    expect(result.current.execution).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(getFn).not.toHaveBeenCalled();
    for (const call of mockUseExecutionStream.mock.calls) {
      expect(call[0]).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// The { live } visibility gate (T07)
// ---------------------------------------------------------------------------

describe("useLiveAgentExecution { live }", () => {
  it("live: false fetches the snapshot but never subscribes", async () => {
    const running = executionFixture("aex_p1", ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockGet(async () => running);

    const { result } = renderHook(() =>
      useLiveAgentExecution("aex_p1", { live: false }),
    );
    await waitFor(() => expect(result.current.execution).toBe(running));

    // Non-terminal + fetched, yet the gate stays closed on every render.
    for (const call of mockUseExecutionStream.mock.calls) {
      expect(call[0]).toBeNull();
    }
  });

  it("live: true (and omitted) behave identically for a non-terminal execution", async () => {
    const running = executionFixture("aex_p2", ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockGet(async () => running);

    const { result } = renderHook(() =>
      useLiveAgentExecution("aex_p2", { live: true }),
    );
    await waitFor(() => expect(result.current.execution).not.toBeNull());

    const lastCall =
      mockUseExecutionStream.mock.calls[mockUseExecutionStream.mock.calls.length - 1];
    expect(lastCall[0]).toBe("aex_p2");
  });

  it("a terminal execution never streams regardless of live", async () => {
    const terminal = executionFixture("aex_p3", ExecutionPhase.EXECUTION_COMPLETED);
    mockGet(async () => terminal);

    const { result } = renderHook(() =>
      useLiveAgentExecution("aex_p3", { live: true }),
    );
    await waitFor(() => expect(result.current.execution).toBe(terminal));

    for (const call of mockUseExecutionStream.mock.calls) {
      expect(call[0]).toBeNull();
    }
  });

  it("false → true attaches the stream in place", async () => {
    const running = executionFixture("aex_p4", ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockGet(async () => running);

    const { result, rerender } = renderHook(
      ({ live }: { live: boolean }) =>
        useLiveAgentExecution("aex_p4", { live }),
      { initialProps: { live: false } },
    );
    await waitFor(() => expect(result.current.execution).toBe(running));

    let lastCall =
      mockUseExecutionStream.mock.calls[mockUseExecutionStream.mock.calls.length - 1];
    expect(lastCall[0]).toBeNull();

    rerender({ live: true });

    lastCall =
      mockUseExecutionStream.mock.calls[mockUseExecutionStream.mock.calls.length - 1];
    expect(lastCall[0]).toBe("aex_p4");
  });

  it("never rewinds: a stream pause keeps the last-streamed snapshot, not the mount fetch", async () => {
    const fetched = executionFixture("aex_p5", ExecutionPhase.EXECUTION_IN_PROGRESS);
    const streamed = executionFixture("aex_p5", ExecutionPhase.EXECUTION_IN_PROGRESS);
    mockGet(async () => fetched);
    mockUseExecutionStream.mockReturnValue({
      ...idleStream(),
      execution: streamed,
      isStreaming: true,
    });

    const { result, rerender } = renderHook(
      ({ live }: { live: boolean }) =>
        useLiveAgentExecution("aex_p5", { live }),
      { initialProps: { live: true } },
    );
    await waitFor(() => expect(result.current.execution).toBe(streamed));

    // Pause: the stream hook resets to its idle shape (execution: null) —
    // the exact behavior of an unsubscribed useExecutionStream.
    mockUseExecutionStream.mockReturnValue(idleStream());
    rerender({ live: false });

    // The freshest streamed snapshot stays visible; the view never rolls
    // back to the mount-time fetch.
    expect(result.current.execution).toBe(streamed);
  });

  it("does not leak the previous execution's snapshot across an id switch", async () => {
    const first = executionFixture("aex_p6a", ExecutionPhase.EXECUTION_IN_PROGRESS);
    const streamedFirst = executionFixture("aex_p6a", ExecutionPhase.EXECUTION_IN_PROGRESS);
    const second = executionFixture("aex_p6b", ExecutionPhase.EXECUTION_COMPLETED);
    mockGet(async (id) => (id === "aex_p6a" ? first : second));
    mockUseExecutionStream.mockReturnValue({
      ...idleStream(),
      execution: streamedFirst,
      isStreaming: true,
    });

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useLiveAgentExecution(id, { live: true }),
      { initialProps: { id: "aex_p6a" } },
    );
    await waitFor(() => expect(result.current.execution).toBe(streamedFirst));

    // Switch executions; the stream resets while the new fetch is in flight.
    mockUseExecutionStream.mockReturnValue(idleStream());
    rerender({ id: "aex_p6b" });

    // The retained snapshot is keyed by id — it must NOT bleed into the
    // new execution's view.
    expect(result.current.execution).not.toBe(streamedFirst);
    await waitFor(() => expect(result.current.execution).toBe(second));
  });
});
