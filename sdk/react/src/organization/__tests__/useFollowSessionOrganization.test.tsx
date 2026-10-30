/**
 * Pins useFollowSessionOrganization (stigmer/stigmer#1580): a session page's
 * shell follows the session into its own organization.
 *
 * - a session from another of the person's organizations makes that one
 *   active, and the choice is persisted like any switch;
 * - a session in the active organization, or in one the person does not
 *   belong to, switches nothing;
 * - it aligns once per visit: a choice made while the conversation stays
 *   open stands, and a new visit follows again;
 * - a session that loads before the organization list waits for it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import {
  SessionSchema,
  type Session,
} from "@stigmer/apis/ai/stigmer/agentic/session/v1/api_pb";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "@stigmer/react-core";
import { FetchCache } from "@stigmer/react-core/internal";
import { FetchCacheContext } from "@stigmer/react-core/internal";
import { OrgProvider, useOrg } from "../OrgProvider";
import { useFollowSessionOrganization } from "../useFollowSessionOrganization";

// Ids differ from slugs, as for every organization made today: a stored
// session names its organization by id.
const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
const GLOBEX_ID = "org_01jbbbbbbbbbbbbbbbbbbbbbbb";
const acme = {
  metadata: { id: ACME_ID, slug: "acme", name: "Acme" },
} as Organization;
const globex = {
  metadata: { id: GLOBEX_ID, slug: "globex", name: "Globex" },
} as Organization;

function sessionIn(id: string, org: string): Session {
  return create(SessionSchema, { metadata: { id, org } });
}

function createMockStigmer(orgs: Promise<Organization[]>) {
  return {
    organization: {
      listMine: vi
        .fn()
        .mockImplementation(async () => ({ entries: await orgs, nextPageToken: "" })),
    },
  } as never;
}

function wrapper(client: unknown) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={client as never}>
        <FetchCacheContext.Provider value={new FetchCache()}>
          <OrgProvider>{children}</OrgProvider>
        </FetchCacheContext.Provider>
      </StigmerContext.Provider>
    );
  };
}

/** The org context as seen by a page that follows `session`. */
function renderFollowing(
  session: Session | null,
  orgs: Promise<Organization[]> = Promise.resolve([acme, globex]),
) {
  return renderHook(
    ({ current }: { current: Session | null }) => {
      useFollowSessionOrganization(current);
      return useOrg();
    },
    {
      wrapper: wrapper(createMockStigmer(orgs)),
      initialProps: { current: session },
    },
  );
}

describe("useFollowSessionOrganization", () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem("stigmer:activeOrg", ACME_ID);
  });

  it("makes a session's organization active when the person belongs to it, and persists it", async () => {
    const { result } = renderFollowing(sessionIn("ses_1", GLOBEX_ID));

    await waitFor(() =>
      expect(result.current.activeOrg?.metadata?.slug).toBe("globex"),
    );
    expect(localStorage.getItem("stigmer:activeOrg")).toBe(GLOBEX_ID);
  });

  it("switches nothing for a session in the active organization", async () => {
    const { result } = renderFollowing(sessionIn("ses_1", ACME_ID));

    await waitFor(() => expect(result.current.activeOrg).not.toBeNull());
    // act flushes every pending effect and the state updates they make, so
    // a switch the hook would make has landed before the assertion.
    await act(async () => {});
    expect(result.current.activeOrg?.metadata?.slug).toBe("acme");
  });

  it("switches nothing for a session in an organization the person does not belong to", async () => {
    const { result } = renderFollowing(sessionIn("ses_guest", "initech"));

    await waitFor(() => expect(result.current.activeOrg).not.toBeNull());
    // act flushes every pending effect and the state updates they make, so
    // a switch the hook would make has landed before the assertion.
    await act(async () => {});
    expect(result.current.activeOrg?.metadata?.slug).toBe("acme");
  });

  it("aligns once per visit: a choice made while the conversation stays open stands", async () => {
    const session = sessionIn("ses_1", GLOBEX_ID);
    const { result, rerender } = renderFollowing(session);
    await waitFor(() =>
      expect(result.current.activeOrg?.metadata?.slug).toBe("globex"),
    );

    act(() => result.current.setActiveOrg(acme));
    rerender({ current: session });
    // act flushes every pending effect and the state updates they make, so
    // a switch the hook would make has landed before the assertion.
    await act(async () => {});
    expect(result.current.activeOrg?.metadata?.slug).toBe("acme");

    rerender({ current: sessionIn("ses_2", GLOBEX_ID) });
    await waitFor(() =>
      expect(result.current.activeOrg?.metadata?.slug).toBe("globex"),
    );
  });

  it("follows again on a new visit to the conversation", async () => {
    const session = sessionIn("ses_1", GLOBEX_ID);
    const first = renderFollowing(session);
    await waitFor(() =>
      expect(first.result.current.activeOrg?.metadata?.slug).toBe("globex"),
    );
    act(() => first.result.current.setActiveOrg(acme));
    first.unmount();

    const again = renderFollowing(session);

    await waitFor(() =>
      expect(again.result.current.activeOrg?.metadata?.slug).toBe("globex"),
    );
  });

  it("waits for the organization list when the session loads first", async () => {
    let release: (orgs: Organization[]) => void = () => {};
    const orgs = new Promise<Organization[]>((resolve) => {
      release = resolve;
    });
    const { result } = renderFollowing(sessionIn("ses_1", GLOBEX_ID), orgs);
    expect(result.current.activeOrg).toBeNull();

    await act(async () => {
      release([acme, globex]);
      await orgs;
    });

    await waitFor(() =>
      expect(result.current.activeOrg?.metadata?.slug).toBe("globex"),
    );
  });
});
