/**
 * The marketplace sources a browser reads, against a fetch fake. Pins: a
 * GitHub tree is listed once and read at the resolved commit; a second
 * listing is conditional and a 304 reuses the cache; the marketplace file
 * is the only file fetched to read a catalogue; an entry's subtree is
 * fetched whole and selected by the tree's own `.gitignore`; the prepared
 * digest equals the CLI's digest for the same files (the parity the whole
 * design rests on); a truncated listing, a private repository, a short
 * read and an over-budget entry are refused with their sentences; the
 * official catalogue refuses a development server and reads a published
 * version.
 */

import { afterEach, describe, expect, it } from "vitest";
import { archivePlugin, digestArchive, selectPluginFiles } from "@stigmer/plugin-package/client";

import { openGitHubTree, resetGitHubListingCache } from "../sources/github.js";
import { openOfficialTree } from "../sources/official.js";
import { PluginReadRefusal, findEntry, openMarketplace, prepareEntry } from "../sources/read.js";
import { MARKETPLACE_TREE_LIMITS, MarketplaceSourceError } from "../sources/types.js";
import { HOSTED_COMMIT, HOSTED_REPO, hostedFetch, hostedMarketplaceFiles } from "./fixtures/hosted-marketplace.js";

const SOURCE = { type: "github", repo: HOSTED_REPO } as const;
const encoder = new TextEncoder();

afterEach(() => resetGitHubListingCache());

describe("openGitHubTree", () => {
  it("lists the tree once and describes it by the resolved commit", async () => {
    const { fetchImpl, requests } = hostedFetch();
    const tree = await openGitHubTree(SOURCE, fetchImpl);
    expect(tree.describe).toBe(`github.com/${HOSTED_REPO} (${HOSTED_COMMIT.slice(0, 7)})`);
    expect(tree.files.map((f) => f.path)).toContain("thermos/mcp.json");
    expect(tree.files.map((f) => f.path)).not.toContain("thermos"); // directories are not files
    expect(requests).toHaveLength(1);
  });

  it("re-asks conditionally and a 304 reuses the cached listing", async () => {
    const { fetchImpl, requests } = hostedFetch();
    await openGitHubTree(SOURCE, fetchImpl);
    const again = await openGitHubTree(SOURCE, fetchImpl);
    expect(requests[1]?.ifNoneMatch).toBe(`"tree-${HOSTED_COMMIT.slice(0, 8)}"`);
    expect(again.files.length).toBeGreaterThan(0);
  });

  it("reads a file at the commit and refuses a body of another length", async () => {
    const { fetchImpl } = hostedFetch(undefined, { shortRead: "README.md" });
    const tree = await openGitHubTree(SOURCE, fetchImpl);
    expect(new TextDecoder().decode(await tree.fetchFile("thermos/.gitignore"))).toBe("*.log\n");
    await expect(tree.fetchFile("README.md")).rejects.toMatchObject({ reason: "refused" });
  });

  it("refuses a truncated listing and a repository GitHub does not have", async () => {
    await expect(openGitHubTree(SOURCE, hostedFetch(undefined, { truncated: true }).fetchImpl)).rejects.toMatchObject({
      reason: "too-large",
    });
    await expect(openGitHubTree({ type: "github", repo: "acme/private" }, hostedFetch().fetchImpl)).rejects.toMatchObject({
      reason: "not-found",
    });
    const limited = await openGitHubTree(SOURCE, hostedFetch(undefined, { listingStatus: 403 }).fetchImpl).catch((e: unknown) => e);
    expect(limited).toBeInstanceOf(MarketplaceSourceError);
    expect((limited as Error).message).toContain("rate-limiting");
  });
});

describe("openMarketplace", () => {
  it("fetches only the marketplace file and reads the catalogue with its dropped entries", async () => {
    const { fetchImpl, requests } = hostedFetch();
    const opened = await openMarketplace(await openGitHubTree(SOURCE, fetchImpl));
    expect(opened.marketplace.name).toBe("cursor-plugins");
    expect(opened.marketplace.plugins.map((p) => p.name)).toEqual(["thermos", "github"]);
    expect(opened.warnings.map((w) => w.subject)).toEqual(["ghost"]);
    const rawReads = requests.filter((r) => r.url.includes("raw.githubusercontent.com"));
    expect(rawReads.map((r) => r.url.split(`${HOSTED_COMMIT}/`)[1])).toEqual([".cursor-plugin/marketplace.json"]);
  });

  it("refuses a tree with no marketplace file, quoting the library's sentence", async () => {
    const files = hostedMarketplaceFiles();
    files.delete(".cursor-plugin/marketplace.json");
    const { fetchImpl } = hostedFetch(files);
    const refusal = await openMarketplace(await openGitHubTree(SOURCE, fetchImpl)).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(PluginReadRefusal);
    expect((refusal as PluginReadRefusal).errors.map((e) => e.kind)).toEqual(["marketplace-not-found"]);
  });
});

describe("prepareEntry", () => {
  it("fetches the entry's subtree, applies its .gitignore, and arrives at the shared module's digest", async () => {
    const files = hostedMarketplaceFiles();
    const { fetchImpl, requests } = hostedFetch(files);
    const opened = await openMarketplace(await openGitHubTree(SOURCE, fetchImpl));
    const prepared = await prepareEntry(opened, findEntry(opened.marketplace, "thermos")!);

    expect(prepared.plugin.name).toBe("thermos");
    expect(prepared.plugin.skills.map((s) => s.name)).toEqual(["keep-warm"]);
    expect(prepared.plugin.subAgents.map((a) => a.name)).toEqual(["checker"]);
    expect(prepared.plugin.variables.map((v) => v.name)).toEqual(["API_TOKEN"]);
    expect(prepared.stats.filesIgnored).toBe(1); // debug.log, by the tree's own .gitignore

    // Only thermos/** was fetched for the install (plus the one marketplace file before it).
    const fetched = requests
      .filter((r) => r.url.includes("raw.githubusercontent.com"))
      .map((r) => r.url.split(`${HOSTED_COMMIT}/`)[1] ?? "");
    expect(fetched.filter((p) => !p.startsWith("thermos/"))).toEqual([".cursor-plugin/marketplace.json"]);

    // Parity: the same files through the client module directly yield the same digest.
    const entryFiles = [...files.entries()]
      .filter(([path]) => path.startsWith("thermos/"))
      .map(([path, content]) => [path.slice("thermos/".length), encoder.encode(content)] as const);
    const bytes = new Map(entryFiles);
    const selection = selectPluginFiles(
      entryFiles.map(([path, content]) => ({ path, size: content.length })),
      (path) => bytes.get(path)!,
      { respectGitignore: true },
    );
    expect(prepared.digest).toBe(await digestArchive(archivePlugin(selection.files)));
  });

  it("prepares an entry at the tree root when the marketplace names it", async () => {
    const files = hostedMarketplaceFiles();
    const { fetchImpl } = hostedFetch(files);
    const opened = await openMarketplace(await openGitHubTree(SOURCE, fetchImpl));
    const prepared = await prepareEntry(opened, findEntry(opened.marketplace, "github")!);
    expect(prepared.plugin.mcpServers.map((s) => s.name)).toEqual(["github"]);
    expect(prepared.plugin.skills).toEqual([]);
  });

  it("refuses an entry over the byte budget before fetching a file", async () => {
    const files = hostedMarketplaceFiles();
    const { fetchImpl, requests } = hostedFetch(files);
    const opened = await openMarketplace(await openGitHubTree(SOURCE, fetchImpl));
    const huge = { ...opened, tree: { ...opened.tree, files: opened.tree.files.map((f) => (f.path === "thermos/mcp.json" ? { ...f, size: MARKETPLACE_TREE_LIMITS.pluginBytes + 1 } : f)) } };
    const before = requests.length;
    await expect(prepareEntry(huge, findEntry(opened.marketplace, "thermos")!)).rejects.toMatchObject({ reason: "too-large" });
    expect(requests.length).toBe(before);
  });

  it("refuses a plugin the library refuses, with every sentence", async () => {
    const files = hostedMarketplaceFiles();
    files.set("thermos/.cursor-plugin/plugin.json", JSON.stringify({ name: "Not Valid!" }));
    const { fetchImpl } = hostedFetch(files);
    const opened = await openMarketplace(await openGitHubTree(SOURCE, fetchImpl));
    const refusal = await prepareEntry(opened, findEntry(opened.marketplace, "thermos")!).catch((e: unknown) => e);
    expect(refusal).toBeInstanceOf(PluginReadRefusal);
    expect((refusal as PluginReadRefusal).subject).toBe("'thermos' cannot be installed");
    expect((refusal as PluginReadRefusal).errors.length).toBeGreaterThan(0);
  });
});

describe("openOfficialTree", () => {
  it("refuses a development server in one sentence and reads a published version", async () => {
    const { fetchImpl } = hostedFetch(undefined, { publishedVersion: "3.17.0" });
    await expect(openOfficialTree("0.0.0-dev", fetchImpl)).rejects.toMatchObject({ reason: "unavailable-on-dev-server" });
    await expect(openOfficialTree("3.16.0", fetchImpl)).rejects.toMatchObject({ reason: "not-found" });
    const tree = await openOfficialTree("3.17.0", fetchImpl);
    expect(tree.describe).toBe("@stigmer/plugins@3.17.0");
    const opened = await openMarketplace(tree);
    expect(opened.marketplace.plugins.map((p) => p.name)).toEqual(["thermos", "github"]);
  });
});
