// useDeleteChannel: deleting a channel of any type by id, with pending and
// error state.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { useDeleteChannel } from "../useDeleteChannel";

function createMockStigmer(overrides: {
  delete?: (id: string) => Promise<unknown>;
} = {}) {
  return {
    channel: {
      delete: overrides.delete ?? vi.fn().mockResolvedValue({}),
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        {children}
      </StigmerContext.Provider>
    );
  };
}

describe("useDeleteChannel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes by id and returns the deleted resource", async () => {
    const deleted = { metadata: { id: "chn_1" } };
    const del = vi.fn().mockResolvedValue(deleted);
    const client = createMockStigmer({ delete: del });

    const { result } = renderHook(() => useDeleteChannel(), {
      wrapper: wrapper(client),
    });

    let returned: unknown;
    await act(async () => {
      returned = await result.current.deleteChannel("chn_1");
    });

    expect(del).toHaveBeenCalledWith("chn_1");
    expect(returned).toBe(deleted);
    expect(result.current.error).toBeNull();
    expect(result.current.isDeleting).toBe(false);
  });

  it("tracks isDeleting during the flight", async () => {
    let resolveDelete: (value: unknown) => void = () => {};
    const del = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveDelete = resolve; }),
    );
    const client = createMockStigmer({ delete: del });

    const { result } = renderHook(() => useDeleteChannel(), {
      wrapper: wrapper(client),
    });

    let deletePromise: Promise<unknown> = Promise.resolve();
    act(() => {
      deletePromise = result.current.deleteChannel("chn_1");
    });

    await waitFor(() => expect(result.current.isDeleting).toBe(true));

    await act(async () => {
      resolveDelete({});
      await deletePromise;
    });
    expect(result.current.isDeleting).toBe(false);
  });

  it("captures and rethrows delete failures", async () => {
    const del = vi.fn().mockRejectedValue(new Error("permission denied"));
    const client = createMockStigmer({ delete: del });

    const { result } = renderHook(() => useDeleteChannel(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await expect(result.current.deleteChannel("chn_1")).rejects.toThrow(
        "permission denied",
      );
    });

    expect(result.current.error?.message).toBe("permission denied");
    expect(result.current.isDeleting).toBe(false);

    act(() => result.current.clearError());
    expect(result.current.error).toBeNull();
  });
});
