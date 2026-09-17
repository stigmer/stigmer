/**
 * The catalogue's static suite: the marketplace file and the tree agree, and
 * every plugin the file offers is one Stigmer installs without a warning.
 *
 * Read through `@stigmer/plugin-package`, the same reader the CLI and the
 * server use, so what passes here is what `stigmer up` and `stigmer install`
 * will accept. Pins: the file reads clean; every directory that carries a
 * plugin manifest is listed (nothing ships unlisted, nothing is listed
 * twice); every listed plugin reads clean under its own name; the defaults
 * are the file's, in order; exactly one plugin carries the default-agent
 * label, and it is public; every agent overlay names its own plugin. There
 * are no snapshot files: a change in what the catalogue offers is a change
 * someone wrote down here.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { comparePaths, hasPluginManifest, readMarketplace, readPluginPackage, type PluginFileEntry, type PluginFiles } from "@stigmer/plugin-package";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_AGENT_LABEL = "stigmer.ai/default-agent";
/** Directories at the root that are tooling, never plugins. */
const NOT_PLUGINS: ReadonlySet<string> = new Set(["__tests__", "scripts", "dist", "node_modules"]);

/**
 * A `PluginFiles` over a directory: sorted, files only, symlinks skipped,
 * sizes from `stat`. The reader's contract, without the CLI walker's ignore
 * rules: this catalogue carries no ignore files, so the two walks agree.
 */
function directoryFiles(root: string): PluginFiles {
  const entries: PluginFileEntry[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (prefix === "" && NOT_PLUGINS.has(entry.name)) continue;
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(dir, entry.name), path);
      else if (entry.isFile()) entries.push({ path, size: statSync(join(dir, entry.name)).size });
    }
  };
  walk(root, "");
  entries.sort((a, b) => comparePaths(a.path, b.path));
  return { entries, read: (path) => new Uint8Array(readFileSync(join(root, ...path.split("/")))) };
}

const outcome = readMarketplace(directoryFiles(ROOT));
if (!outcome.ok) {
  throw new Error(`marketplace.json does not read:\n${outcome.errors.map((f) => `  ${f.kind}: ${f.message}`).join("\n")}`);
}
const marketplace = outcome.marketplace;
const listedDirs = marketplace.plugins.map((entry) => entry.dir);

describe("marketplace.json", () => {
  it("reads clean: the official name, no warnings, every entry offered", () => {
    expect(marketplace.name).toBe("stigmer");
    expect(marketplace.dialect).toBe("stigmer");
    expect(outcome.warnings).toEqual([]);
    expect(marketplace.plugins.length).toBeGreaterThan(0);
  });

  it("lists every directory that carries a plugin manifest, and nothing twice", () => {
    const onDisk = readdirSync(ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !NOT_PLUGINS.has(entry.name))
      .filter((entry) => hasPluginManifest(readdirSync(join(ROOT, entry.name))))
      .map((entry) => entry.name)
      .sort(comparePaths);
    expect([...listedDirs].sort(comparePaths)).toEqual(onDisk);
    expect(new Set(listedDirs).size).toBe(listedDirs.length);
  });

  it("names its defaults in install order, and every default is an offered entry", () => {
    const file = JSON.parse(readFileSync(join(ROOT, "marketplace.json"), "utf8")) as { defaults: string[] };
    expect(marketplace.defaults).toEqual(file.defaults);
    expect(marketplace.defaults.length).toBeGreaterThan(0);
    for (const name of marketplace.defaults) {
      expect(marketplace.plugins.map((entry) => entry.name)).toContain(name);
    }
  });
});

describe("every listed plugin", () => {
  for (const entry of marketplace.plugins) {
    it(`${entry.name}: reads clean under its own name, with a version and a description`, () => {
      const read = readPluginPackage(directoryFiles(join(ROOT, entry.dir)));
      if (!read.ok) {
        throw new Error(`${entry.dir} does not read:\n${read.errors.map((f) => `  ${f.kind}: ${f.message}`).join("\n")}`);
      }
      expect(read.warnings).toEqual([]);
      expect(read.plugin.name).toBe(entry.name);
      expect(read.plugin.dialect).toBe("agent-plugins");
      expect(read.plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(read.plugin.description).toBeTruthy();
    });
  }
});

interface AgentOverlay {
  readonly dir: string;
  readonly metadata: { readonly name?: string; readonly visibility?: string; readonly labels?: Record<string, string> };
}

const overlays: AgentOverlay[] = marketplace.plugins.flatMap((entry) => {
  const path = join(ROOT, entry.dir, "ai.stigmer", "agent.yaml");
  try {
    const document = parseYaml(readFileSync(path, "utf8")) as { metadata?: AgentOverlay["metadata"] };
    return [{ dir: entry.dir, metadata: document.metadata ?? {} }];
  } catch {
    return [];
  }
});

describe("the agent overlays", () => {
  it("each names its own plugin (the server refuses an overlay that describes another resource)", () => {
    for (const overlay of overlays) {
      expect(overlay.metadata.name, `${overlay.dir}/ai.stigmer/agent.yaml`).toBe(overlay.dir);
    }
  });

  it("exactly one carries the default-agent label, and it is public", () => {
    const defaults = overlays.filter((overlay) => overlay.metadata.labels?.[DEFAULT_AGENT_LABEL] === "true");
    expect(defaults.map((overlay) => overlay.dir)).toEqual(["assistant"]);
    expect(defaults[0]?.metadata.visibility).toBe("visibility_public");
    expect(marketplace.defaults).toContain("assistant");
  });
});
