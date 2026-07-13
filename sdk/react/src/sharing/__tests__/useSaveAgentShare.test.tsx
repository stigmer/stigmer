import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { AgentShareAudience } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/spec_pb";
import type { AgentShare } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/api_pb";
import type { AgentShareInput } from "@stigmer/sdk";
import { StigmerContext } from "../../context";
import {
  sharingAudienceFromProto,
  useSaveAgentShare,
  type AgentShareDraft,
} from "../useSaveAgentShare";

function createMockStigmer(overrides: {
  apply?: (input: AgentShareInput) => Promise<unknown>;
} = {}) {
  return {
    agentShare: {
      apply: overrides.apply ?? vi.fn().mockResolvedValue({}),
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

const AGENT = {
  metadata: {
    id: "agt_1",
    org: "acme",
    slug: "support-agent",
    name: "Support Agent",
  },
} as never;

const FULL_DRAFT: AgentShareDraft = {
  enabled: true,
  audience: "public",
  allowedOrigins: ["https://example.com", "https://docs.example.com"],
  messages: {
    rateLimited: "Slow down, please.",
    unavailable: "We're out of credits.",
    conversationEnded: "This conversation has ended.",
  },
  environmentRefs: [{ org: "acme", slug: "github-org-shared" }],
};

describe("useSaveAgentShare", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("applies the complete configuration — identity, agent_ref, origins, messages, and bindings", async () => {
    const apply = vi.fn().mockResolvedValue({});
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveAgentShare(AGENT), {
      wrapper: wrapper(client),
    });

    // No existing share: the apply creates the canonical one, keyed on
    // the agent's own org/slug (the server's D2 default, made explicit).
    await act(() => result.current.save(FULL_DRAFT, null));

    expect(apply).toHaveBeenCalledTimes(1);
    const input = apply.mock.calls[0][0] as AgentShareInput;
    expect(input.org).toBe("acme");
    expect(input.slug).toBe("support-agent");
    expect(input.name).toBe("Support Agent");
    expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });
    expect(input.enabled).toBe(true);
    expect(input.allowedOrigins).toEqual([
      "https://example.com",
      "https://docs.example.com",
    ]);
    expect(input.messages?.rateLimited).toBe("Slow down, please.");
    expect(input.messages?.unavailable).toBe("We're out of credits.");
    expect(input.messages?.conversationEnded).toBe(
      "This conversation has ended.",
    );
    expect(input.environmentRefs).toEqual([
      { org: "acme", slug: "github-org-shared" },
    ]);
  });

  it("keeps the existing share's identity when editing (a renamed share is never forked)", async () => {
    const apply = vi.fn().mockResolvedValue({});
    const client = createMockStigmer({ apply });
    // A share created via manifest with a non-default slug: applying with
    // the agent's slug would create a SECOND share instead of updating.
    const renamedShare = {
      metadata: { id: "ash_1", org: "acme", slug: "help-desk", name: "Help Desk" },
      spec: { enabled: true },
    } as AgentShare;

    const { result } = renderHook(() => useSaveAgentShare(AGENT), {
      wrapper: wrapper(client),
    });

    await act(() => result.current.save(FULL_DRAFT, renamedShare));

    const input = apply.mock.calls[0][0] as AgentShareInput;
    expect(input.slug).toBe("help-desk");
    expect(input.name).toBe("Help Desk");
    // The agent reference is the agent's identity regardless of share slug.
    expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });
  });

  it("disabling still carries origins, messages, bindings, and audience (toggle never clobbers config)", async () => {
    const apply = vi.fn().mockResolvedValue({});
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveAgentShare(AGENT), {
      wrapper: wrapper(client),
    });

    await act(() =>
      result.current.save(
        { ...FULL_DRAFT, enabled: false, audience: "org", environmentRefs: [] },
        null,
      ),
    );

    const input = apply.mock.calls[0][0] as AgentShareInput;
    expect(input.enabled).toBe(false);
    // Apply replaces the spec wholesale — a disable that dropped these
    // fields would silently erase the owner's configuration (an audience
    // drop would silently revert an org-only share to public).
    expect(input.allowedOrigins).toEqual(FULL_DRAFT.allowedOrigins);
    expect(input.messages?.rateLimited).toBe(FULL_DRAFT.messages.rateLimited);
    expect(input.audience).toBe(AgentShareAudience.org);
  });

  it("maps the audience union to the proto enum, writing public explicitly", async () => {
    const apply = vi.fn().mockResolvedValue({});
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveAgentShare(AGENT), {
      wrapper: wrapper(client),
    });

    await act(() => result.current.save(FULL_DRAFT, null));
    await act(() =>
      result.current.save(
        { ...FULL_DRAFT, audience: "org", environmentRefs: [] },
        null,
      ),
    );

    const first = apply.mock.calls[0][0] as AgentShareInput;
    const second = apply.mock.calls[1][0] as AgentShareInput;
    // "public" persists as the explicit enum value, never unspecified —
    // a console-managed share can't be downgraded by a later manifest
    // that relies on the unspecified-means-public default.
    expect(first.audience).toBe(AgentShareAudience.public);
    expect(second.audience).toBe(AgentShareAudience.org);
  });

  describe("cross-org create identity (shareOrg — decision 013)", () => {
    it("a first save lands the share in the sharing org, agent_ref stays the agent's", async () => {
      const apply = vi.fn().mockResolvedValue({});
      const client = createMockStigmer({ apply });

      const { result } = renderHook(
        () => useSaveAgentShare(AGENT, "consumer-org"),
        { wrapper: wrapper(client) },
      );

      await act(() => result.current.save(FULL_DRAFT, null));

      const input = apply.mock.calls[0][0] as AgentShareInput;
      // The share is the sharing org's resource (its URL, billing, and
      // credentials), while agent_ref keeps pointing at the provider's
      // blueprint — the whole point of a cross-org share.
      expect(input.org).toBe("consumer-org");
      expect(input.slug).toBe("support-agent");
      expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });
    });

    it("editing an existing cross-org share keeps ITS identity, not the hook argument's", async () => {
      const apply = vi.fn().mockResolvedValue({});
      const client = createMockStigmer({ apply });
      const externalShare = {
        metadata: {
          id: "ash_ext",
          org: "consumer-org",
          slug: "renamed-channel",
          name: "Renamed Channel",
        },
        spec: { enabled: true },
      } as AgentShare;

      const { result } = renderHook(
        () => useSaveAgentShare(AGENT, "consumer-org"),
        { wrapper: wrapper(client) },
      );

      await act(() => result.current.save(FULL_DRAFT, externalShare));

      const input = apply.mock.calls[0][0] as AgentShareInput;
      expect(input.org).toBe("consumer-org");
      expect(input.slug).toBe("renamed-channel");
      expect(input.agentRef).toEqual({ org: "acme", slug: "support-agent" });
    });
  });

  it("is a stable no-op when the agent is null", async () => {
    const apply = vi.fn();
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveAgentShare(null), {
      wrapper: wrapper(client),
    });

    const returned = await act(() => result.current.save(FULL_DRAFT, null));
    expect(returned).toBeUndefined();
    expect(apply).not.toHaveBeenCalled();
  });

  it("exposes isPending during the request", async () => {
    let resolveRpc: (v: unknown) => void = () => {};
    const apply = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      }),
    );
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveAgentShare(AGENT), {
      wrapper: wrapper(client),
    });

    let pending: Promise<unknown>;
    act(() => {
      pending = result.current.save(FULL_DRAFT, null);
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
    const apply = vi.fn().mockRejectedValue(failure);
    const client = createMockStigmer({ apply });

    const { result } = renderHook(() => useSaveAgentShare(AGENT), {
      wrapper: wrapper(client),
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current.save(FULL_DRAFT, null);
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
  it("maps unspecified to public (a share without an audience is anyone-with-link)", () => {
    expect(sharingAudienceFromProto(undefined)).toBe("public");
    expect(sharingAudienceFromProto(AgentShareAudience.unspecified)).toBe(
      "public",
    );
  });

  it("maps the explicit values", () => {
    expect(sharingAudienceFromProto(AgentShareAudience.public)).toBe("public");
    expect(sharingAudienceFromProto(AgentShareAudience.org)).toBe("org");
  });
});
