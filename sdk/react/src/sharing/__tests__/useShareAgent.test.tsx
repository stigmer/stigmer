import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useShareAgent } from "../useShareAgent";

// happy-dom does not implement the native dialog show/close methods.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    this.open = false;
  };
});

afterEach(cleanup);

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
    agentShare: {
      getByAgent: vi.fn().mockResolvedValue({ totalCount: 0, items: [] }),
      apply: vi.fn().mockResolvedValue({}),
      rotateShareLink: vi.fn().mockResolvedValue({}),
    },
    billing: { getOrCreateBillingAccount: vi.fn().mockResolvedValue(null) },
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

const AGENT = {
  metadata: {
    id: "agt_1",
    org: "acme",
    slug: "support-agent",
    name: "Support Agent",
  },
  spec: {},
} as never;

describe("useShareAgent", () => {
  it("returns a Share action in the sharing group when the user can edit", async () => {
    const { result } = renderHook(() => useShareAgent({ agent: AGENT }), {
      wrapper: wrapper(createMockStigmer({ isAuthorized: true })),
    });

    await waitFor(() => expect(result.current.action).not.toBeNull());
    expect(result.current.action?.id).toBe("share");
    expect(result.current.action?.label).toBe("Share");
    expect(result.current.action?.group).toBe("sharing");
  });

  it("returns a null action while the agent is loading", () => {
    const checkMyPermission = vi.fn();
    const { result } = renderHook(() => useShareAgent({ agent: null }), {
      wrapper: wrapper(createMockStigmer({ checkMyPermission })),
    });

    expect(result.current.action).toBeNull();
    expect(result.current.dialog).toBeNull();
    expect(checkMyPermission).not.toHaveBeenCalled();
  });

  it("returns a null action when the user lacks can_edit", async () => {
    const client = createMockStigmer({ isAuthorized: false });
    const { result } = renderHook(() => useShareAgent({ agent: AGENT }), {
      wrapper: wrapper(client),
    });

    await waitFor(() =>
      expect(
        (client as { iamPolicy: { checkMyPermission: ReturnType<typeof vi.fn> } })
          .iamPolicy.checkMyPermission,
      ).toHaveBeenCalled(),
    );
    await waitFor(() => expect(result.current.action).toBeNull());
  });

  it("checks the can_edit relation on the agent", async () => {
    const client = createMockStigmer({ isAuthorized: true });
    renderHook(() => useShareAgent({ agent: AGENT }), {
      wrapper: wrapper(client),
    });

    const check = (
      client as { iamPolicy: { checkMyPermission: ReturnType<typeof vi.fn> } }
    ).iamPolicy.checkMyPermission;
    await waitFor(() => expect(check).toHaveBeenCalled());
    const input = check.mock.calls[0][0] as {
      resource?: { kind: string; id: string };
      relation: string;
    };
    expect(input.relation).toBe("can_edit");
    expect(input.resource?.kind).toBe("agent");
    expect(input.resource?.id).toBe("agt_1");
  });

  it("opens the dialog via the action", async () => {
    const { result } = renderHook(() => useShareAgent({ agent: AGENT }), {
      wrapper: wrapper(createMockStigmer({ isAuthorized: true })),
    });

    await waitFor(() => expect(result.current.action).not.toBeNull());
    expect(result.current.isOpen).toBe(false);

    result.current.action?.onAction();
    await waitFor(() => expect(result.current.isOpen).toBe(true));
  });
});
