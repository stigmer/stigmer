import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { UpdateAgentSharingInput } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/io_pb";
import { AgentSharingAudience } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { StigmerContext } from "../../context";
import {
  sharingAudienceFromProto,
  useUpdateAgentSharing,
  type AgentSharingDraft,
} from "../useUpdateAgentSharing";

function createMockStigmer(overrides: {
  updateSharing?: (input: UpdateAgentSharingInput) => Promise<unknown>;
} = {}) {
  return {
    agent: {
      updateSharing:
        overrides.updateSharing ?? vi.fn().mockResolvedValue({}),
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

const FULL_DRAFT: AgentSharingDraft = {
  enabled: true,
  audience: "public",
  allowedOrigins: ["https://example.com", "https://docs.example.com"],
  messages: {
    rateLimited: "Slow down, please.",
    unavailable: "We're out of credits.",
    conversationEnded: "This conversation has ended.",
  },
};

describe("useUpdateAgentSharing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the complete sharing block — enabled, origins, and messages", async () => {
    const updateSharing = vi.fn().mockResolvedValue({});
    const client = createMockStigmer({ updateSharing });

    const { result } = renderHook(() => useUpdateAgentSharing("agt_1"), {
      wrapper: wrapper(client),
    });

    await act(() => result.current.updateSharing(FULL_DRAFT));

    expect(updateSharing).toHaveBeenCalledTimes(1);
    const input = updateSharing.mock.calls[0][0] as UpdateAgentSharingInput;
    expect(input.resourceId).toBe("agt_1");
    expect(input.sharing?.enabled).toBe(true);
    expect(input.sharing?.allowedOrigins).toEqual([
      "https://example.com",
      "https://docs.example.com",
    ]);
    expect(input.sharing?.messages?.rateLimited).toBe("Slow down, please.");
    expect(input.sharing?.messages?.unavailable).toBe("We're out of credits.");
    expect(input.sharing?.messages?.conversationEnded).toBe(
      "This conversation has ended.",
    );
  });

  it("disabling still carries origins, messages, and audience (toggle never clobbers config)", async () => {
    const updateSharing = vi.fn().mockResolvedValue({});
    const client = createMockStigmer({ updateSharing });

    const { result } = renderHook(() => useUpdateAgentSharing("agt_1"), {
      wrapper: wrapper(client),
    });

    await act(() =>
      result.current.updateSharing({
        ...FULL_DRAFT,
        enabled: false,
        audience: "org",
      }),
    );

    const input = updateSharing.mock.calls[0][0] as UpdateAgentSharingInput;
    expect(input.sharing?.enabled).toBe(false);
    // The RPC replaces spec.sharing wholesale — a disable that dropped
    // these fields would silently erase the owner's configuration (an
    // audience drop would silently revert an org-only agent to public).
    expect(input.sharing?.allowedOrigins).toEqual(FULL_DRAFT.allowedOrigins);
    expect(input.sharing?.messages?.rateLimited).toBe(
      FULL_DRAFT.messages.rateLimited,
    );
    expect(input.sharing?.audience).toBe(AgentSharingAudience.org);
  });

  it("maps the audience union to the proto enum, writing public explicitly", async () => {
    const updateSharing = vi.fn().mockResolvedValue({});
    const client = createMockStigmer({ updateSharing });

    const { result } = renderHook(() => useUpdateAgentSharing("agt_1"), {
      wrapper: wrapper(client),
    });

    await act(() => result.current.updateSharing(FULL_DRAFT));
    await act(() =>
      result.current.updateSharing({ ...FULL_DRAFT, audience: "org" }),
    );

    const first = updateSharing.mock.calls[0][0] as UpdateAgentSharingInput;
    const second = updateSharing.mock.calls[1][0] as UpdateAgentSharingInput;
    // "public" persists as the explicit enum value, never unspecified —
    // a console-managed share can't be downgraded by a later manifest
    // that relies on the unspecified-means-public default.
    expect(first.sharing?.audience).toBe(AgentSharingAudience.public);
    expect(second.sharing?.audience).toBe(AgentSharingAudience.org);
  });

  it("is a stable no-op when agentId is null", async () => {
    const updateSharing = vi.fn();
    const client = createMockStigmer({ updateSharing });

    const { result } = renderHook(() => useUpdateAgentSharing(null), {
      wrapper: wrapper(client),
    });

    const returned = await act(() => result.current.updateSharing(FULL_DRAFT));
    expect(returned).toBeUndefined();
    expect(updateSharing).not.toHaveBeenCalled();
  });

  it("exposes isPending during the request", async () => {
    let resolveRpc: (v: unknown) => void = () => {};
    const updateSharing = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      }),
    );
    const client = createMockStigmer({ updateSharing });

    const { result } = renderHook(() => useUpdateAgentSharing("agt_1"), {
      wrapper: wrapper(client),
    });

    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.updateSharing(FULL_DRAFT);
    });
    expect(result.current.isPending).toBe(true);

    await act(async () => {
      resolveRpc({});
      await pending;
    });
    expect(result.current.isPending).toBe(false);
  });

  it("captures and rethrows RPC errors", async () => {
    const failure = new Error("permission denied");
    const updateSharing = vi.fn().mockRejectedValue(failure);
    const client = createMockStigmer({ updateSharing });

    const { result } = renderHook(() => useUpdateAgentSharing("agt_1"), {
      wrapper: wrapper(client),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.updateSharing(FULL_DRAFT);
      } catch (err) {
        caught = err;
      }
    });

    expect(caught).toBe(failure);
    await waitFor(() => expect(result.current.error).toBe(failure));
    expect(result.current.isPending).toBe(false);
  });
});

describe("sharingAudienceFromProto", () => {
  it("maps unspecified to public (pre-audience shares keep their behavior)", () => {
    expect(sharingAudienceFromProto(undefined)).toBe("public");
    expect(sharingAudienceFromProto(AgentSharingAudience.unspecified)).toBe(
      "public",
    );
  });

  it("maps the explicit values", () => {
    expect(sharingAudienceFromProto(AgentSharingAudience.public)).toBe("public");
    expect(sharingAudienceFromProto(AgentSharingAudience.org)).toBe("org");
  });
});
