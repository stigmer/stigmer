import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useCreateAgentInstance } from "../useCreateAgentInstance";
import { useUpdateAgentInstance } from "../useUpdateAgentInstance";
import { useDeleteAgentInstance } from "../useDeleteAgentInstance";
import { useAgentInstances } from "../useAgentInstances";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(id = "ain-001") {
  return {
    metadata: { id, name: "test-instance", slug: "test-instance", org: "org-1" },
    spec: { agentId: "agent-001", description: "Test", environmentRefs: [] },
  } as any;
}

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockGetByAgent = vi.fn();

function makeMockClient(): Stigmer {
  return {
    agentInstance: {
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
      getByAgent: mockGetByAgent,
    },
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// useCreateAgentInstance
// ---------------------------------------------------------------------------

describe("useCreateAgentInstance", () => {
  it("returns created instance on success", async () => {
    const instance = makeInstance();
    mockCreate.mockResolvedValueOnce(instance);

    const { result } = renderHook(() => useCreateAgentInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    let created: any;
    await act(async () => {
      created = await result.current.create({
        name: "test-instance",
        org: "org-1",
        agentId: "agent-001",
      });
    });

    expect(created).toBe(instance);
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("sets error and re-throws on failure", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Create failed"));

    const { result } = renderHook(() => useCreateAgentInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.create({ name: "x", org: "org-1", agentId: "agent-001" }),
      ).rejects.toThrow("Create failed");
    });

    expect(result.current.error!.message).toBe("Create failed");
    expect(result.current.isCreating).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useUpdateAgentInstance
// ---------------------------------------------------------------------------

describe("useUpdateAgentInstance", () => {
  it("returns updated instance on success", async () => {
    const instance = makeInstance();
    mockUpdate.mockResolvedValueOnce(instance);

    const { result } = renderHook(() => useUpdateAgentInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    let updated: any;
    await act(async () => {
      updated = await result.current.update({
        name: "test-instance",
        org: "org-1",
        agentId: "agent-001",
        description: "Updated",
      });
    });

    expect(updated).toBe(instance);
    expect(result.current.isUpdating).toBe(false);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("sets error and re-throws on failure", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("Update failed"));

    const { result } = renderHook(() => useUpdateAgentInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.update({ name: "x", org: "o", agentId: "a" }),
      ).rejects.toThrow("Update failed");
    });

    expect(result.current.error!.message).toBe("Update failed");
    expect(result.current.isUpdating).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useDeleteAgentInstance
// ---------------------------------------------------------------------------

describe("useDeleteAgentInstance", () => {
  it("returns deleted instance on success", async () => {
    const instance = makeInstance();
    mockDelete.mockResolvedValueOnce(instance);

    const { result } = renderHook(() => useDeleteAgentInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    let deleted: any;
    await act(async () => {
      deleted = await result.current.deleteInstance("ain-001");
    });

    expect(deleted).toBe(instance);
    expect(result.current.isDeleting).toBe(false);
    expect(mockDelete).toHaveBeenCalledWith("ain-001");
  });

  it("sets error and re-throws on failure", async () => {
    mockDelete.mockRejectedValueOnce(new Error("Delete failed"));

    const { result } = renderHook(() => useDeleteAgentInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.deleteInstance("ain-001"),
      ).rejects.toThrow("Delete failed");
    });

    expect(result.current.error!.message).toBe("Delete failed");
    expect(result.current.isDeleting).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useAgentInstances — reads list.items (NOT workflow's .entries)
// ---------------------------------------------------------------------------

describe("useAgentInstances", () => {
  it("lists instances from getByAgent .items", async () => {
    const instances = [makeInstance("ain-1"), makeInstance("ain-2")];
    mockGetByAgent.mockResolvedValueOnce({ items: instances, totalCount: 2 });

    const { result } = renderHook(() => useAgentInstances("agent-001"), {
      wrapper: createWrapper(makeMockClient()),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.instances).toHaveLength(2);
    expect(result.current.instances[0]?.metadata?.id).toBe("ain-1");
    expect(mockGetByAgent).toHaveBeenCalledTimes(1);
  });

  it("does not fetch when agentId is null", async () => {
    const { result } = renderHook(() => useAgentInstances(null), {
      wrapper: createWrapper(makeMockClient()),
    });

    expect(result.current.instances).toEqual([]);
    expect(mockGetByAgent).not.toHaveBeenCalled();
  });
});
