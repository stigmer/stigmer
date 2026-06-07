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
  onSessionOpened: ReturnType<typeof vi.fn>;
  onSessionClosed: ReturnType<typeof vi.fn>;
  onWorkflowExecutionCreated: ReturnType<typeof vi.fn>;
  onWorkflowExecutionTerminated: ReturnType<typeof vi.fn>;
} {
  return {
    onSessionOpened: vi.fn().mockResolvedValue(undefined),
    onSessionClosed: vi.fn().mockResolvedValue(undefined),
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

  describe("useCreateSession is a pure resource-creation hook", () => {
    // The worker lifecycle moved to the session view (useSessionConversation
    // attaches on open / detaches on close) and the new-session flow's eager
    // attach. Creating a session must NOT touch the adapter on its own.
    it("does not drive the adapter even when target is local", async () => {
      const adapter = createMockAdapter();
      const client = createMockStigmer();

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapperWithAdapter(client, adapter, "local"),
      });

      let created: { sessionId: string } | undefined;
      await act(async () => {
        created = await result.current.create({
          org: "acme",
          agentInstanceId: "ain-123",
        });
      });

      expect(created?.sessionId).toBe("ses-new-1");
      expect(adapter.onSessionOpened).not.toHaveBeenCalled();
      expect(adapter.onSessionClosed).not.toHaveBeenCalled();
      expect(result.current.error).toBeNull();
    });
  });
});
