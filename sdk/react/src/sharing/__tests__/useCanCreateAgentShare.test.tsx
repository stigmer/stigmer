import { describe, it, expect, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useCanCreateAgentShare } from "../useCanCreateAgentShare";

type PermissionInput = {
  resource?: { kind: string; id: string };
  relation: string;
};

/**
 * A client whose permission check answers per relation, so a test can
 * grant one bar and refuse the other.
 */
function createMockStigmer(answers: Record<string, boolean> = {}) {
  return {
    iamPolicy: {
      checkMyPermission: vi.fn(async (input: PermissionInput) => ({
        isAuthorized: answers[input.relation] ?? true,
      })),
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

function makeAgent() {
  return {
    metadata: {
      id: "agt_1",
      org: "acme",
      slug: "support-agent",
      name: "Support Agent",
    },
    spec: {},
  } as never;
}

function permissionCheckOf(client: unknown) {
  return (
    client as { iamPolicy: { checkMyPermission: ReturnType<typeof vi.fn> } }
  ).iamPolicy.checkMyPermission;
}

function askedBars(client: unknown): PermissionInput[] {
  return permissionCheckOf(client).mock.calls.map(
    (call: unknown[]) => call[0] as PermissionInput,
  );
}

describe("useCanCreateAgentShare", () => {
  it("is not allowed while the agent is loading — no affordance flash", () => {
    const client = createMockStigmer();
    const { result } = renderHook(() => useCanCreateAgentShare(null), {
      wrapper: wrapper(client),
    });

    expect(result.current.allowed).toBe(false);
    expect(permissionCheckOf(client)).not.toHaveBeenCalled();
  });

  it("asks both of the server's bars, in the agent's own organization", async () => {
    const client = createMockStigmer();
    const { result } = renderHook(() => useCanCreateAgentShare(makeAgent()), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(result.current.allowed).toBe(true));

    const bars = askedBars(client).map((b) => ({
      kind: b.resource?.kind,
      id: b.resource?.id,
      relation: b.relation,
    }));
    expect(bars).toHaveLength(2);
    expect(bars).toContainEqual({ kind: "agent", id: "agt_1", relation: "can_edit" });
    // An Organization's id equals its slug (ApiResourceMetadata.id), and
    // the share lives in the agent's organization, never the viewer's.
    expect(bars).toContainEqual({
      kind: "organization",
      id: "acme",
      relation: "can_create_agent_share",
    });
  });

  it("refuses when the viewer lacks can_edit on the agent", async () => {
    const client = createMockStigmer({ can_edit: false });
    const { result } = renderHook(() => useCanCreateAgentShare(makeAgent()), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(permissionCheckOf(client)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.allowed).toBe(false));
  });

  it("refuses when the viewer lacks can_create_agent_share on the organization — an editor who is not an admin sees no Create share", async () => {
    const client = createMockStigmer({ can_create_agent_share: false });
    const { result } = renderHook(() => useCanCreateAgentShare(makeAgent()), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(permissionCheckOf(client)).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.allowed).toBe(false));
  });
});
