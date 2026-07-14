import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useCanCreateAgentShare } from "../useCanCreateAgentShare";

function createMockStigmer(overrides: {
  isAuthorized?: boolean;
  checkMyPermission?: (...args: unknown[]) => Promise<unknown>;
} = {}) {
  return {
    iamPolicy: {
      checkMyPermission:
        overrides.checkMyPermission ??
        vi.fn().mockResolvedValue({
          isAuthorized: overrides.isAuthorized ?? true,
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

function makeAgent(visibility?: ApiResourceVisibility) {
  return {
    metadata: {
      id: "agt_1",
      org: "acme",
      slug: "support-agent",
      name: "Support Agent",
      ...(visibility !== undefined && { visibility }),
    },
    spec: {},
  } as never;
}

function permissionCheckOf(client: unknown) {
  return (
    client as { iamPolicy: { checkMyPermission: ReturnType<typeof vi.fn> } }
  ).iamPolicy.checkMyPermission;
}

describe("useCanCreateAgentShare", () => {
  it("is not allowed while the agent is loading — no affordance flash", () => {
    const client = createMockStigmer();
    const { result } = renderHook(() => useCanCreateAgentShare(null, "acme"), {
      wrapper: wrapper(client),
    });

    expect(result.current.allowed).toBe(false);
    expect(permissionCheckOf(client)).not.toHaveBeenCalled();
  });

  describe("same-org (viewer org equals the agent's, or omitted)", () => {
    it("requires agent can_edit — the server's Phase A create bar", async () => {
      const client = createMockStigmer({ isAuthorized: true });
      const { result } = renderHook(
        () => useCanCreateAgentShare(makeAgent(), "acme"),
        { wrapper: wrapper(client) },
      );

      await waitFor(() => expect(result.current.allowed).toBe(true));
      expect(result.current.isCrossOrg).toBe(false);
      expect(result.current.shareOrg).toBe("acme");

      const input = permissionCheckOf(client).mock.calls[0][0] as {
        resource?: { kind: string; id: string };
        relation: string;
      };
      expect(input.relation).toBe("can_edit");
      expect(input.resource?.kind).toBe("agent");
      expect(input.resource?.id).toBe("agt_1");
    });

    it("defaults the share org to the agent's own when viewerOrg is omitted", async () => {
      const client = createMockStigmer({ isAuthorized: true });
      const { result } = renderHook(
        () => useCanCreateAgentShare(makeAgent()),
        { wrapper: wrapper(client) },
      );

      await waitFor(() => expect(result.current.allowed).toBe(true));
      expect(result.current.shareOrg).toBe("acme");
      expect(result.current.isCrossOrg).toBe(false);
    });

    it("refuses when the viewer lacks can_edit", async () => {
      const client = createMockStigmer({ isAuthorized: false });
      const { result } = renderHook(
        () => useCanCreateAgentShare(makeAgent(), "acme"),
        { wrapper: wrapper(client) },
      );

      await waitFor(() => expect(permissionCheckOf(client)).toHaveBeenCalled());
      await waitFor(() => expect(result.current.allowed).toBe(false));
    });
  });

  describe("cross-org (decision 013 D2's two-sided bar)", () => {
    it("allows on a public agent when the viewer holds can_create_agent_share in their org", async () => {
      const client = createMockStigmer({ isAuthorized: true });
      const { result } = renderHook(
        () =>
          useCanCreateAgentShare(
            makeAgent(ApiResourceVisibility.visibility_public),
            "consumer-org",
          ),
        { wrapper: wrapper(client) },
      );

      await waitFor(() => expect(result.current.allowed).toBe(true));
      expect(result.current.isCrossOrg).toBe(true);
      expect(result.current.shareOrg).toBe("consumer-org");

      const input = permissionCheckOf(client).mock.calls[0][0] as {
        resource?: { kind: string; id: string };
        relation: string;
      };
      expect(input.relation).toBe("can_create_agent_share");
      expect(input.resource?.kind).toBe("organization");
      // An Organization's id equals its slug (ApiResourceMetadata.id).
      expect(input.resource?.id).toBe("consumer-org");
    });

    it("refuses on a non-public agent without any permission RPC — visibility IS the consent (D1)", () => {
      const client = createMockStigmer();
      const { result } = renderHook(
        () => useCanCreateAgentShare(makeAgent(), "consumer-org"),
        { wrapper: wrapper(client) },
      );

      expect(result.current.allowed).toBe(false);
      expect(result.current.isCrossOrg).toBe(true);
      expect(permissionCheckOf(client)).not.toHaveBeenCalled();
    });

    it("refuses when the viewer lacks can_create_agent_share", async () => {
      const client = createMockStigmer({ isAuthorized: false });
      const { result } = renderHook(
        () =>
          useCanCreateAgentShare(
            makeAgent(ApiResourceVisibility.visibility_public),
            "consumer-org",
          ),
        { wrapper: wrapper(client) },
      );

      await waitFor(() => expect(permissionCheckOf(client)).toHaveBeenCalled());
      await waitFor(() => expect(result.current.allowed).toBe(false));
    });

    it("creates in the VIEWER's org even when the viewer could also edit the agent", async () => {
      // The case that produced the old double-entry confusion: a user
      // holding can_edit on a public agent while acting as another org.
      // There is exactly one answer now — the share lands in the org
      // they are acting as, on that org's bill.
      const client = createMockStigmer({ isAuthorized: true });
      const { result } = renderHook(
        () =>
          useCanCreateAgentShare(
            makeAgent(ApiResourceVisibility.visibility_public),
            "personal",
          ),
        { wrapper: wrapper(client) },
      );

      await waitFor(() => expect(result.current.allowed).toBe(true));
      expect(result.current.shareOrg).toBe("personal");
      expect(result.current.isCrossOrg).toBe(true);
      // Only the org-side bar is consulted — the agent-side can_edit
      // check belongs to the same-org branch alone.
      const relations = permissionCheckOf(client).mock.calls.map(
        (call: unknown[]) => (call[0] as { relation: string }).relation,
      );
      expect(relations).toEqual(["can_create_agent_share"]);
    });
  });
});
