/**
 * useOrgSlugForId and useOrgIdForRef translate between an organization's id
 * and slug for the person's own organizations and the one they have open (a
 * child organization outside their list), and hand back anything else
 * unchanged, including when no OrgProvider is mounted.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "../../context";
import { OrgProvider, findOrgByRef, useOrg } from "../OrgProvider";
import { useOrgIdForRef, useOrgSlugForId } from "../useOrgRefs";

afterEach(cleanup);

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const CHILD_ID = "org_01jccccccccccccccccccccccc";

const orgs = [
  { metadata: { id: ACME_ID, slug: "acme", name: "Acme" } },
  { metadata: { id: "legacy", slug: "legacy", name: "Legacy" } },
] as Organization[];

const child = {
  metadata: { id: CHILD_ID, slug: "acme-customer", name: "Customer" },
  spec: { parentOrg: ACME_ID },
} as Organization;

function wrapper({ children }: { children: ReactNode }) {
  const client = {
    organization: {
      listMine: vi.fn().mockResolvedValue({ entries: orgs, nextPageToken: "" }),
      get: vi.fn().mockResolvedValue(child),
    },
  };
  return (
    <StigmerContext.Provider value={client as never}>
      <OrgProvider>{children}</OrgProvider>
    </StigmerContext.Provider>
  );
}

function renderRefs() {
  return renderHook(
    () => ({
      loaded: useOrg().orgs.length > 0,
      activeId: useOrg().activeOrg?.metadata?.id,
      slugFor: useOrgSlugForId(),
      idFor: useOrgIdForRef(),
    }),
    { wrapper },
  );
}

describe("useOrgSlugForId", () => {
  beforeEach(() => localStorage.clear());

  it("answers the slug of one of the person's organizations", async () => {
    const { result } = renderRefs();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.slugFor(ACME_ID)).toBe("acme");
    expect(result.current.slugFor("legacy")).toBe("legacy");
  });

  it("hands back an id it does not know", async () => {
    const { result } = renderRefs();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.slugFor("org_01jzzzzzzzzzzzzzzzzzzzzzzz")).toBe(
      "org_01jzzzzzzzzzzzzzzzzzzzzzzz",
    );
    expect(result.current.slugFor("")).toBe("");
  });

  it("hands back its input when no OrgProvider is mounted", () => {
    const { result } = renderHook(() => useOrgSlugForId());
    expect(result.current(ACME_ID)).toBe(ACME_ID);
  });
});

describe("useOrgIdForRef", () => {
  beforeEach(() => localStorage.clear());

  it("answers the id an id or a current slug names", async () => {
    const { result } = renderRefs();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.idFor("acme")).toBe(ACME_ID);
    expect(result.current.idFor(ACME_ID)).toBe(ACME_ID);
  });

  it("hands back a reference it does not know", async () => {
    const { result } = renderRefs();
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.idFor("initech")).toBe("initech");
  });
});

describe("findOrgByRef", () => {
  it("finds an organization by id first, then by slug", () => {
    expect(findOrgByRef(orgs, ACME_ID)?.metadata?.slug).toBe("acme");
    expect(findOrgByRef(orgs, "acme")?.metadata?.id).toBe(ACME_ID);
  });

  it("names no organization for an empty reference, even one whose id and slug are unset", () => {
    const withBlank = [...orgs, { metadata: { id: "", slug: "", name: "Blank" } }] as Organization[];
    expect(findOrgByRef(withBlank, "")).toBeUndefined();
  });
});

describe("an opened organization outside the person's list", () => {
  beforeEach(() => localStorage.clear());

  it("resolves both ways while it is the active one", async () => {
    localStorage.setItem("stigmer:activeOrg", CHILD_ID);
    const { result } = renderRefs();
    await waitFor(() => expect(result.current.activeId).toBe(CHILD_ID));
    expect(result.current.slugFor(CHILD_ID)).toBe("acme-customer");
    expect(result.current.idFor("acme-customer")).toBe(CHILD_ID);
    expect(result.current.slugFor(ACME_ID)).toBe("acme");
  });
});
