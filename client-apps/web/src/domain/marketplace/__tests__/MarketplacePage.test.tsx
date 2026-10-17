/**
 * Pins the web Marketplace page's wiring: the catalogue installs into the
 * active organization by its id, the heading names that organization by
 * its slug, and an installed plugin opens at a URL whose org segment is the
 * slug of the org the plugin names by id. The catalogue is pinned in
 * @stigmer/react-sdk.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

interface CatalogProps {
  org: string;
  onInstalled: (result: {
    plugin: { metadata?: { org?: string; slug?: string } };
  }) => void;
}

const page = vi.hoisted(() => ({
  catalog: [] as CatalogProps[],
  pushed: [] as string[],
}));

vi.mock("@stigmer/react-sdk", () => ({
  MarketplaceCatalog: (props: CatalogProps) => {
    page.catalog.push(props);
    return null;
  },
  useActiveOrgId: () => "org_acme",
  useActiveOrgSlug: () => "acme",
  // The person's organizations: org_acme reads "acme" in a URL.
  useOrgSlugForId: () => (id: string) => (id === "org_acme" ? "acme" : id),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (url: string) => page.pushed.push(url) }),
}));

import { MarketplacePage } from "../MarketplacePage";

beforeEach(() => {
  page.catalog.length = 0;
  page.pushed.length = 0;
});

describe("web MarketplacePage", () => {
  it("installs into the active org id and names that org by its slug", () => {
    render(<MarketplacePage />);

    expect(page.catalog.at(-1)?.org).toBe("org_acme");
    expect(screen.getByText(/Plugins you can install into acme:/)).toBeTruthy();
  });

  it("opens an installed plugin under its org's slug", () => {
    render(<MarketplacePage />);

    const plugin = { metadata: { org: "org_acme", slug: "kit" } };
    act(() => page.catalog.at(-1)?.onInstalled({ plugin }));

    expect(page.pushed).toEqual(["/library/plugins/acme/kit"]);
  });
});
