/**
 * The Marketplace page against a fetch fake and a router transport. Pins:
 * one section per known source, the four built-ins first, then an added
 * one; a section that cannot be read says so in its own section and the
 * page stands (the official one on a development server, the vendors
 * unreachable here); the search box filters every section's cards; a card
 * for a plugin the organization already holds says "Installed"; Install on
 * a card opens the install dialog for that entry from that source; the
 * Sources disclosure lists the built-ins as such and offers Remove on the
 * added one only.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { Stigmer } from "@stigmer/sdk";
import { PluginQueryController } from "@stigmer/protos/ai/stigmer/agentic/plugin/v1/query_pb";
import { GetServerInfoOutputSchema, PlatformQueryController } from "@stigmer/protos/ai/stigmer/platform/v1/server_info_pb";
import { SearchService } from "@stigmer/protos/ai/stigmer/search/v1/query_pb";
import { SearchResponseSchema, SearchResultSchema } from "@stigmer/protos/ai/stigmer/search/v1/io_pb";

import { StigmerContext } from "../../context.js";
import { MarketplaceCatalog, filterEntries } from "../MarketplaceCatalog.js";
import { resetGitHubListingCache } from "../sources/github.js";
import { MARKETPLACES_STORAGE_KEY } from "../useMarketplaces.js";
import { HOSTED_MARKETPLACE_NAME, HOSTED_REPO, hostedFetch } from "./fixtures/hosted-marketplace.js";

const ORG = "acme";

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(MARKETPLACES_STORAGE_KEY, JSON.stringify({ [HOSTED_MARKETPLACE_NAME]: { type: "github", repo: HOSTED_REPO } }));
});

afterEach(() => {
  cleanup();
  resetGitHubListingCache();
});

function transport(installedSlugs: readonly string[]) {
  return createRouterTransport(({ service }) => {
    service(PlatformQueryController, {
      // A development server: the official catalogue is not published for it.
      getServerInfo: () => create(GetServerInfoOutputSchema, { edition: 1, version: "dev" }),
    });
    service(SearchService, {
      search: () =>
        create(SearchResponseSchema, {
          entries: installedSlugs.map((slug) => create(SearchResultSchema, { id: `plg_${slug}`, slug, name: slug, org: ORG })),
          totalCount: installedSlugs.length,
          totalPages: 1,
        }),
    });
    service(PluginQueryController, {
      getByReference: () => {
        throw new ConnectError("no plugin", Code.NotFound);
      },
    });
  });
}

function renderCatalog(installedSlugs: readonly string[] = []) {
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport(installedSlugs) });
  const { fetchImpl } = hostedFetch();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return render(<MarketplaceCatalog org={ORG} fetchImpl={fetchImpl} />, { wrapper });
}

describe("MarketplaceCatalog", () => {
  it("shows one section per source, built-ins first, and stands when some cannot be read", async () => {
    renderCatalog();
    const headings = await screen.findAllByRole("heading", { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual(["stigmer", "cursor-plugins", "claude-code-plugins", "codex-plugins", HOSTED_MARKETPLACE_NAME]);

    // The added source lists its two installable entries; the page did not wait for the others.
    await screen.findByRole("button", { name: "Install thermos" });
    expect(screen.getByRole("button", { name: "Install github" })).toBeTruthy();

    // The official source says why it cannot be read on a development server; the vendors are unreachable through this fake.
    await waitFor(() => expect(screen.getByText(/development build/)).toBeTruthy());
    await waitFor(() => expect(screen.getAllByText(/cannot be read right now/).length).toBeGreaterThanOrEqual(3));
  });

  it("filters every section's cards by the search box", async () => {
    renderCatalog();
    await screen.findByRole("button", { name: "Install thermos" });
    fireEvent.change(screen.getByLabelText("Search plugins"), { target: { value: "GIT" } });
    expect(screen.queryByRole("button", { name: "Install thermos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Install github" })).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search plugins"), { target: { value: "nothing-here" } });
    expect(screen.getByText("Nothing here matches 'nothing-here'.")).toBeTruthy();
  });

  it("marks a plugin the organization holds as Installed and still offers to install it again", async () => {
    renderCatalog(["thermos"]);
    const button = await screen.findByRole("button", { name: "Install thermos" });
    await waitFor(() => expect(screen.getByText("Installed")).toBeTruthy());
    expect(button.textContent).toBe("Install again");
  });

  it("opens the install dialog for the chosen entry from its source", async () => {
    renderCatalog();
    fireEvent.click(await screen.findByRole("button", { name: "Install github" }));
    const dialog = await screen.findByRole("dialog", { name: "Install github" });
    expect(within(dialog).getByText(new RegExp(`From ${HOSTED_MARKETPLACE_NAME} `))).toBeTruthy();
  });

  it("lists the sources behind a disclosure: the built-ins as such, Remove on the added one only", async () => {
    renderCatalog();
    await screen.findByRole("button", { name: "Install thermos" });
    const list = screen.getByRole("list", { name: "Known sources" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(5);
    expect(items[0]?.textContent).toContain("stigmer");
    expect(items[0]?.textContent).toContain("built in");
    expect(items[1]?.textContent).toContain("(built in)");
    expect(within(list).getAllByRole("button", { name: /^Remove source/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
      `Remove source ${HOSTED_MARKETPLACE_NAME}`,
    ]);
  });
});

describe("filterEntries", () => {
  const entries = [
    { name: "thermos", dir: "thermos", description: "Keeps things warm." },
    { name: "github", dir: "third_party/github" },
  ];
  it("matches name or description case-insensitively and returns everything for an empty query", () => {
    expect(filterEntries(entries, "")).toBe(entries);
    expect(filterEntries(entries, "  ").length).toBe(2);
    expect(filterEntries(entries, "WARM").map((e) => e.name)).toEqual(["thermos"]);
    expect(filterEntries(entries, "hub").map((e) => e.name)).toEqual(["github"]);
    expect(filterEntries(entries, "zzz")).toEqual([]);
  });
});
