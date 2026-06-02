import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useRecentActivity } from "../useRecentActivity";

vi.mock("../../organization/OrgProvider", () => ({
  useActiveOrgSlug: () => "test-org",
}));

function createMockStigmer(overrides: {
  listRecentActivity?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    activity: {
      listRecentActivity:
        overrides.listRecentActivity ??
        vi.fn().mockResolvedValue({ entries: [] }),
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <FetchCacheContext.Provider value={null}>
        <StigmerContext.Provider value={client as never}>
          {children}
        </StigmerContext.Provider>
      </FetchCacheContext.Provider>
    );
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("useRecentActivity — optimistic prepend", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("prependOptimistic adds entry at position 0", async () => {
    const listRecentActivity = vi.fn().mockResolvedValue({ entries: [] });
    const client = createMockStigmer({ listRecentActivity });

    const { result } = renderHook(() => useRecentActivity(), {
      wrapper: wrapper(client),
    });

    await flush();
    expect(result.current.entries).toHaveLength(0);

    act(() => {
      result.current.prependOptimistic({
        id: "wfx_new",
        type: "workflow_execution",
        subject: "New Execution",
      });
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].id).toBe("wfx_new");
    expect(result.current.entries[0].type).toBe("workflow_execution");
    expect(result.current.entries[0].subject).toBe("New Execution");
    expect(result.current.entries[0].updatedAt.getTime()).toBeGreaterThan(0);
  });

  it("optimistic entry appears above server entries", async () => {
    const serverEntries = [
      { id: "old_1", type: "session", subject: "Old session", updatedAt: { seconds: BigInt(1716800000), nanos: 0 }, status: "" },
      { id: "old_2", type: "workflow_execution", subject: "Old exec", updatedAt: { seconds: BigInt(1716790000), nanos: 0 }, status: "completed" },
    ];
    const listRecentActivity = vi.fn().mockResolvedValue({ entries: serverEntries });
    const client = createMockStigmer({ listRecentActivity });

    const { result } = renderHook(() => useRecentActivity(), {
      wrapper: wrapper(client),
    });

    await flush();
    expect(result.current.entries).toHaveLength(2);

    act(() => {
      result.current.prependOptimistic({
        id: "wfx_brand_new",
        type: "workflow_execution",
        subject: "Brand New Execution",
      });
    });

    expect(result.current.entries).toHaveLength(3);
    expect(result.current.entries[0].id).toBe("wfx_brand_new");
    expect(result.current.entries[1].id).toBe("old_1");
    expect(result.current.entries[2].id).toBe("old_2");
  });

  it("optimistic entry is deduplicated when server data includes its ID", async () => {
    let fetchCount = 0;
    const listRecentActivity = vi.fn().mockImplementation(async () => {
      fetchCount++;
      if (fetchCount === 1) {
        return { entries: [] };
      }
      return {
        entries: [
          { id: "wfx_new", type: "workflow_execution", subject: "Server-resolved name", updatedAt: { seconds: BigInt(1716810000), nanos: 0 }, status: "" },
        ],
      };
    });
    const client = createMockStigmer({ listRecentActivity });

    const { result } = renderHook(() => useRecentActivity(), {
      wrapper: wrapper(client),
    });

    await flush();

    act(() => {
      result.current.prependOptimistic({
        id: "wfx_new",
        type: "workflow_execution",
        subject: "Loading\u2026",
      });
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].subject).toBe("Loading\u2026");

    // Trigger refetch — server now returns the entry
    act(() => {
      result.current.refetch();
    });
    await flush();

    await waitFor(() => {
      expect(result.current.entries).toHaveLength(1);
      expect(result.current.entries[0].subject).toBe("Server-resolved name");
    });
  });

  it("does not duplicate if prependOptimistic is called twice with same id", async () => {
    const listRecentActivity = vi.fn().mockResolvedValue({ entries: [] });
    const client = createMockStigmer({ listRecentActivity });

    const { result } = renderHook(() => useRecentActivity(), {
      wrapper: wrapper(client),
    });

    await flush();

    act(() => {
      result.current.prependOptimistic({
        id: "wfx_dup",
        type: "workflow_execution",
        subject: "First call",
      });
    });

    act(() => {
      result.current.prependOptimistic({
        id: "wfx_dup",
        type: "workflow_execution",
        subject: "Second call",
      });
    });

    expect(result.current.entries).toHaveLength(1);
    expect(result.current.entries[0].subject).toBe("First call");
  });
});
