import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useDefaultAgent } from "../useDefaultAgent";

const STALE_THRESHOLD_MS = 30_000;

function fakeAgent(instanceId: string): Agent {
  return {
    status: { defaultInstanceId: instanceId },
  } as unknown as Agent;
}

function buildMockClient(overrides: {
  getDefault?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    agent: {
      getDefault: overrides.getDefault ?? vi.fn(),
    },
  } as unknown as Stigmer;
}

function makeWrapper(client: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>
      {children}
    </StigmerContext.Provider>
  );
}

function fireVisibilityChange(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    value: state,
    writable: true,
    configurable: true,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useDefaultAgent", () => {
  let getDefaultMock: ReturnType<typeof vi.fn>;
  let client: Stigmer;

  beforeEach(() => {
    getDefaultMock = vi.fn();
    client = buildMockClient({ getDefault: getDefaultMock });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // Basic fetch behavior (no fake timers needed)
  // -----------------------------------------------------------------------

  it("fetches the default agent on mount", async () => {
    const agent = fakeAgent("inst_1");
    getDefaultMock.mockResolvedValueOnce(agent);

    const { result } = renderHook(() => useDefaultAgent("acme"), {
      wrapper: makeWrapper(client),
    });

    expect(result.current.isLoading).toBe(true);

    await act(async () => {});

    expect(result.current.isLoading).toBe(false);
    expect(result.current.agent).toBe(agent);
    expect(result.current.error).toBeNull();
    expect(getDefaultMock).toHaveBeenCalledOnce();
  });

  it("skips fetching when org is null", () => {
    const { result } = renderHook(() => useDefaultAgent(null), {
      wrapper: makeWrapper(client),
    });

    expect(result.current.agent).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(getDefaultMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Retry on transient failure
  // -----------------------------------------------------------------------

  it("retries once on transient failure then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const agent = fakeAgent("inst_retry");
      getDefaultMock
        .mockRejectedValueOnce(new Error("network timeout"))
        .mockResolvedValueOnce(agent);

      const { result } = renderHook(() => useDefaultAgent("acme"), {
        wrapper: makeWrapper(client),
      });

      expect(result.current.isLoading).toBe(true);

      // Flush the rejected first attempt.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      // Advance past the 1s retry delay.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.agent).toBe(agent);
      expect(result.current.error).toBeNull();
      expect(getDefaultMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("surfaces the error after exhausting retries", async () => {
    vi.useFakeTimers();
    try {
      getDefaultMock
        .mockRejectedValueOnce(new Error("fail 1"))
        .mockRejectedValueOnce(new Error("fail 2"));

      const { result } = renderHook(() => useDefaultAgent("acme"), {
        wrapper: makeWrapper(client),
      });

      // Flush first attempt + advance past retry delay + flush retry.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.agent).toBeNull();
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error!.message).toBe("fail 2");
      expect(getDefaultMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  // -----------------------------------------------------------------------
  // Visibility-aware refetch
  // -----------------------------------------------------------------------

  it("refetches when document becomes visible after stale threshold", async () => {
    vi.useFakeTimers();
    try {
      const agent1 = fakeAgent("inst_old");
      const agent2 = fakeAgent("inst_new");
      getDefaultMock
        .mockResolvedValueOnce(agent1)
        .mockResolvedValueOnce(agent2);

      const { result } = renderHook(() => useDefaultAgent("acme"), {
        wrapper: makeWrapper(client),
      });

      // Flush initial fetch.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.agent).toBe(agent1);
      expect(getDefaultMock).toHaveBeenCalledTimes(1);

      // Simulate idle period longer than the stale threshold.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS + 1_000);
      });

      // Simulate app coming back to foreground.
      act(() => {
        fireVisibilityChange("visible");
      });

      // Flush the refetch.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.agent).toBe(agent2);
      expect(getDefaultMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does NOT refetch when visible within the stale window", async () => {
    vi.useFakeTimers();
    try {
      const agent = fakeAgent("inst_fresh");
      getDefaultMock.mockResolvedValueOnce(agent);

      const { result } = renderHook(() => useDefaultAgent("acme"), {
        wrapper: makeWrapper(client),
      });

      // Flush initial fetch.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.agent).toBe(agent);
      expect(getDefaultMock).toHaveBeenCalledTimes(1);

      // Only a short time passes — well within stale threshold.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000);
      });

      act(() => {
        fireVisibilityChange("visible");
      });

      expect(getDefaultMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not refetch on hidden event", async () => {
    vi.useFakeTimers();
    try {
      const agent = fakeAgent("inst_1");
      getDefaultMock.mockResolvedValueOnce(agent);

      const { result } = renderHook(() => useDefaultAgent("acme"), {
        wrapper: makeWrapper(client),
      });

      // Flush initial fetch.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.agent).toBe(agent);

      // Advance well past stale threshold.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(STALE_THRESHOLD_MS + 1_000);
      });

      // Hidden (not visible) should not trigger refetch.
      act(() => {
        fireVisibilityChange("hidden");
      });

      expect(getDefaultMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  // -----------------------------------------------------------------------
  // Manual refetch
  // -----------------------------------------------------------------------

  it("recovers via manual refetch after initial failure", async () => {
    vi.useFakeTimers();
    try {
      const agent = fakeAgent("inst_recovered");
      getDefaultMock
        .mockRejectedValueOnce(new Error("initial fail"))
        .mockRejectedValueOnce(new Error("retry fail"))
        .mockResolvedValueOnce(agent);

      const { result } = renderHook(() => useDefaultAgent("acme"), {
        wrapper: makeWrapper(client),
      });

      // Exhaust initial attempt + retry.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });

      expect(result.current.error).not.toBeNull();

      // Manual refetch triggers recovery.
      act(() => {
        result.current.refetch();
      });

      // Flush the refetch.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.agent).toBe(agent);
      expect(result.current.error).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
