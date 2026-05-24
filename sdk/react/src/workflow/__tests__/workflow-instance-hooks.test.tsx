import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useCreateWorkflowInstance } from "../instance/useCreateWorkflowInstance";
import { useUpdateWorkflowInstance } from "../instance/useUpdateWorkflowInstance";
import { useDeleteWorkflowInstance } from "../instance/useDeleteWorkflowInstance";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInstance(id = "wfi-001") {
  return {
    metadata: { id, name: "test-instance", slug: "test-instance", org: "org-1" },
    spec: { workflowId: "wf-001", description: "Test", environmentRefs: [] },
  } as any;
}

const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();

function makeMockClient(): Stigmer {
  return {
    workflowInstance: {
      create: mockCreate,
      update: mockUpdate,
      delete: mockDelete,
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
// useCreateWorkflowInstance
// ---------------------------------------------------------------------------

describe("useCreateWorkflowInstance", () => {
  it("returns created instance on success", async () => {
    const instance = makeInstance();
    mockCreate.mockResolvedValueOnce(instance);

    const { result } = renderHook(() => useCreateWorkflowInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();

    let created: any;
    await act(async () => {
      created = await result.current.create({
        name: "test-instance",
        org: "org-1",
        workflowId: "wf-001",
      });
    });

    expect(created).toBe(instance);
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("sets error and re-throws on failure", async () => {
    const err = new Error("Create failed");
    mockCreate.mockRejectedValueOnce(err);

    const { result } = renderHook(() => useCreateWorkflowInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.create({ name: "x", org: "org-1", workflowId: "wf-001" }),
      ).rejects.toThrow("Create failed");
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.error!.message).toBe("Create failed");
    expect(result.current.isCreating).toBe(false);
  });

  it("clearError resets error to null", async () => {
    mockCreate.mockRejectedValueOnce(new Error("oops"));

    const { result } = renderHook(() => useCreateWorkflowInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await result.current.create({ name: "x", org: "o", workflowId: "w" }).catch(() => {});
    });

    expect(result.current.error).not.toBeNull();

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// useUpdateWorkflowInstance
// ---------------------------------------------------------------------------

describe("useUpdateWorkflowInstance", () => {
  it("returns updated instance on success", async () => {
    const instance = makeInstance();
    mockUpdate.mockResolvedValueOnce(instance);

    const { result } = renderHook(() => useUpdateWorkflowInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    let updated: any;
    await act(async () => {
      updated = await result.current.update({
        name: "test-instance",
        org: "org-1",
        workflowId: "wf-001",
        description: "Updated",
      });
    });

    expect(updated).toBe(instance);
    expect(result.current.isUpdating).toBe(false);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("sets error and re-throws on failure", async () => {
    mockUpdate.mockRejectedValueOnce(new Error("Update failed"));

    const { result } = renderHook(() => useUpdateWorkflowInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.update({ name: "x", org: "o", workflowId: "w" }),
      ).rejects.toThrow("Update failed");
    });

    expect(result.current.error!.message).toBe("Update failed");
    expect(result.current.isUpdating).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// useDeleteWorkflowInstance
// ---------------------------------------------------------------------------

describe("useDeleteWorkflowInstance", () => {
  it("returns deleted instance on success", async () => {
    const instance = makeInstance();
    mockDelete.mockResolvedValueOnce(instance);

    const { result } = renderHook(() => useDeleteWorkflowInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    let deleted: any;
    await act(async () => {
      deleted = await result.current.deleteInstance("wfi-001");
    });

    expect(deleted).toBe(instance);
    expect(result.current.isDeleting).toBe(false);
    expect(mockDelete).toHaveBeenCalledWith("wfi-001");
  });

  it("sets error and re-throws on failure", async () => {
    mockDelete.mockRejectedValueOnce(new Error("Delete failed"));

    const { result } = renderHook(() => useDeleteWorkflowInstance(), {
      wrapper: createWrapper(makeMockClient()),
    });

    await act(async () => {
      await expect(
        result.current.deleteInstance("wfi-001"),
      ).rejects.toThrow("Delete failed");
    });

    expect(result.current.error!.message).toBe("Delete failed");
    expect(result.current.isDeleting).toBe(false);
  });
});
