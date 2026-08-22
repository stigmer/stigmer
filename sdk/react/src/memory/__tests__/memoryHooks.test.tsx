import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { MemorySchema, type Memory } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/api_pb";
import { MemoryLifecycleState } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/enum_pb";
import { MemoryListSchema } from "@stigmer/protos/ai/stigmer/agentic/memory/v1/io_pb";
import { StigmerError } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useMemories } from "../useMemories";
import { useMemory } from "../useMemory";
import { useConfirmMemory } from "../useConfirmMemory";
import { useRejectMemory } from "../useRejectMemory";
import { useDeleteMemory } from "../useDeleteMemory";
import { useUpdateMemoryContent } from "../useUpdateMemoryContent";
import { groupMemoriesByLifecycle, formatMemoryProvenance } from "../memoryGroups";

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

function makeMemory(
  id: string,
  state: MemoryLifecycleState,
  content = "A fact.",
): Memory {
  return create(MemorySchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Memory",
    metadata: { id, name: id, slug: id, org: "test-org" },
    spec: { content },
    status: { lifecycleState: state },
  });
}

const PROPOSED = makeMemory("mem_proposed", MemoryLifecycleState.lifecycle_state_proposed);
const CONFIRMED = makeMemory("mem_confirmed", MemoryLifecycleState.lifecycle_state_confirmed);
const REJECTED = makeMemory("mem_rejected", MemoryLifecycleState.lifecycle_state_rejected);

beforeEach(() => vi.clearAllMocks());

// ---------------------------------------------------------------------------
// Data hook
// ---------------------------------------------------------------------------

describe("useMemories", () => {
  it("fetches all memories in one cap-sized page", async () => {
    const list = vi
      .fn()
      .mockResolvedValue(create(MemoryListSchema, { totalCount: 2, items: [PROPOSED, CONFIRMED] }));
    const client = { memory: { list } };

    const { result } = renderHook(() => useMemories("test-org"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.memories).toHaveLength(2);
    expect(result.current.error).toBeNull();
    // One page of exactly the server cap fetches everything by
    // construction — the list needs no pagination UI.
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "test-org",
        pageInfo: expect.objectContaining({ num: 1, size: 100 }),
      }),
    );
  });

  it("skips fetching when org is null", () => {
    const list = vi.fn();
    const client = { memory: { list } };

    const { result } = renderHook(() => useMemories(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.memories).toEqual([]);
    expect(list).not.toHaveBeenCalled();
  });

  it("surfaces list errors", async () => {
    const failure = new Error("boom");
    const client = { memory: { list: vi.fn().mockRejectedValue(failure) } };

    const { result } = renderHook(() => useMemories("test-org"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe(failure);
    expect(result.current.memories).toEqual([]);
  });
});

describe("useMemory", () => {
  it("fetches one record by id", async () => {
    const get = vi.fn().mockResolvedValue(PROPOSED);
    const client = { memory: { get } };

    const { result } = renderHook(() => useMemory("mem_proposed"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.memory).toBe(PROPOSED);
    expect(result.current.notFound).toBe(false);
    expect(result.current.error).toBeNull();
    expect(get).toHaveBeenCalledWith("mem_proposed");
  });

  it("reports a deleted record as the notFound STATE, never an error", async () => {
    // Deletion is the consent-revocation mechanism — a consumer must
    // render "no longer stored", not a failure.
    const get = vi
      .fn()
      .mockRejectedValue(new StigmerError("not-found", "memory not found", 5));
    const client = { memory: { get } };

    const { result } = renderHook(() => useMemory("mem_gone"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.memory).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it("propagates every other failure as an error", async () => {
    const failure = new StigmerError("unavailable", "server down", 14);
    const client = { memory: { get: vi.fn().mockRejectedValue(failure) } };

    const { result } = renderHook(() => useMemory("mem_x"), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe(failure);
    expect(result.current.notFound).toBe(false);
  });

  it("skips fetching when id is null", () => {
    const get = vi.fn();
    const client = { memory: { get } };

    const { result } = renderHook(() => useMemory(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.memory).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Decision hooks
// ---------------------------------------------------------------------------

describe("decision hooks", () => {
  it("useConfirmMemory calls memory.confirm and resolves", async () => {
    const confirm = vi.fn().mockResolvedValue(CONFIRMED);
    const client = { memory: { confirm } };

    const { result } = renderHook(() => useConfirmMemory(), {
      wrapper: wrapper(client),
    });

    const confirmed = await result.current.confirmMemory("mem_proposed");
    expect(confirmed).toBe(CONFIRMED);
    expect(confirm).toHaveBeenCalledWith("mem_proposed");
    await waitFor(() => expect(result.current.isConfirming).toBe(false));
    expect(result.current.error).toBeNull();
  });

  it("useRejectMemory surfaces errors and rethrows", async () => {
    const failure = new Error("memory was confirmed — delete it to stop it from being recalled");
    const client = { memory: { reject: vi.fn().mockRejectedValue(failure) } };

    const { result } = renderHook(() => useRejectMemory(), {
      wrapper: wrapper(client),
    });

    await expect(result.current.rejectMemory("mem_confirmed")).rejects.toBe(failure);
    await waitFor(() => expect(result.current.error).toBe(failure));
    result.current.clearError();
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it("useDeleteMemory calls memory.delete", async () => {
    const del = vi.fn().mockResolvedValue(REJECTED);
    const client = { memory: { delete: del } };

    const { result } = renderHook(() => useDeleteMemory(), {
      wrapper: wrapper(client),
    });

    await result.current.deleteMemory("mem_rejected");
    expect(del).toHaveBeenCalledWith("mem_rejected");
  });

  it("useUpdateMemoryContent maps through toMemoryUpdateInput and overrides only content", async () => {
    const update = vi.fn().mockResolvedValue(CONFIRMED);
    const client = { memory: { update } };

    const { result } = renderHook(() => useUpdateMemoryContent(), {
      wrapper: wrapper(client),
    });

    await result.current.updateContent(CONFIRMED, "Edited fact.");
    // The wipe-safe rule: the loaded record's identity and immutable
    // fields ride along; only content changes.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "mem_confirmed",
        org: "test-org",
        content: "Edited fact.",
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Grouping helpers
// ---------------------------------------------------------------------------

describe("groupMemoriesByLifecycle", () => {
  it("buckets by state and preserves input order within buckets", () => {
    const secondProposed = makeMemory(
      "mem_proposed_2",
      MemoryLifecycleState.lifecycle_state_proposed,
    );
    const groups = groupMemoriesByLifecycle([
      CONFIRMED,
      PROPOSED,
      REJECTED,
      secondProposed,
    ]);

    expect(groups.proposed.map((m) => m.metadata?.id)).toEqual([
      "mem_proposed",
      "mem_proposed_2",
    ]);
    expect(groups.confirmed.map((m) => m.metadata?.id)).toEqual(["mem_confirmed"]);
    expect(groups.rejected.map((m) => m.metadata?.id)).toEqual(["mem_rejected"]);
  });

  it("buckets the impossible unspecified state with proposals, never hiding it", () => {
    const zombie = makeMemory("mem_zombie", MemoryLifecycleState.lifecycle_state_unspecified);
    const groups = groupMemoriesByLifecycle([zombie]);
    expect(groups.proposed).toHaveLength(1);
  });
});

describe("formatMemoryProvenance", () => {
  it("names the proposing agent and session", () => {
    const memory = create(MemorySchema, {
      metadata: { id: "mem_x", org: "test-org" },
      spec: {
        content: "A fact.",
        provenance: { agentId: "agt_1", sessionId: "ses_1" },
      },
    });
    expect(formatMemoryProvenance(memory)).toBe(
      "Proposed by agent agt_1 in session ses_1",
    );
  });

  it("returns null for records without provenance (created directly)", () => {
    expect(formatMemoryProvenance(PROPOSED)).toBeNull();
  });
});
