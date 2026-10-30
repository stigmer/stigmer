/**
 * A mounted OrgProvider whose person belongs to organizations with minted ids
 * distinct from their slugs, for tests that pin what a component reads (a
 * slug) apart from what it stores and sends (an id).
 *
 * Not a `.test` file and inside `__tests__` deliberately: vitest does not
 * collect it, and the build excludes keep it out of the published package.
 */
import { vi } from "vitest";
import type { ReactNode } from "react";
import type { Organization } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { StigmerContext } from "@stigmer/react-core";
import { OrgProvider, useOrg } from "../OrgProvider";

export const ACME_ID = "org_01jaaaaaaaaaaaaaaaaaaaaaaa";
export const GLOBEX_ID = "org_01jbbbbbbbbbbbbbbbbbbbbbbb";

/** An organization the person belongs to. */
export function orgEntry(id: string, slug: string): Organization {
  return { metadata: { id, slug, name: slug } } as Organization;
}

/** Acme (active by default, as the first entry) and Globex. */
export const ORGS: Organization[] = [orgEntry(ACME_ID, "acme"), orgEntry(GLOBEX_ID, "globex")];

/**
 * Renders its children once the person's organizations have loaded, for a
 * test whose first interaction must already see them.
 */
export function WhenOrgsLoaded({ children }: { children: ReactNode }) {
  return useOrg().isLoading ? null : <>{children}</>;
}

/**
 * A wrapper mounting `OrgProvider` over a client whose
 * `listMine` answers `orgs`; `client` adds the other services the
 * component under test calls. With `waitForOrgs`, the children mount only
 * once the organizations have loaded.
 */
export function orgWrapper(
  client: Record<string, unknown> = {},
  orgs: Organization[] = ORGS,
  waitForOrgs = false,
) {
  const value = {
    ...client,
    organization: {
      // An organization read by id answers the fixture's entry; a test that
      // needs more (its preferences) passes its own `get`.
      get: vi.fn(async (id: string) => orgs.find((org) => org.metadata?.id === id) ?? null),
      ...(client.organization as Record<string, unknown> | undefined),
      listMine: vi.fn().mockResolvedValue({ entries: orgs, nextPageToken: "" }),
    },
  };
  return function OrgFixture({ children }: { children: ReactNode }) {
    return (
      <StigmerContext.Provider value={value as never}>
        <OrgProvider>
          {waitForOrgs ? <WhenOrgsLoaded>{children}</WhenOrgsLoaded> : children}
        </OrgProvider>
      </StigmerContext.Provider>
    );
  };
}
