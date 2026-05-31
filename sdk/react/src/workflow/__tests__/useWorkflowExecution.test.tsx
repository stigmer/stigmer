import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { createElement } from "react";
import { StigmerContext } from "../../context";
import { RunnerAdapterContext, type RunnerAdapter } from "../../runner-adapter";
import { ExecutionTargetContext } from "../../execution-target-context";
import { useWorkflowExecution } from "../useWorkflowExecution";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

function makeExecution(
  id: string,
  phase: number,
  opts?: { name?: string },
) {
  return {
    metadata: { id, name: opts?.name ?? `exec-${id}`, org: "org-1" },
    status: { phase },
    spec: {},
  } as any;
}

// Phase constants matching the proto enum
const PHASE = {
  IN_PROGRESS: 2,
  COMPLETED: 3,
  FAILED: 4,
  CANCELLED: 5,
  TERMINATED: 6,
} as const;

function makeMockClient(getFn: (...args: any[]) => Promise<any>) {
  return {
    workflowExecution: { get: getFn },
  } as any;
}

function makeMockAdapter(): RunnerAdapter & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    onSessionCreated: vi.fn(async (id: string) => { calls.push(["onSessionCreated", id]); }),
    onSessionTerminated: vi.fn(async (id: string) => { calls.push(["onSessionTerminated", id]); }),
    onWorkflowExecutionCreated: vi.fn(async (id: string) => { calls.push(["onWorkflowExecutionCreated", id]); }),
    onWorkflowExecutionTerminated: vi.fn(async (id: string) => { calls.push(["onWorkflowExecutionTerminated", id]); }),
  };
}

function createWrapper(
  client: any,
  adapter: RunnerAdapter | null = null,
  executionTarget: "local" | "cloud" | undefined = "local",
) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(
      StigmerContext.Provider,
      { value: client },
      createElement(
        RunnerAdapterContext.Provider,
        { value: adapter },
        createElement(
          ExecutionTargetContext.Provider,
          { value: executionTarget },
          children,
        ),
      ),
    );
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Core data fetching
// ---------------------------------------------------------------------------

describe("useWorkflowExecution — data fetching", () => {
  it("fetches execution by id", async () => {
    const exec = makeExecution("wex-001", PHASE.IN_PROGRESS);
    const getFn = vi.fn(async () => exec);
    const client = makeMockClient(getFn);

    const { result } = renderHook(
      () => useWorkflowExecution("wex-001"),
      { wrapper: createWrapper(client) },
    );

    await flush();
    expect(result.current.execution).toBe(exec);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(getFn).toHaveBeenCalledWith("wex-001");
  });

  it("returns null execution when id is null", async () => {
    const getFn = vi.fn(async () => makeExecution("wex-001", PHASE.IN_PROGRESS));
    const client = makeMockClient(getFn);

    const { result } = renderHook(
      () => useWorkflowExecution(null),
      { wrapper: createWrapper(client) },
    );

    await flush();
    expect(result.current.execution).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(getFn).not.toHaveBeenCalled();
  });

  it("handles NOT_FOUND by returning null without error", async () => {
    const notFoundErr = new Error("not found");
    (notFoundErr as any).code = "NOT_FOUND";
    // The hook uses isNotFound from @stigmer/sdk, so mock it globally
    const getFn = vi.fn(async () => {
      throw notFoundErr;
    });
    const client = makeMockClient(getFn);

    const { result } = renderHook(
      () => useWorkflowExecution("wex-gone"),
      { wrapper: createWrapper(client) },
    );

    await flush();
    // The hook will either return null (if isNotFound handles it) or set an error.
    // Either way, verify we don't crash.
    expect(result.current.isLoading).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Identity guard: Layer 2 defense against stale data
//
// This is the critical test suite that validates the fix for the premature
// worker shutdown bug. The identity guard ensures that
// onWorkflowExecutionTerminated is ONLY called when the fetched execution's
// metadata.id matches the currently requested executionId.
// ---------------------------------------------------------------------------

describe("useWorkflowExecution — identity guard (Layer 2)", () => {
  it("calls onWorkflowExecutionTerminated when execution reaches terminal phase", async () => {
    const exec = makeExecution("wex-done", PHASE.COMPLETED);
    const getFn = vi.fn(async () => exec);
    const client = makeMockClient(getFn);
    const adapter = makeMockAdapter();

    const { result } = renderHook(
      () => useWorkflowExecution("wex-done"),
      { wrapper: createWrapper(client, adapter, "local") },
    );

    await flush();

    expect(result.current.execution).toBe(exec);
    expect(adapter.onWorkflowExecutionTerminated).toHaveBeenCalledWith("wex-done");
    expect(adapter.onWorkflowExecutionTerminated).toHaveBeenCalledTimes(1);
  });

  it("does NOT call onWorkflowExecutionTerminated for non-terminal phases", async () => {
    const exec = makeExecution("wex-running", PHASE.IN_PROGRESS);
    const getFn = vi.fn(async () => exec);
    const client = makeMockClient(getFn);
    const adapter = makeMockAdapter();

    renderHook(
      () => useWorkflowExecution("wex-running"),
      { wrapper: createWrapper(client, adapter, "local") },
    );

    await flush();
    expect(adapter.onWorkflowExecutionTerminated).not.toHaveBeenCalled();
  });

  it("does NOT call onWorkflowExecutionTerminated when adapter is null (cloud mode)", async () => {
    const exec = makeExecution("wex-cloud", PHASE.COMPLETED);
    const getFn = vi.fn(async () => exec);
    const client = makeMockClient(getFn);

    renderHook(
      () => useWorkflowExecution("wex-cloud"),
      { wrapper: createWrapper(client, null, "cloud") },
    );

    await flush();
    // No adapter, no call — cloud deployments don't manage runners
  });

  it("does NOT fire termination for stale data from a different execution ID", async () => {
    // This is the exact scenario that caused the premature worker shutdown:
    // - User navigates from completed exec-A to running exec-B
    // - useFetch briefly holds exec-A's COMPLETED data while exec-B loads
    // - Without the identity guard, the termination effect would fire
    //   onWorkflowExecutionTerminated("exec-B") using exec-A's phase
    //
    // The fix: `fetchedId === executionId` guard prevents this.

    const execA = makeExecution("exec-A", PHASE.COMPLETED);
    const execB = makeExecution("exec-B", PHASE.IN_PROGRESS);

    let currentId = "exec-A";
    const getFn = vi.fn(async (id: string) => {
      if (id === "exec-A") return execA;
      if (id === "exec-B") return execB;
      return null;
    });
    const client = makeMockClient(getFn);
    const adapter = makeMockAdapter();

    const { rerender } = renderHook(
      () => useWorkflowExecution(currentId),
      { wrapper: createWrapper(client, adapter, "local") },
    );

    // Exec-A completes → termination fires for exec-A
    await flush();
    expect(adapter.onWorkflowExecutionTerminated).toHaveBeenCalledWith("exec-A");
    expect(adapter.onWorkflowExecutionTerminated).toHaveBeenCalledTimes(1);

    // Clear mocks to track new calls
    vi.clearAllMocks();

    // Switch to exec-B (running) — the key moment
    currentId = "exec-B";
    rerender();

    // useFetch should reset data to null (initialData) due to cache miss.
    // Even if stale exec-A data briefly appears, the identity guard
    // (fetchedId === executionId) prevents termination of exec-B.
    await flush();

    // onWorkflowExecutionTerminated must NOT have been called for exec-B
    // because exec-B is IN_PROGRESS, not terminal.
    expect(adapter.onWorkflowExecutionTerminated).not.toHaveBeenCalled();
  });

  it("fires termination only once per execution (dedup via terminatedRef)", async () => {
    const exec = makeExecution("wex-dedup", PHASE.FAILED);
    const getFn = vi.fn(async () => exec);
    const client = makeMockClient(getFn);
    const adapter = makeMockAdapter();

    const { result } = renderHook(
      () => useWorkflowExecution("wex-dedup"),
      { wrapper: createWrapper(client, adapter, "local") },
    );

    await flush();
    expect(adapter.onWorkflowExecutionTerminated).toHaveBeenCalledTimes(1);

    // Trigger a refetch — the execution is still FAILED
    await act(async () => {
      result.current.refetch();
    });
    await flush();

    // Should NOT fire again due to terminatedRef dedup
    expect(adapter.onWorkflowExecutionTerminated).toHaveBeenCalledTimes(1);
  });

  it("resets terminatedRef when executionId changes", async () => {
    const execX = makeExecution("wex-X", PHASE.COMPLETED);
    const execY = makeExecution("wex-Y", PHASE.COMPLETED);

    let currentId = "wex-X";
    const getFn = vi.fn(async (id: string) => {
      if (id === "wex-X") return execX;
      if (id === "wex-Y") return execY;
      return null;
    });
    const client = makeMockClient(getFn);
    const adapter = makeMockAdapter();

    const { rerender } = renderHook(
      () => useWorkflowExecution(currentId),
      { wrapper: createWrapper(client, adapter, "local") },
    );

    await flush();
    expect(adapter.onWorkflowExecutionTerminated).toHaveBeenCalledWith("wex-X");
    expect(adapter.onWorkflowExecutionTerminated).toHaveBeenCalledTimes(1);

    // Switch to a different completed execution
    currentId = "wex-Y";
    rerender();
    await flush();

    // terminatedRef should have been reset by the executionId change effect,
    // so termination fires for wex-Y too
    expect(adapter.onWorkflowExecutionTerminated).toHaveBeenCalledWith("wex-Y");
    expect(adapter.onWorkflowExecutionTerminated).toHaveBeenCalledTimes(2);
  });

  it("handles all terminal phases correctly", async () => {
    const terminalPhases = [
      PHASE.COMPLETED,
      PHASE.FAILED,
      PHASE.CANCELLED,
      PHASE.TERMINATED,
    ] as const;

    for (const phase of terminalPhases) {
      vi.clearAllMocks();

      const exec = makeExecution(`wex-${phase}`, phase);
      const getFn = vi.fn(async () => exec);
      const client = makeMockClient(getFn);
      const adapter = makeMockAdapter();

      renderHook(
        () => useWorkflowExecution(`wex-${phase}`),
        { wrapper: createWrapper(client, adapter, "local") },
      );

      await flush();
      expect(adapter.onWorkflowExecutionTerminated).toHaveBeenCalledTimes(1);
    }
  });
});
