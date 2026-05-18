import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useCreateSession } from "../useCreateSession";

function createMockStigmer(overrides: {
  getByReference?: (...args: unknown[]) => Promise<unknown>;
  create?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    agent: {
      getByReference: overrides.getByReference ?? vi.fn().mockResolvedValue({
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

describe("useCreateSession", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a session with agentInstanceId", async () => {
    const create = vi.fn().mockResolvedValue({ metadata: { id: "ses-123" } });
    const client = createMockStigmer({ create });

    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(client),
    });

    expect(result.current.isCreating).toBe(false);

    let sessionResult: { sessionId: string } | undefined;
    await act(async () => {
      sessionResult = await result.current.create({
        org: "acme",
        agentInstanceId: "ain-123",
      });
    });

    expect(sessionResult!.sessionId).toBe("ses-123");
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        org: "acme",
        agentInstanceId: "ain-123",
      }),
    );
  });

  it("resolves agentRef to default instance before creating", async () => {
    const getByReference = vi.fn().mockResolvedValue({
      status: { defaultInstanceId: "ain-resolved" },
    });
    const create = vi.fn().mockResolvedValue({ metadata: { id: "ses-456" } });
    const client = createMockStigmer({ getByReference, create });

    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        agentRef: { org: "acme", slug: "my-agent" },
      });
    });

    expect(getByReference).toHaveBeenCalledWith({ org: "acme", slug: "my-agent" });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ agentInstanceId: "ain-resolved" }),
    );
  });

  it("errors when agentRef resolves to agent without default instance", async () => {
    const getByReference = vi.fn().mockResolvedValue({
      status: { defaultInstanceId: "" },
    });
    const client = createMockStigmer({ getByReference });

    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(client),
    });

    // The hook catches the error, sets state, and re-throws.
    // We need to catch the rethrow to inspect the error state.
    let caughtError: Error | undefined;
    await act(async () => {
      try {
        await result.current.create({
          org: "acme",
          agentRef: { org: "acme", slug: "no-instance-agent" },
        });
      } catch (err) {
        caughtError = err as Error;
      }
    });

    expect(caughtError).toBeTruthy();
    expect(caughtError!.message).toContain("does not have a default instance");
    expect(result.current.error).toBeTruthy();
    expect(result.current.error!.message).toContain("does not have a default instance");
  });

  it("sets error state on session.create failure", async () => {
    const create = vi.fn().mockRejectedValue(new Error("Permission denied"));
    const client = createMockStigmer({ create });

    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(client),
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
    expect(caughtError!.message).toBe("Permission denied");
    expect(result.current.error!.message).toBe("Permission denied");
    expect(result.current.isCreating).toBe(false);
  });

  it("clearError resets the error state", async () => {
    const create = vi.fn().mockRejectedValue(new Error("fail"));
    const client = createMockStigmer({ create });

    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      try {
        await result.current.create({ org: "acme", agentInstanceId: "ain-1" });
      } catch {
        // expected
      }
    });

    expect(result.current.error).toBeTruthy();

    act(() => result.current.clearError());

    expect(result.current.error).toBeNull();
  });
});
