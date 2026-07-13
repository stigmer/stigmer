import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { StigmerContext } from "../../context";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { useCreateExternalShareLink } from "../useCreateExternalShareLink";

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

function makeAgent(visibility: ApiResourceVisibility) {
  return {
    metadata: {
      id: "agt_1",
      org: "provider-org",
      slug: "public-helper",
      name: "Public Helper",
      visibility,
    },
    spec: {},
  } as never;
}

const PUBLIC_AGENT = makeAgent(ApiResourceVisibility.visibility_public);
const PRIVATE_AGENT = makeAgent(ApiResourceVisibility.visibility_private);

describe("useCreateExternalShareLink", () => {
  it("offers the action on another org's public agent when the viewer holds the org bar", async () => {
    const { result } = renderHook(
      () =>
        useCreateExternalShareLink({
          agent: PUBLIC_AGENT,
          viewerOrg: "consumer-org",
        }),
      { wrapper: wrapper(createMockStigmer({ isAuthorized: true })) },
    );

    await waitFor(() => expect(result.current.action).not.toBeNull());
    expect(result.current.action?.id).toBe("create-share-link");
    expect(result.current.action?.label).toBe("Create share link");
    expect(result.current.action?.group).toBe("sharing");
  });

  it("checks can_create_agent_share on the VIEWER's org (id = slug)", async () => {
    const client = createMockStigmer({ isAuthorized: true });
    renderHook(
      () =>
        useCreateExternalShareLink({
          agent: PUBLIC_AGENT,
          viewerOrg: "consumer-org",
        }),
      { wrapper: wrapper(client) },
    );

    const check = (
      client as { iamPolicy: { checkMyPermission: ReturnType<typeof vi.fn> } }
    ).iamPolicy.checkMyPermission;
    await waitFor(() => expect(check).toHaveBeenCalled());
    const input = check.mock.calls[0][0] as {
      resource?: { kind: string; id: string };
      relation: string;
    };
    expect(input.relation).toBe("can_create_agent_share");
    expect(input.resource?.kind).toBe("organization");
    expect(input.resource?.id).toBe("consumer-org");
  });

  it("stays null on the viewer's OWN agents — the same-org Share entry covers those", () => {
    const checkMyPermission = vi.fn();
    const { result } = renderHook(
      () =>
        useCreateExternalShareLink({
          agent: PUBLIC_AGENT,
          viewerOrg: "provider-org",
        }),
      { wrapper: wrapper(createMockStigmer({ checkMyPermission })) },
    );

    expect(result.current.action).toBeNull();
    expect(result.current.dialog).toBeNull();
    // Not applicable structurally: no permission round-trip is spent.
    expect(checkMyPermission).not.toHaveBeenCalled();
  });

  it("stays null on a non-public agent — visibility is the origin org's consent", () => {
    const checkMyPermission = vi.fn();
    const { result } = renderHook(
      () =>
        useCreateExternalShareLink({
          agent: PRIVATE_AGENT,
          viewerOrg: "consumer-org",
        }),
      { wrapper: wrapper(createMockStigmer({ checkMyPermission })) },
    );

    expect(result.current.action).toBeNull();
    expect(checkMyPermission).not.toHaveBeenCalled();
  });

  it("stays null while the agent is loading or the viewer org is unknown", () => {
    const client = createMockStigmer();
    const { result: loading } = renderHook(
      () => useCreateExternalShareLink({ agent: null, viewerOrg: "consumer-org" }),
      { wrapper: wrapper(client) },
    );
    const { result: orgless } = renderHook(
      () => useCreateExternalShareLink({ agent: PUBLIC_AGENT, viewerOrg: "" }),
      { wrapper: wrapper(client) },
    );

    expect(loading.current.action).toBeNull();
    expect(orgless.current.action).toBeNull();
  });

  it("hides the action when the viewer lacks the org-side permission", async () => {
    const client = createMockStigmer({ isAuthorized: false });
    const { result } = renderHook(
      () =>
        useCreateExternalShareLink({
          agent: PUBLIC_AGENT,
          viewerOrg: "consumer-org",
        }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() =>
      expect(
        (client as { iamPolicy: { checkMyPermission: ReturnType<typeof vi.fn> } })
          .iamPolicy.checkMyPermission,
      ).toHaveBeenCalled(),
    );
    await waitFor(() => expect(result.current.action).toBeNull());
  });

  it("opens the cross-org dialog via the action", async () => {
    const { result } = renderHook(
      () =>
        useCreateExternalShareLink({
          agent: PUBLIC_AGENT,
          viewerOrg: "consumer-org",
        }),
      { wrapper: wrapper(createMockStigmer({ isAuthorized: true })) },
    );

    await waitFor(() => expect(result.current.action).not.toBeNull());
    expect(result.current.isOpen).toBe(false);

    result.current.action?.onAction();
    await waitFor(() => expect(result.current.isOpen).toBe(true));
  });
});
