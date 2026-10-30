/**
 * useCreateSession: a session names its agent directly (`agentRef`, sent as
 * given, with no agent read first) or none (the built-in assistant), with
 * the execution target the input or the context names, and the Environment
 * the input names (none when it names none).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { ExecutionTargetContext } from "@stigmer/react-core/internal";
import { useCreateSession } from "../useCreateSession";

function createMockStigmer(overrides: {
  create?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    agent: { getByReference: vi.fn() },
    session: {
      create: overrides.create ?? vi.fn().mockResolvedValue({
        metadata: { id: "ses_new-1" },
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

  it("creates a session on the agent reference, reading no agent first", async () => {
    const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_123" } });
    const client = createMockStigmer({ create });

    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(client),
    });

    expect(result.current.isCreating).toBe(false);

    let sessionResult: { sessionId: string } | undefined;
    await act(async () => {
      sessionResult = await result.current.create({
        org: "acme",
        agentRef: { org: "acme", slug: "my-agent" },
      });
    });

    expect(sessionResult!.sessionId).toBe("ses_123");
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
    expect(create).toHaveBeenCalledTimes(1);
    const sent = create.mock.calls[0][0];
    expect(sent.org).toBe("acme");
    // No version: the server pins the agent's current version.
    expect(sent.agentRef).toEqual({ org: "acme", slug: "my-agent" });
    expect((client as { agent: { getByReference: ReturnType<typeof vi.fn> } }).agent.getByReference)
      .not.toHaveBeenCalled();
  });

  it("names no agent for the built-in assistant", async () => {
    const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_0" } });
    const client = createMockStigmer({ create });

    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.create({ org: "acme" });
    });

    expect(create.mock.calls[0][0].agentRef).toBeUndefined();
  });

  it("sends file review only when the caller asks for it", async () => {
    const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_fr" } });
    const client = createMockStigmer({ create });

    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.create({ org: "acme", fileReview: true });
    });
    await act(async () => {
      await result.current.create({ org: "acme" });
    });

    expect(create.mock.calls[0][0].fileReview).toBe(true);
    expect(create.mock.calls[1][0].fileReview).toBeUndefined();
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
          agentRef: { org: "acme", slug: "my-agent" },
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

  it("passes executionTarget to stigmer.session.create()", async () => {
    const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_et" } });
    const client = createMockStigmer({ create });

    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        agentRef: { org: "acme", slug: "my-agent" },
        executionTarget: "local",
      });
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        executionTarget: 1,
      }),
    );
  });

  it("omits executionTarget when not provided", async () => {
    const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_no-et" } });
    const client = createMockStigmer({ create });

    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await result.current.create({
        org: "acme",
        agentRef: { org: "acme", slug: "my-agent" },
      });
    });

    const callArg = create.mock.calls[0][0];
    expect(callArg.executionTarget).toBeUndefined();
  });

  describe("session metadata and sessionContext", () => {
    it("passes the metadata map through to stigmer.session.create()", async () => {
      const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_md" } });
      const client = createMockStigmer({ create });

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapper(client),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentRef: { org: "acme", slug: "my-agent" },
          metadata: { "acme/tenant": "t-1" },
        });
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { "acme/tenant": "t-1" },
        }),
      );
    });

    it("maps the typed sessionContext onto the reserved metadata key", async () => {
      const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_sc" } });
      const client = createMockStigmer({ create });

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapper(client),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentRef: { org: "acme", slug: "my-agent" },
          sessionContext: "Role: platform admin",
        });
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { "stigmer.ai/session-context": "Role: platform admin" },
        }),
      );
    });

    it("lets the typed sessionContext win over a raw entry under the reserved key", async () => {
      const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_both" } });
      const client = createMockStigmer({ create });

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapper(client),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentRef: { org: "acme", slug: "my-agent" },
          metadata: {
            "acme/tenant": "t-1",
            "stigmer.ai/session-context": "stale raw value",
          },
          sessionContext: "typed value",
        });
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: {
            "acme/tenant": "t-1",
            "stigmer.ai/session-context": "typed value",
          },
        }),
      );
    });

    it("omits metadata entirely when neither field is provided", async () => {
      const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_none" } });
      const client = createMockStigmer({ create });

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapper(client),
      });

      await act(async () => {
        await result.current.create({ org: "acme", agentRef: { org: "acme", slug: "my-agent" } });
      });

      const callArg = create.mock.calls[0][0];
      expect(callArg.metadata).toBeUndefined();
    });
  });

  it("clearError resets the error state", async () => {
    const create = vi.fn().mockRejectedValue(new Error("fail"));
    const client = createMockStigmer({ create });

    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      try {
        await result.current.create({ org: "acme" });
      } catch {
        // expected
      }
    });

    expect(result.current.error).toBeTruthy();

    act(() => result.current.clearError());

    expect(result.current.error).toBeNull();
  });

  describe("executionTarget context fallback", () => {
    function wrapperWithExecutionTarget(client: unknown, executionTarget?: "local" | "cloud") {
      return function Wrapper({ children }: { children: ReactNode }) {
        return (
          <FetchCacheContext.Provider value={null}>
            <ExecutionTargetContext.Provider value={executionTarget}>
              <StigmerContext.Provider value={client as never}>
                {children}
              </StigmerContext.Provider>
            </ExecutionTargetContext.Provider>
          </FetchCacheContext.Provider>
        );
      };
    }

    it("uses context executionTarget when per-call input omits it", async () => {
      const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_ctx" } });
      const client = createMockStigmer({ create });

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapperWithExecutionTarget(client, "local"),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentRef: { org: "acme", slug: "my-agent" },
        });
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          executionTarget: 1,
        }),
      );
    });

    it("per-call executionTarget overrides context", async () => {
      const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_override" } });
      const client = createMockStigmer({ create });

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapperWithExecutionTarget(client, "cloud"),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentRef: { org: "acme", slug: "my-agent" },
          executionTarget: "local",
        });
      });

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({
          executionTarget: 1,
        }),
      );
    });

    it("omits executionTarget when neither context nor per-call provides it", async () => {
      const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_none" } });
      const client = createMockStigmer({ create });

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: wrapperWithExecutionTarget(client, undefined),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentRef: { org: "acme", slug: "my-agent" },
        });
      });

      const callArg = create.mock.calls[0][0];
      expect(callArg.executionTarget).toBeUndefined();
    });
  });

  it("sends the Environment the input names, and none when it names none", async () => {
    const create = vi.fn().mockResolvedValue({ metadata: { id: "ses_env" } });
    const { result } = renderHook(() => useCreateSession(), {
      wrapper: wrapper(createMockStigmer({ create })),
    });

    await act(async () => {
      await result.current.create({ org: "acme", environmentRef: { org: "acme", slug: "data-science" } });
    });
    await act(async () => {
      await result.current.create({ org: "acme" });
    });

    expect(create.mock.calls[0][0].environmentRef).toEqual({ org: "acme", slug: "data-science" });
    expect(create.mock.calls[1][0].environmentRef).toBeUndefined();
  });
});
