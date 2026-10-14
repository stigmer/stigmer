/**
 * OrgProvider remembers the active organization by its id: a choice
 * survives a reload under `stigmer:activeOrg`, survives a rename of the
 * chosen organization (its slug changes, its id does not), and `refresh`
 * selects the organization a target names by id or by slug. A remembered
 * value that names no organization, or is empty, falls back to the first.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "../../context";
import { FetchCache } from "../../internal/fetch-cache";
import { FetchCacheContext } from "../../internal/FetchCacheProvider";
import { OrgProvider, useActiveOrgId, useActiveOrgSlug, useOrg } from "../OrgProvider";

afterEach(cleanup);

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const GLOBEX_ID = "org_01jbbbbbbbbbbbbbbbbbbbbbbb";

function org(id: string, slug: string): Organization {
  return { metadata: { id, slug, name: slug } } as Organization;
}

/** Each fetch answers the next list; the last one repeats. */
function createMockStigmer(lists: Organization[][]) {
  let calls = 0;
  const listMine = vi.fn(async () => {
    const entries = lists[Math.min(calls, lists.length - 1)];
    calls += 1;
    return { entries, nextPageToken: "" };
  });
  return { organization: { listMine } } as never;
}

function renderOrg(client: unknown, cache: FetchCache | null = null) {
  return renderHook(
    () => ({ ctx: useOrg(), id: useActiveOrgId(), slug: useActiveOrgSlug() }),
    {
      wrapper: function Wrapper({ children }: { children: ReactNode }) {
        return (
          <StigmerContext.Provider value={client as never}>
            <FetchCacheContext.Provider value={cache}>
              <OrgProvider>{children}</OrgProvider>
            </FetchCacheContext.Provider>
          </StigmerContext.Provider>
        );
      },
    },
  );
}

describe("OrgProvider persistence by id", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("persists the active org's id, not its slug", async () => {
    const { result } = renderOrg(
      createMockStigmer([[org(ACME_ID, "acme"), org(GLOBEX_ID, "globex")]]),
    );
    await waitFor(() => expect(result.current.id).toBe(ACME_ID));
    expect(localStorage.getItem("stigmer:activeOrg")).toBe(ACME_ID);

    act(() => result.current.ctx.setActiveOrg(org(GLOBEX_ID, "globex")));
    expect(localStorage.getItem("stigmer:activeOrg")).toBe(GLOBEX_ID);
    expect(localStorage.getItem("stigmer:activeOrgSlug")).toBeNull();
  });

  it("restores the remembered org by id", async () => {
    localStorage.setItem("stigmer:activeOrg", GLOBEX_ID);
    const { result } = renderOrg(
      createMockStigmer([[org(ACME_ID, "acme"), org(GLOBEX_ID, "globex")]]),
    );
    await waitFor(() => expect(result.current.id).toBe(GLOBEX_ID));
    expect(result.current.slug).toBe("globex");
  });

  it("keeps the remembered org after it is renamed, without clearing the cache", async () => {
    localStorage.setItem("stigmer:activeOrg", GLOBEX_ID);
    const cache = new FetchCache();
    const { result } = renderOrg(
      createMockStigmer([
        [org(ACME_ID, "acme"), org(GLOBEX_ID, "globex")],
        [org(ACME_ID, "acme"), org(GLOBEX_ID, "globex-labs")],
      ]),
      cache,
    );
    await waitFor(() => expect(result.current.slug).toBe("globex"));
    cache.set("session:ses_1", { kept: true });

    await act(async () => result.current.ctx.refresh());

    await waitFor(() => expect(result.current.slug).toBe("globex-labs"));
    expect(result.current.id).toBe(GLOBEX_ID);
    expect(cache.has("session:ses_1")).toBe(true);
  });

  it("selects the org a refresh target names, by id or by slug", async () => {
    const both = [org(ACME_ID, "acme"), org(GLOBEX_ID, "globex")];
    const { result } = renderOrg(createMockStigmer([both]));
    await waitFor(() => expect(result.current.id).toBe(ACME_ID));

    await act(async () => result.current.ctx.refresh(GLOBEX_ID));
    await waitFor(() => expect(result.current.id).toBe(GLOBEX_ID));

    await act(async () => result.current.ctx.refresh("acme"));
    await waitFor(() => expect(result.current.id).toBe(ACME_ID));
    expect(localStorage.getItem("stigmer:activeOrg")).toBe(ACME_ID);
  });

  it("keeps the choice an earlier release remembered by slug, then remembers it by id alone", async () => {
    localStorage.setItem("stigmer:activeOrgSlug", "globex");
    const { result } = renderOrg(
      createMockStigmer([[org(ACME_ID, "acme"), org(GLOBEX_ID, "globex")]]),
    );
    await waitFor(() => expect(result.current.id).toBe(GLOBEX_ID));
    expect(localStorage.getItem("stigmer:activeOrg")).toBe(GLOBEX_ID);
    expect(localStorage.getItem("stigmer:activeOrgSlug")).toBeNull();
  });

  it("prefers the remembered id over a slug an earlier release left behind", async () => {
    localStorage.setItem("stigmer:activeOrg", ACME_ID);
    localStorage.setItem("stigmer:activeOrgSlug", "globex");
    const { result } = renderOrg(
      createMockStigmer([[org(ACME_ID, "acme"), org(GLOBEX_ID, "globex")]]),
    );
    await waitFor(() => expect(result.current.id).toBe(ACME_ID));
    expect(localStorage.getItem("stigmer:activeOrgSlug")).toBeNull();
  });

  it("falls back to the first org when the remembered id names none of them", async () => {
    localStorage.setItem("stigmer:activeOrg", "org_01jzzzzzzzzzzzzzzzzzzzzzzz");
    const { result } = renderOrg(
      createMockStigmer([[org(ACME_ID, "acme"), org(GLOBEX_ID, "globex")]]),
    );
    await waitFor(() => expect(result.current.id).toBe(ACME_ID));
    expect(localStorage.getItem("stigmer:activeOrg")).toBe(ACME_ID);
  });

  it("falls back to the first org for an unknown slug an earlier release remembered, and drops it", async () => {
    localStorage.setItem("stigmer:activeOrgSlug", "initech");
    const { result } = renderOrg(
      createMockStigmer([[org(ACME_ID, "acme"), org(GLOBEX_ID, "globex")]]),
    );
    await waitFor(() => expect(result.current.id).toBe(ACME_ID));
    expect(localStorage.getItem("stigmer:activeOrg")).toBe(ACME_ID);
    expect(localStorage.getItem("stigmer:activeOrgSlug")).toBeNull();
  });

  it("reads an empty remembered id as none, falling through to an earlier release's slug", async () => {
    localStorage.setItem("stigmer:activeOrg", "");
    localStorage.setItem("stigmer:activeOrgSlug", "globex");
    const { result } = renderOrg(
      createMockStigmer([[org(ACME_ID, "acme"), org(GLOBEX_ID, "globex")]]),
    );
    await waitFor(() => expect(result.current.id).toBe(GLOBEX_ID));
    expect(localStorage.getItem("stigmer:activeOrg")).toBe(GLOBEX_ID);
    expect(localStorage.getItem("stigmer:activeOrgSlug")).toBeNull();
  });

  it("reads an empty remembered id as none, falling back to the first org", async () => {
    localStorage.setItem("stigmer:activeOrg", "");
    const { result } = renderOrg(
      createMockStigmer([[org(ACME_ID, "acme"), org(GLOBEX_ID, "globex")]]),
    );
    await waitFor(() => expect(result.current.id).toBe(ACME_ID));
    expect(localStorage.getItem("stigmer:activeOrg")).toBe(ACME_ID);
  });

  it("treats an older org whose id equals its slug like any other", async () => {
    localStorage.setItem("stigmer:activeOrg", "legacy");
    const { result } = renderOrg(
      createMockStigmer([[org(ACME_ID, "acme"), org("legacy", "legacy")]]),
    );
    await waitFor(() => expect(result.current.id).toBe("legacy"));
  });
});
