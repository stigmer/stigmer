/**
 * useCanonicalOrgSlug answers the slug a URL's org segment should read: none
 * for a current slug, the slug for one of the person's org ids without a
 * request, and the server's answer for anything else (an old slug after a
 * rename), never a previous segment's answer. The organization the person
 * has open outside their list counts as theirs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "../../context";
import { OrgProvider, useOrg } from "../OrgProvider";
import { useCanonicalOrgSlug } from "../useCanonicalOrgSlug";

afterEach(cleanup);

const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const GLOBEX_ID = "org_01jbbbbbbbbbbbbbbbbbbbbbbb";

const orgs = [
  { metadata: { id: ACME_ID, slug: "acme-labs", name: "Acme" } },
] as Organization[];

function setup(get: (id: string) => Promise<Organization>) {
  const client = {
    organization: {
      listMine: vi.fn().mockResolvedValue({ entries: orgs, nextPageToken: "" }),
      get: vi.fn(get),
    },
  };
  function wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        <OrgProvider>{children}</OrgProvider>
      </StigmerContext.Provider>
    );
  }
  return {
    get: client.organization.get,
    render: (segment: string) =>
      renderHook(
        ({ seg }: { seg: string }) => ({
          loaded: !useOrg().isLoading,
          canonical: useCanonicalOrgSlug(seg),
        }),
        { wrapper, initialProps: { seg: segment } },
      ),
  };
}

describe("useCanonicalOrgSlug", () => {
  beforeEach(() => localStorage.clear());

  it("answers nothing for a current slug, and asks nobody", async () => {
    const { render, get } = setup(async () => orgs[0]!);
    const { result } = render("acme-labs");
    await waitFor(() => expect(result.current.loaded).toBe(true));
    expect(result.current.canonical).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });

  it("answers the slug for one of the person's org ids, and asks nobody", async () => {
    const { render, get } = setup(async () => orgs[0]!);
    const { result } = render(ACME_ID);
    await waitFor(() => expect(result.current.canonical).toBe("acme-labs"));
    expect(get).not.toHaveBeenCalled();
  });

  it("answers the current slug for an old one, as the server resolves it", async () => {
    const { render, get } = setup(async () => orgs[0]!);
    const { result } = render("acme");
    await waitFor(() => expect(result.current.canonical).toBe("acme-labs"));
    expect(get).toHaveBeenCalledWith("acme");
  });

  it("answers nothing when the server refuses the lookup", async () => {
    const { render, get } = setup(async () => {
      throw new Error("permission denied");
    });
    const { result } = render("initech");
    await waitFor(() => expect(get).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.canonical).toBeNull();
  });

  it("never reads a previous segment's answer as the next one's", async () => {
    const answers: Record<string, Organization> = {
      [GLOBEX_ID]: { metadata: { id: GLOBEX_ID, slug: "globex" } } as Organization,
      initech: { metadata: { id: "initech", slug: "initech" } } as Organization,
    };
    const { render } = setup(async (id) => answers[id]!);
    const { result, rerender } = render(GLOBEX_ID);
    await waitFor(() => expect(result.current.canonical).toBe("globex"));

    rerender({ seg: "initech" });
    expect(result.current.canonical).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(result.current.canonical).toBeNull();
  });
});

describe("useCanonicalOrgSlug in an opened organization outside the person's list", () => {
  const CHILD_ID = "org_01jccccccccccccccccccccccc";
  const child = { metadata: { id: CHILD_ID, slug: "acme-customer" } } as Organization;

  beforeEach(() => localStorage.clear());

  it("reads its slug as canonical and maps its id, with no lookup beyond the provider's own read", async () => {
    localStorage.setItem("stigmer:activeOrg", CHILD_ID);
    const { render, get } = setup(async () => child);

    const bySlug = render("acme-customer");
    await waitFor(() => expect(bySlug.result.current.loaded).toBe(true));
    expect(bySlug.result.current.canonical).toBeNull();

    const byId = render(CHILD_ID);
    await waitFor(() => expect(byId.result.current.canonical).toBe("acme-customer"));

    // One read per provider mount (two renders, two providers), each the
    // provider restoring the remembered child; the hook asked for nothing.
    expect(get.mock.calls).toEqual([[CHILD_ID], [CHILD_ID]]);
  });
});
