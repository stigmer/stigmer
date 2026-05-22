import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../context";
import { FetchCacheContext } from "../internal/FetchCacheProvider";
import { ExecutionTargetContext } from "../execution-target-context";
import { RunnerAdapterContext, useRunnerAdapter } from "../runner-adapter";
import type { RunnerAdapter } from "../runner-adapter";
import { useCreateSession } from "../session/useCreateSession";

function createMockAdapter(): RunnerAdapter & {
  onSessionCreated: ReturnType<typeof vi.fn>;
  onSessionTerminated: ReturnType<typeof vi.fn>;
  onWorkflowExecutionCreated: ReturnType<typeof vi.fn>;
  onWorkflowExecutionTerminated: ReturnType<typeof vi.fn>;
} {
  return {
    onSessionCreated: vi.fn().mockResolvedValue(undefined),
    onSessionTerminated: vi.fn().mockResolvedValue(undefined),
    onWorkflowExecutionCreated: vi.fn().mockResolvedValue(undefined),
    onWorkflowExecutionTerminated: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockStigmer(overrides: {
  create?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    agent: {
      getByReference: vi.fn().mockResolvedValue({
        status: { defaultInstanceId: "ain-default" },
      }),
    },
    session: {
      create: overrides.create ?? vi.fn().mockResolvedValue({
        metadata: { id: "ses-new-1" },
      }),
    },
  } as never;
}

function wrapperWithAdapter(
  client: unknown,
  adapter: RunnerAdapter | null,
  executionTarget?: "local" | "cloud",
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <ExecutionTargetContext.Provider value={executionTarget}>
          <RunnerAdapterContext.Provider value={adapter}>
            <StigmerContext.Provider value={client as never}>
              {children}
            </StigmerContext.Provider>
          </RunnerAdapterContext.Provider>
        </ExecutionTargetContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

describe("RunnerAdapter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("useRunnerAdapter", () => {
    it("returns null when no adapter is provided", () => {
      const { result } = renderHook(() => useRunnerAdapter(), {
        wrapper: wrapperWithAdapter(createMockStigmer(), null),
      });
      expect(result.current).toBeNull();
    });

    it("returns the adapter when provided", () => {
      const adapter = createMockAdapter();
      const { result } = renderHook(() => useRunnerAdapter(), {
        wrapper: wrapperWithAdapter(createMockStigmer(), adapter),
      });
      expect(result.current).toBe(adapter);
    });
  });

  describe("useCreateSession + adapter integration", () => {
    it("calls adapter.onSessionCreated when target is local", async () => {
      const adapter = createMockAdapter();
      const client = createMockStigmer();

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapperWithAdapter(client, adapter, "local"),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentInstanceId: "ain-123",
        });
      });

      expect(adapter.onSessionCreated).toHaveBeenCalledTimes(1);
      expect(adapter.onSessionCreated).toHaveBeenCalledWith("ses-new-1");
    });

    it("does NOT call adapter when target is cloud", async () => {
      const adapter = createMockAdapter();
      const client = createMockStigmer();

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapperWithAdapter(client, adapter, "cloud"),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentInstanceId: "ain-123",
        });
      });

      expect(adapter.onSessionCreated).not.toHaveBeenCalled();
    });

    it("does NOT call adapter when target is unspecified", async () => {
      const adapter = createMockAdapter();
      const client = createMockStigmer();

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapperWithAdapter(client, adapter, undefined),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentInstanceId: "ain-123",
        });
      });

      expect(adapter.onSessionCreated).not.toHaveBeenCalled();
    });

    it("does NOT call adapter when adapter is null", async () => {
      const client = createMockStigmer();

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapperWithAdapter(client, null, "local"),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentInstanceId: "ain-123",
        });
      });

      // No error — adapter call is simply skipped
      expect(result.current.error).toBeNull();
    });

    it("propagates adapter errors to the caller", async () => {
      const adapter = createMockAdapter();
      adapter.onSessionCreated.mockRejectedValue(new Error("Runner failed to start"));
      const client = createMockStigmer();

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapperWithAdapter(client, adapter, "local"),
      });

      let caughtError: Error | undefined;
      await act(async () => {
        try {
          await result.current.create({
            org: "acme",
            agentInstanceId: "ain-123",
          });
        } catch (err) {
          caughtError = err as Error;
        }
      });

      expect(caughtError).toBeTruthy();
      expect(caughtError!.message).toBe("Runner failed to start");
    });

    it("uses per-call executionTarget over context for adapter guard", async () => {
      const adapter = createMockAdapter();
      const client = createMockStigmer();

      // Context is "cloud" but per-call is "local"
      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapperWithAdapter(client, adapter, "cloud"),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentInstanceId: "ain-123",
          executionTarget: "local",
        });
      });

      expect(adapter.onSessionCreated).toHaveBeenCalledTimes(1);
    });
  });
});
