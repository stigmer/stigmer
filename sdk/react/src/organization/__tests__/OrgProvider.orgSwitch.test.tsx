import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "../../context";
import { FetchCache } from "../../internal/fetch-cache";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { OrgProvider, useOrg } from "../OrgProvider";

const acme = { metadata: { id: "acme", slug: "acme", name: "Acme" } } as Organization;
const globex = { metadata: { id: "globex", slug: "globex", name: "Globex" } } as Organization;

function createMockStigmer(orgs: Organization[]) {
  return {
    organization: {
      findMyOrganizations: vi.fn().mockResolvedValue({ entries: orgs }),
    },
  } as never;
}

function wrapper(client: unknown, cache: FetchCache | null) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        <FetchCacheContext.Provider value={cache}>
          <OrgProvider>{children}</OrgProvider>
        </FetchCacheContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

describe("OrgProvider — org-switch cache invalidation", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clears the fetch cache when the active org changes", async () => {
    const cache = new FetchCache();
    cache.set("session:ses_1", { stale: "from previous org context" });

    const { result } = renderHook(() => useOrg(), {
      wrapper: wrapper(createMockStigmer([acme, globex]), cache),
    });

    await waitFor(() => expect(result.current.activeOrg).not.toBeNull());

    // Initial restore must NOT clear — only a genuine change of context does.
    // Session/execution cache keys are id-scoped (not org-scoped), so without
    // the clear a switched-away org's view state would survive its 5-min TTL.
    expect(cache.has("session:ses_1")).toBe(true);

    act(() => result.current.setActiveOrg(globex));

    await waitFor(() => expect(cache.has("session:ses_1")).toBe(false));
    expect(result.current.activeOrg?.metadata?.slug).toBe("globex");
  });

  it("does not clear when re-selecting the already-active org", async () => {
    const cache = new FetchCache();

    const { result } = renderHook(() => useOrg(), {
      wrapper: wrapper(createMockStigmer([acme, globex]), cache),
    });

    await waitFor(() => expect(result.current.activeOrg).not.toBeNull());
    const active = result.current.activeOrg!;

    cache.set("session:ses_1", { fresh: true });
    act(() => result.current.setActiveOrg(active));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(cache.has("session:ses_1")).toBe(true);
  });

  it("works without a FetchCacheProvider (no-op, no crash)", async () => {
    const { result } = renderHook(() => useOrg(), {
      wrapper: wrapper(createMockStigmer([acme, globex]), null),
    });

    await waitFor(() => expect(result.current.activeOrg).not.toBeNull());

    act(() => result.current.setActiveOrg(globex));

    await waitFor(() =>
      expect(result.current.activeOrg?.metadata?.slug).toBe("globex"),
    );
  });
});
