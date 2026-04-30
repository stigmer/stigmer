import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import { useCreateSession } from "../useCreateSession";

function buildMockClient(overrides: {
  sessionCreate?: ReturnType<typeof vi.fn>;
  agentGetByReference?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    session: {
      create: overrides.sessionCreate ?? vi.fn(),
    },
    agent: {
      getByReference: overrides.agentGetByReference ?? vi.fn(),
    },
  } as unknown as Stigmer;
}

function makeWrapper(client: Stigmer) {
  return ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
}

function fakeSessionResponse(sessionId: string) {
  return { metadata: { id: sessionId } };
}

describe("useCreateSession", () => {
  let sessionCreateMock: ReturnType<typeof vi.fn>;
  let agentGetByRefMock: ReturnType<typeof vi.fn>;
  let client: Stigmer;

  beforeEach(() => {
    sessionCreateMock = vi.fn();
    agentGetByRefMock = vi.fn();
    client = buildMockClient({
      sessionCreate: sessionCreateMock,
      agentGetByReference: agentGetByRefMock,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("starts in idle state", () => {
    const { result } = renderHook(() => useCreateSession(), {
      wrapper: makeWrapper(client),
    });
    expect(result.current.isCreating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  describe("agentInstanceId path", () => {
    it("creates a session with the given instance ID", async () => {
      sessionCreateMock.mockResolvedValueOnce(fakeSessionResponse("sess-1"));

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: makeWrapper(client),
      });

      let outcome: { sessionId: string } | undefined;
      await act(async () => {
        outcome = await result.current.create({
          org: "acme",
          agentInstanceId: "inst-abc",
        });
      });

      expect(outcome!.sessionId).toBe("sess-1");
      expect(sessionCreateMock).toHaveBeenCalledOnce();
      expect(sessionCreateMock.mock.calls[0][0]).toMatchObject({
        org: "acme",
        agentInstanceId: "inst-abc",
      });
    });
  });

  describe("agentRef path", () => {
    it("resolves the agent reference to its default instance", async () => {
      agentGetByRefMock.mockResolvedValueOnce({
        status: { defaultInstanceId: "inst-resolved" },
      });
      sessionCreateMock.mockResolvedValueOnce(fakeSessionResponse("sess-2"));

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: makeWrapper(client),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentRef: { org: "acme", slug: "my-agent" },
        });
      });

      expect(agentGetByRefMock).toHaveBeenCalledWith({
        org: "acme",
        slug: "my-agent",
      });
      expect(sessionCreateMock.mock.calls[0][0]).toMatchObject({
        agentInstanceId: "inst-resolved",
      });
    });

    it("throws when agent has no default instance", async () => {
      agentGetByRefMock.mockResolvedValueOnce({ status: {} });

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: makeWrapper(client),
      });

      await act(async () => {
        await expect(
          result.current.create({
            org: "acme",
            agentRef: { org: "acme", slug: "no-instance" },
          }),
        ).rejects.toThrow("does not have a default instance");
      });

      expect(result.current.error).not.toBeNull();
      expect(result.current.error!.message).toContain(
        "does not have a default instance",
      );
    });
  });

  describe("harness proto conversion", () => {
    it("passes Harness.CURSOR when harness is cursor", async () => {
      sessionCreateMock.mockResolvedValueOnce(fakeSessionResponse("sess-h1"));

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: makeWrapper(client),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentInstanceId: "inst-1",
          harness: "cursor",
        });
      });

      expect(sessionCreateMock.mock.calls[0][0].harness).toBe(Harness.CURSOR);
    });

    it("passes Harness.NATIVE when harness is native", async () => {
      sessionCreateMock.mockResolvedValueOnce(fakeSessionResponse("sess-h2"));

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: makeWrapper(client),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentInstanceId: "inst-1",
          harness: "native",
        });
      });

      expect(sessionCreateMock.mock.calls[0][0].harness).toBe(Harness.NATIVE);
    });

    it("passes undefined when harness is omitted", async () => {
      sessionCreateMock.mockResolvedValueOnce(fakeSessionResponse("sess-h3"));

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: makeWrapper(client),
      });

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentInstanceId: "inst-1",
        });
      });

      expect(sessionCreateMock.mock.calls[0][0].harness).toBeUndefined();
    });
  });

  describe("loading state lifecycle", () => {
    it("isCreating is true during the RPC and false after", async () => {
      let resolveCreate!: (v: unknown) => void;
      sessionCreateMock.mockReturnValueOnce(
        new Promise((r) => { resolveCreate = r; }),
      );

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: makeWrapper(client),
      });

      let createPromise: Promise<unknown>;
      act(() => {
        createPromise = result.current.create({
          org: "acme",
          agentInstanceId: "inst-1",
        });
      });

      expect(result.current.isCreating).toBe(true);

      await act(async () => {
        resolveCreate(fakeSessionResponse("sess-lc"));
        await createPromise;
      });

      expect(result.current.isCreating).toBe(false);
    });
  });

  describe("error handling", () => {
    it("sets error on RPC failure and resets isCreating", async () => {
      sessionCreateMock.mockRejectedValueOnce(new Error("network timeout"));

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: makeWrapper(client),
      });

      await act(async () => {
        await expect(
          result.current.create({
            org: "acme",
            agentInstanceId: "inst-1",
          }),
        ).rejects.toThrow("network timeout");
      });

      expect(result.current.isCreating).toBe(false);
      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error!.message).toBe("network timeout");
    });

    it("clearError resets error to null", async () => {
      sessionCreateMock.mockRejectedValueOnce(new Error("fail"));

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: makeWrapper(client),
      });

      await act(async () => {
        try {
          await result.current.create({
            org: "acme",
            agentInstanceId: "inst-1",
          });
        } catch { /* expected */ }
      });

      expect(result.current.error).not.toBeNull();

      act(() => {
        result.current.clearError();
      });

      expect(result.current.error).toBeNull();
    });

    it("clears previous error on new create attempt", async () => {
      sessionCreateMock
        .mockRejectedValueOnce(new Error("first fail"))
        .mockResolvedValueOnce(fakeSessionResponse("sess-retry"));

      const { result } = renderHook(() => useCreateSession(), {
        wrapper: makeWrapper(client),
      });

      await act(async () => {
        try {
          await result.current.create({
            org: "acme",
            agentInstanceId: "inst-1",
          });
        } catch { /* expected */ }
      });

      expect(result.current.error).not.toBeNull();

      await act(async () => {
        await result.current.create({
          org: "acme",
          agentInstanceId: "inst-1",
        });
      });

      expect(result.current.error).toBeNull();
    });
  });
});
