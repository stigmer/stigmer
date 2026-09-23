/**
 * The catalogue's static suite: the marketplace file, the pin file, the
 * notice and the tree agree, and every plugin the file offers is one
 * Stigmer installs.
 *
 * Every entry is read through `preparePluginFromTree`, the one preparation
 * the CLI and the console install through (ignore rules, the reader, the
 * archive and its digest), so what passes here is what `stigmer install`
 * and the console will accept, ignore files inside vendored trees
 * included. Pins: the file reads clean; every directory that carries a
 * plugin manifest is listed once, in the ruled order (by name); the tree
 * partitions into
 * vendored folders (one `vendor.json` row each, its licence file present,
 * no guide file inside, digesting to exactly what the row pins, read with
 * no errors and only the warnings a copy cannot avoid) and authored plugins (the open format, Stigmer's name, a
 * display name, no warnings at all); a struck entry has no folder;
 * `NOTICE` and `marketplace.json` are exactly what the sync derives from
 * the pins and the tree, so it names no entry a client installs unasked;
 * no plugin carries the retired default-agent label; every agent overlay
 * names its own plugin. There
 * are no snapshot files: a change in what the catalogue offers is a change
 * someone wrote down here.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { comparePaths, readMarketplace, type PluginPackage } from "@stigmer/plugin-package";
import { preparePluginFromTree } from "@stigmer/plugin-package/client";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

import { asPluginFiles, listDirectory, subtree } from "../scripts/lib/candidates.js";
import { CATALOGUE_ROOT, pluginFolders } from "../scripts/lib/catalogue-tree.js";
import { readVendorPins, VENDOR_PINS_FILE } from "../scripts/lib/vendor-pins.js";
import { readMarketplaceHead, renderMarketplace } from "../scripts/sync/marketplace.js";
import { renderNotice } from "../scripts/sync/notice.js";
import { marketplaceOrder } from "../scripts/sync/plan.js";
import { listTree } from "../scripts/sync/tree.js";

/** The label the retired default-agent lookup read; a plugin that carries it is a stale copy of that era. */
const DEFAULT_AGENT_LABEL = "stigmer.ai/default-agent";
const AUTHOR = "Stigmer";
/** Guide files a vendored tree must not carry: the repository's guidance gate would read one as law. */
const GUIDE_FILES: ReadonlySet<string> = new Set(["AGENTS.md", "CLAUDE.md"]);
/**
 * Warning kinds a byte-for-byte copy cannot avoid and an install can live
 * with: a sub-agent field or model alias Stigmer does not read, a skill
 * whose frontmatter name differs from its directory. Anything else on a
 * vendored entry is a question for a person, and `mcp-server-auth-ignored`
 * in particular names a server whose declared credential no header sends.
 */
const VENDORED_WARNINGS_ALLOWED: ReadonlySet<string> = new Set(["sub-agent-field-ignored", "sub-agent-model-unknown", "skill-name-differs-from-directory"]);

const listing = listDirectory(CATALOGUE_ROOT);
const outcome = readMarketplace(asPluginFiles(listing));
if (!outcome.ok) {
  throw new Error(`marketplace.json does not read:\n${outcome.errors.map((f) => `  ${f.kind}: ${f.message}`).join("\n")}`);
}
const marketplace = outcome.marketplace;
const pins = readVendorPins(join(CATALOGUE_ROOT, VENDOR_PINS_FILE));
const vendoredNames = new Set(pins.plugins.map((row) => row.name));
const folders = pluginFolders(CATALOGUE_ROOT);

interface Prepared {
  readonly plugin: PluginPackage;
  readonly warnings: readonly string[];
  /** SHA-256 of the archive an install would push: the identity the pin file carries for a vendored folder. */
  readonly digest: string;
}

/** One entry through the install's own preparation; a refusal fails with the reader's sentences. */
async function prepare(dir: string): Promise<Prepared> {
  const prepared = await preparePluginFromTree(subtree(listing, dir).candidates, { respectGitignore: true });
  if (!prepared.ok) {
    const detail = prepared.kind === "refused" ? prepared.errors.map((f) => `  ${f.kind}: ${f.message}`).join("\n") : `  ${prepared.selectedBytes} bytes, over the ${prepared.maxBytes} cap`;
    throw new Error(`${dir} does not install:\n${detail}`);
  }
  return { plugin: prepared.prepared.plugin, warnings: prepared.prepared.warnings.map((f) => f.kind), digest: prepared.prepared.digest };
}

describe("marketplace.json", () => {
  it("reads clean: the official name, no warnings, every entry offered", () => {
    expect(marketplace.name).toBe("stigmer");
    expect(marketplace.dialect).toBe("stigmer");
    expect(outcome.warnings).toEqual([]);
    expect(marketplace.plugins.length).toBeGreaterThan(0);
  });

  it("lists every directory that carries a plugin manifest, once, in the ruled order", () => {
    const listed = marketplace.plugins.map((entry) => entry.dir);
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort(comparePaths)).toEqual(folders);
    expect(listed).toEqual(marketplaceOrder(new Set(folders)));
  });

  it("is exactly what the sync derives from the tree, so a hand edit and the tool cannot disagree", () => {
    const path = join(CATALOGUE_ROOT, "marketplace.json");
    const text = readFileSync(path, "utf8");
    expect(text).toBe(renderMarketplace(readMarketplaceHead(text, path), new Set(folders)));
  });
});

describe("vendor.json and NOTICE", () => {
  it("every row has its folder, every struck entry has none, and no row names a folder twice", () => {
    for (const row of pins.plugins) expect(folders, `${row.name} is pinned but not on disk`).toContain(row.name);
    for (const strike of pins.struck) expect(folders, `${strike.source}/${strike.name} is struck but on disk`).not.toContain(strike.name);
    expect(vendoredNames.size).toBe(pins.plugins.length);
  });

  it("NOTICE is exactly what the sync derives from the pins", () => {
    expect(readFileSync(join(CATALOGUE_ROOT, "NOTICE"), "utf8")).toBe(renderNotice(pins));
  });
});

describe("every vendored plugin", () => {
  for (const row of pins.plugins) {
    it(`${row.name}: carries its licence file and no guide file, reads under its own name with no errors and only the warnings a copy cannot avoid`, async () => {
      const dir = join(CATALOGUE_ROOT, row.name);
      expect(existsSync(join(dir, ...row.licence.split("/"))), `${row.name}/${row.licence}`).toBe(true);
      const guides = listTree(dir)
        .map((file) => file.path)
        .filter((path) => GUIDE_FILES.has(path.split("/").pop() ?? ""));
      expect(guides, `${row.name} carries a guide file the repository would read as its own`).toEqual([]);
      const { plugin, warnings, digest } = await prepare(row.name);
      expect(plugin.name).toBe(row.name);
      expect(plugin.dialect).not.toBe("agent-plugins");
      expect(digest, `${row.name} no longer digests to what vendor.json pins: a file inside it was edited, or the pin is stale`).toBe(row.digest);
      expect(warnings.filter((kind) => !VENDORED_WARNINGS_ALLOWED.has(kind)), `${row.name} warns in a way a vendored copy may not`).toEqual([]);
    });
  }
});

describe("every authored plugin", () => {
  const authored = folders.filter((name) => !vendoredNames.has(name));

  it("exists: the catalogue authors plugins as well as vendoring them", () => {
    expect(authored.length).toBeGreaterThan(0);
  });

  for (const name of authored) {
    it(`${name}: the open format, in Stigmer's name, with a display name, a version, a description and no warnings`, async () => {
      const { plugin, warnings } = await prepare(name);
      expect(warnings).toEqual([]);
      expect(plugin.name).toBe(name);
      expect(plugin.dialect).toBe("agent-plugins");
      expect(plugin.author?.name).toBe(AUTHOR);
      expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(plugin.description).toBeTruthy();
      const manifest = JSON.parse(readFileSync(join(CATALOGUE_ROOT, name, "plugin.json"), "utf8")) as { extensions?: { "ai.stigmer"?: { displayName?: unknown } } };
      expect(manifest.extensions?.["ai.stigmer"]?.displayName, `${name} names no displayName under extensions["ai.stigmer"]`).toEqual(expect.any(String));
    });
  }
});

interface AgentOverlay {
  readonly dir: string;
  readonly metadata: { readonly name?: string; readonly visibility?: string; readonly labels?: Record<string, string> };
}

const overlays: AgentOverlay[] = marketplace.plugins.flatMap((entry) => {
  const path = join(CATALOGUE_ROOT, entry.dir, "ai.stigmer", "agent.yaml");
  if (!existsSync(path)) return [];
  const document = parseYaml(readFileSync(path, "utf8")) as { metadata?: AgentOverlay["metadata"] };
  return [{ dir: entry.dir, metadata: document.metadata ?? {} }];
});

describe("the agent overlays", () => {
  it("each names its own plugin (the server refuses an overlay that describes another resource)", () => {
    for (const overlay of overlays) {
      expect(overlay.metadata.name, `${overlay.dir}/ai.stigmer/agent.yaml`).toBe(overlay.dir);
    }
  });

  it("none carries the retired default-agent label: no plugin is a platform default", () => {
    const labeled = overlays.filter((overlay) => overlay.metadata.labels?.[DEFAULT_AGENT_LABEL] === "true");
    expect(labeled.map((overlay) => overlay.dir)).toEqual([]);
  });
});
