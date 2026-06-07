import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ExecutionTarget } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { ExecutionTargetContext } from "../../execution-target-context";
import { RunnerAdapterContext } from "../../runner-adapter";
import type { RunnerAdapter } from "../../runner-adapter";
import { useLocalSessionWorker } from "../useLocalSessionWorker";

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

/** Build a minimal Session with a given execution target. */
function makeSession(target: ExecutionTarget): Session {
  return { spec: { executionTarget: target } } as Session;
}

function wrapper(
  adapter: RunnerAdapter | null,
  contextTarget?: "local" | "cloud",
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <ExecutionTargetContext.Provider value={contextTarget}>
        <RunnerAdapterContext.Provider value={adapter}>
          {children}
        </RunnerAdapterContext.Provider>
      </ExecutionTargetContext.Provider>
    );
  };
}

describe("useLocalSessionWorker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("attaches the worker on mount for a loaded local session", () => {
    const adapter = createMockAdapter();
    renderHook(
      () => useLocalSessionWorker("ses-1", makeSession(ExecutionTarget.LOCAL)),
      { wrapper: wrapper(adapter, "local") },
    );

    expect(adapter.onSessionOpened).toHaveBeenCalledTimes(1);
    expect(adapter.onSessionOpened).toHaveBeenCalledWith("ses-1");
    expect(adapter.onSessionClosed).not.toHaveBeenCalled();
  });

  it("detaches the worker on unmount", () => {
    const adapter = createMockAdapter();
    const { unmount } = renderHook(
      () => useLocalSessionWorker("ses-1", makeSession(ExecutionTarget.LOCAL)),
      { wrapper: wrapper(adapter, "local") },
    );

    unmount();

    expect(adapter.onSessionClosed).toHaveBeenCalledTimes(1);
    expect(adapter.onSessionClosed).toHaveBeenCalledWith("ses-1");
  });

  it("is a no-op when no adapter is configured", () => {
    // No adapter → nothing to assert beyond "does not throw".
    expect(() =>
      renderHook(
        () => useLocalSessionWorker("ses-1", makeSession(ExecutionTarget.LOCAL)),
        { wrapper: wrapper(null, "local") },
      ),
    ).not.toThrow();
  });

  it("does not attach for a cloud session", () => {
    const adapter = createMockAdapter();
    renderHook(
      () => useLocalSessionWorker("ses-1", makeSession(ExecutionTarget.CLOUD)),
      { wrapper: wrapper(adapter, "local") },
    );

    expect(adapter.onSessionOpened).not.toHaveBeenCalled();
  });

  it("does not attach until the session has loaded", () => {
    const adapter = createMockAdapter();
    const { rerender } = renderHook(
      ({ session }: { session: Session | null }) =>
        useLocalSessionWorker("ses-1", session),
      {
        wrapper: wrapper(adapter, "local"),
        initialProps: { session: null } as { session: Session | null },
      },
    );

    // Loading: target unknown → no attach yet.
    expect(adapter.onSessionOpened).not.toHaveBeenCalled();

    // Loaded as local → attaches now.
    rerender({ session: makeSession(ExecutionTarget.LOCAL) });
    expect(adapter.onSessionOpened).toHaveBeenCalledTimes(1);
  });

  it("falls back to the provider target when the session spec is unspecified", () => {
    const adapter = createMockAdapter();
    renderHook(
      () =>
        useLocalSessionWorker(
          "ses-1",
          makeSession(ExecutionTarget.UNSPECIFIED),
        ),
      { wrapper: wrapper(adapter, "local") },
    );

    expect(adapter.onSessionOpened).toHaveBeenCalledWith("ses-1");
  });

  it("does not attach when spec is unspecified and provider target is not local", () => {
    const adapter = createMockAdapter();
    renderHook(
      () =>
        useLocalSessionWorker(
          "ses-1",
          makeSession(ExecutionTarget.UNSPECIFIED),
        ),
      { wrapper: wrapper(adapter, "cloud") },
    );

    expect(adapter.onSessionOpened).not.toHaveBeenCalled();
  });

  it("detaches the old session and attaches the new one on sessionId change", () => {
    const adapter = createMockAdapter();
    const { rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) =>
        useLocalSessionWorker(sessionId, makeSession(ExecutionTarget.LOCAL)),
      { wrapper: wrapper(adapter, "local"), initialProps: { sessionId: "ses-1" } },
    );

    expect(adapter.onSessionOpened).toHaveBeenCalledWith("ses-1");

    rerender({ sessionId: "ses-2" });

    expect(adapter.onSessionClosed).toHaveBeenCalledWith("ses-1");
    expect(adapter.onSessionOpened).toHaveBeenCalledWith("ses-2");
  });

  // DD-010 regression guard: useSessionConversation refetches the session
  // constantly. A refetch that returns a new object with the same execution
  // target must NOT thrash the runner (no extra open/close).
  it("does not re-attach when a refetch returns a new session object with the same target", () => {
    const adapter = createMockAdapter();
    const { rerender } = renderHook(
      ({ session }: { session: Session }) =>
        useLocalSessionWorker("ses-1", session),
      {
        wrapper: wrapper(adapter, "local"),
        initialProps: { session: makeSession(ExecutionTarget.LOCAL) },
      },
    );

    expect(adapter.onSessionOpened).toHaveBeenCalledTimes(1);

    // Simulate three refetches returning fresh objects with identical target.
    rerender({ session: makeSession(ExecutionTarget.LOCAL) });
    rerender({ session: makeSession(ExecutionTarget.LOCAL) });
    rerender({ session: makeSession(ExecutionTarget.LOCAL) });

    expect(adapter.onSessionOpened).toHaveBeenCalledTimes(1);
    expect(adapter.onSessionClosed).not.toHaveBeenCalled();
  });

  it("swallows adapter errors so the session view never crashes", () => {
    const adapter = createMockAdapter();
    adapter.onSessionOpened.mockRejectedValue(new Error("runner down"));

    expect(() =>
      renderHook(
        () => useLocalSessionWorker("ses-1", makeSession(ExecutionTarget.LOCAL)),
        { wrapper: wrapper(adapter, "local") },
      ),
    ).not.toThrow();
  });
});
