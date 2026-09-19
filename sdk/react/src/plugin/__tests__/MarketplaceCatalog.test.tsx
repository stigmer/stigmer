/**
 * The Marketplace page against a fetch fake and a router transport. Pins:
 * the sources come first as chips, "All sources" then the four built-ins
 * then an added one, each chip carrying its count once read and a warning
 * when it cannot be read, and the page stands when some cannot (the
 * official one on a development server, the vendors unreachable here);
 * choosing a chip narrows the grid to that source and, for a failed one,
 * shows its sentence with a retry; one grid across the sources, the
 * Upload tile first, cards wearing the plugin's display name, author and
 * logo where the manifest carries them and a monogram where it does not,
 * each naming its source; the search box filters the grid and hides the
 * Upload tile; a card for a plugin the organization already holds says
 * "Installed"; Install on a card opens the install dialog for that entry
 * from that source; the Upload tile opens the uploader in a dialog; the
 * grid pages at CATALOG_PAGE_SIZE and a new query returns to page one;
 * Manage sources opens the dialog listing the built-ins as such with
 * Remove on the added one only, and each row says what its catalogue
 * offers and what it lists that cannot be installed, a fact the grid
 * itself never shows.
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
import { CATALOG_PAGE_SIZE, MarketplaceCatalog, filterEntries } from "../MarketplaceCatalog.js";
import { resetGitHubListingCache } from "../sources/github.js";
import { MARKETPLACES_STORAGE_KEY } from "../useMarketplaces.js";
import { HOSTED_COMMIT, HOSTED_MARKETPLACE_NAME, HOSTED_REPO, hostedFetch, hostedMarketplaceFiles } from "./fixtures/hosted-marketplace.js";

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

function renderCatalog(installedSlugs: readonly string[] = [], files = hostedMarketplaceFiles()) {
  const client = new Stigmer({ baseUrl: "/", getAccessToken: () => "t", customTransport: transport(installedSlugs) });
  const { fetchImpl } = hostedFetch(files);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StigmerContext.Provider value={client}>{children}</StigmerContext.Provider>
  );
  return render(<MarketplaceCatalog org={ORG} fetchImpl={fetchImpl} />, { wrapper });
}

/** The chips, by accessible name, in order. */
function chips() {
  return within(screen.getByRole("radiogroup", { name: "Sources" })).getAllByRole("radio");
}

function chip(name: string) {
  return within(screen.getByRole("radiogroup", { name: "Sources" })).getByRole("radio", { name });
}

describe("MarketplaceCatalog: the sources first", () => {
  it("lists All sources, the official catalogue and the added one as chips; the page stands when one cannot be read", async () => {
    renderCatalog();
    expect(chips().map((radio) => radio.getAttribute("aria-label"))).toEqual(["All sources", "stigmer", HOSTED_MARKETPLACE_NAME]);
    expect(chip("All sources").getAttribute("aria-checked")).toBe("true");

    // The added source's cards paint without waiting for the others; the chip shows its count.
    await screen.findByRole("button", { name: "Install thermos" });
    expect(screen.getByRole("button", { name: "Install github" })).toBeTruthy();
    await waitFor(() => expect(chip(HOSTED_MARKETPLACE_NAME).textContent).toContain("2"));

    // A source that cannot be read says so in one line, with a retry; the official one names the development build.
    await waitFor(() => expect(screen.getByRole("list", { name: "Sources that cannot be read" })).toBeTruthy());
    const failed = within(screen.getByRole("list", { name: "Sources that cannot be read" })).getAllByRole("listitem");
    expect(failed.map((item) => item.textContent)).toEqual([expect.stringMatching(/^stigmer.*development build/)]);
    expect(screen.getByRole("button", { name: "Retry stigmer" })).toBeTruthy();
  });

  it("choosing a chip narrows the grid to that source; a failed source shows its sentence whole with a retry", async () => {
    renderCatalog();
    await screen.findByRole("button", { name: "Install thermos" });
    await waitFor(() => expect(screen.getByRole("list", { name: "Sources that cannot be read" })).toBeTruthy());

    fireEvent.click(chip("stigmer"));
    expect(chip("stigmer").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("button", { name: "Install thermos" })).toBeNull();
    expect(screen.getByText(/development build/)).toBeTruthy();
    expect(screen.getByText("stigmer cannot be read right now")).toBeTruthy();
    // The Upload tile stays: uploading is not a source's business.
    expect(screen.getByRole("button", { name: /Upload a plugin/ })).toBeTruthy();

    fireEvent.click(chip(HOSTED_MARKETPLACE_NAME));
    expect(screen.getByRole("button", { name: "Install thermos" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Sources that cannot be read" })).toBeNull();
  });
});

describe("MarketplaceCatalog: the grid", () => {
  it("shows the Upload tile first, then cards with a face, a display name, an author and a source mark", async () => {
    renderCatalog();
    const grid = await screen.findByRole("list", { name: "Plugins" });
    const items = within(grid).getAllByRole("listitem");
    expect(within(items[0]!).getByRole("button", { name: /Upload a plugin/ })).toBeTruthy();

    // thermos: the manifest's display name, author and logo, once its manifest is read.
    const thermos = items[1]!;
    await waitFor(() => expect(within(thermos).getByRole("heading", { level: 3 }).textContent).toBe("Thermos"));
    expect(within(thermos).getByText("by Acme")).toBeTruthy();
    expect(within(thermos).getByText("Keeps things warm.")).toBeTruthy();
    const logo = thermos.querySelector<HTMLImageElement>("img[src*='thermos/assets/logo.png']");
    expect(logo?.getAttribute("src")).toBe(`https://raw.githubusercontent.com/${HOSTED_REPO}/${HOSTED_COMMIT}/thermos/assets/logo.png`);
    expect(logo?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(thermos.textContent).toContain(HOSTED_MARKETPLACE_NAME);

    // github: no display name, no logo, so the name stands and a monogram wears the first letter.
    const github = items[2]!;
    expect(within(github).getByRole("heading", { level: 3 }).textContent).toBe("github");
    await waitFor(() => expect(github.querySelector("[data-monogram]")?.getAttribute("data-monogram")).toBe("G"));
  });

  it("filters the grid by the search box, hides the Upload tile while searching, and says when nothing matches", async () => {
    renderCatalog();
    await screen.findByRole("button", { name: "Install thermos" });
    fireEvent.change(screen.getByLabelText("Search plugins"), { target: { value: "GIT" } });
    expect(screen.queryByRole("button", { name: "Install thermos" })).toBeNull();
    expect(screen.getByRole("button", { name: "Install github" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Upload a plugin/ })).toBeNull();
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

  it("the Upload tile opens the uploader in a dialog on the page", async () => {
    renderCatalog();
    fireEvent.click(await screen.findByRole("button", { name: /Upload a plugin/ }));
    const dialog = await screen.findByRole("dialog", { name: "Upload a plugin" });
    expect(within(dialog).getByTestId("plugin-folder-input")).toBeTruthy();
    expect(within(dialog).getByText(/Drop a plugin folder/)).toBeTruthy();
  });

  it("pages at CATALOG_PAGE_SIZE, the Upload tile taking one slot on the first page, and a new query returns to page one", async () => {
    // A catalogue of thirty entries, each its own manifest-only directory.
    const files = hostedMarketplaceFiles();
    const many = Array.from({ length: 30 }, (_, index) => `plugin-${String(index).padStart(2, "0")}`);
    files.set(
      ".cursor-plugin/marketplace.json",
      `${JSON.stringify({ name: HOSTED_MARKETPLACE_NAME, plugins: many.map((name) => ({ name, source: name })) })}\n`,
    );
    for (const name of many) files.set(`${name}/.cursor-plugin/plugin.json`, `${JSON.stringify({ name })}\n`);
    renderCatalog([], files);

    await screen.findByRole("button", { name: "Install plugin-00" });
    let cards = within(screen.getByRole("list", { name: "Plugins" })).getAllByRole("listitem");
    expect(cards).toHaveLength(CATALOG_PAGE_SIZE); // the tile plus 23 cards
    expect(screen.getByRole("button", { name: `Install plugin-${CATALOG_PAGE_SIZE - 2}` })).toBeTruthy();
    expect(screen.queryByRole("button", { name: `Install plugin-${CATALOG_PAGE_SIZE - 1}` })).toBeNull();

    const pagination = screen.getByRole("navigation", { name: "Plugins pagination" });
    expect(pagination.textContent).toContain("Page 1 of 2");
    fireEvent.click(within(pagination).getByRole("button", { name: "Next" }));
    cards = within(screen.getByRole("list", { name: "Plugins" })).getAllByRole("listitem");
    expect(cards).toHaveLength(30 - (CATALOG_PAGE_SIZE - 1));
    expect(screen.queryByRole("button", { name: /Upload a plugin/ })).toBeNull();
    expect(screen.getByRole("button", { name: `Install plugin-${CATALOG_PAGE_SIZE - 1}` })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search plugins"), { target: { value: "plugin-2" } });
    expect(screen.queryByRole("navigation", { name: "Plugins pagination" })).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Install plugin-2/ })).toHaveLength(10);
  });
});

describe("MarketplaceCatalog: Manage sources", () => {
  it("opens a dialog listing the built-in as such, Remove on the added one only, and the add form behind its disclosure", async () => {
    renderCatalog();
    await screen.findByRole("button", { name: "Install thermos" });
    fireEvent.click(screen.getByRole("button", { name: "Manage sources" }));
    const dialog = await screen.findByRole("dialog", { name: "Sources" });
    const list = within(dialog).getByRole("list", { name: "Known sources" });
    // The rows themselves; a row's disclosure of dropped entries nests its own list.
    const items = Array.from(list.querySelectorAll(":scope > li"));
    expect(items).toHaveLength(2);
    expect(items[0]?.textContent).toContain("stigmer");
    expect(items[0]?.textContent).toContain("built in");
    expect(within(list).getAllByRole("button", { name: /^Remove source/ }).map((b) => b.getAttribute("aria-label"))).toEqual([
      `Remove source ${HOSTED_MARKETPLACE_NAME}`,
    ]);
    // The user's own catalogue is one click away, never presented as a way to browse a vendor.
    expect(within(dialog).getByText("Add your own catalogue")).toBeTruthy();
    expect(within(dialog).getByText(/A repository you or your company publish/)).toBeTruthy();
    expect(within(dialog).getByRole("form", { name: "Add a source" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Add source" })).toBeTruthy();
    // A format path in a reader's sentence (`.cursor-plugin/marketplace.json`) is a fact; a vendor's catalogue on offer would be a presentation.
    expect(dialog.textContent).not.toMatch(/Cursor's|Claude Code's|Codex's|cursor-plugins|claude-code-plugins|codex-plugins/);
  });

  it("says what each catalogue came to on its row, and the storefront itself says nothing about dropped entries", async () => {
    renderCatalog();
    await screen.findByRole("button", { name: "Install thermos" });
    // The fixture lists `ghost`, whose directory the tree lacks: dropped with its sentence, which the grid never shows.
    expect(screen.queryByText(/cannot be installed/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Manage sources" }));
    const dialog = await screen.findByRole("dialog", { name: "Sources" });
    const row = within(dialog).getAllByRole("listitem").find((item) => item.textContent?.includes(HOSTED_MARKETPLACE_NAME));
    expect(row).toBeTruthy();
    expect(within(row!).getByText("Offers 2 plugins; 1 entry it lists cannot be installed from here.")).toBeTruthy();
    expect(within(row!).getByText(/'ghost'.*not offered/)).toBeTruthy();
    // A source that could not be read says so in the same place.
    const official = within(dialog).getAllByRole("listitem").find((item) => item.textContent?.startsWith("stigmer"));
    expect(official?.textContent).toContain("cannot be read: the official marketplace is published with each release");
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
