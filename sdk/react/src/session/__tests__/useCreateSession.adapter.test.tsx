/**
 * useCreateSession creates the session resource and nothing more: the
 * runner adapter's worker lifecycle belongs to the session view and the
 * new-session flow, so creating a local session never drives it.
 */
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { ExecutionTargetContext } from "@stigmer/react-core/internal";
import { RunnerAdapterContext } from "@stigmer/react-core/internal";
import type { RunnerAdapter } from "@stigmer/react-core";
import { useCreateSession } from "../useCreateSession";

function createMockAdapter(): RunnerAdapter & {
  onSessionOpened: ReturnType<typeof vi.fn>;
  onSessionClosed: ReturnType<typeof vi.fn>;
} {
  return {
    onSessionOpened: vi.fn().mockResolvedValue(undefined),
    onSessionClosed: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockStigmer(overrides: {
  create?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    session: {
      create: overrides.create ?? vi.fn().mockResolvedValue({
        metadata: { id: "ses_new-1" },
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
        agentRef: { org: "acme", slug: "helper" },
      });
    });

    expect(created?.sessionId).toBe("ses_new-1");
    expect(adapter.onSessionOpened).not.toHaveBeenCalled();
    expect(adapter.onSessionClosed).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});
