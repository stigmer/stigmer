/**
 * The one preparation, reached three ways, and the small rules beside it.
 *
 * Pins: `preparePluginFromTree` over a lazily-read tree yields the CLI's
 * recorded digest for the thermos fixture (the tripwire constant lives in
 * `client-select-archive.test.ts`); it reads only the ignore files and the
 * selected entries, never an ignored file's bytes; an over-cap selection is
 * refused before any selected byte is read; a reader refusal is returned
 * with the reader's findings. `isReleaseVersion`'s five cases, the two
 * wrong answers the console and the CLI used to give among them.
 * `rerootSingleDirectory` on the shapes a zip takes. The built-in sources'
 * order, their reserved names, and that the official one is first.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { BUILT_IN_MARKETPLACES, isBuiltInMarketplaceName } from "../client/builtin.js";
import { type LazyCandidate, preparePluginFromTree } from "../client/prepare.js";
import { OFFICIAL_MARKETPLACE_NAME } from "../client/refs.js";
import { isReleaseVersion } from "../client/release.js";
import { rerootSingleDirectory, stripDirectoryPrefix } from "../client/reroot.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/cursor-plugins/", import.meta.url));
/** The CLI's digest for the thermos fixture, recorded in client-select-archive.test.ts. */
const THERMOS_DIGEST = "51bc4e5450e24762bb8515765c76bfe262f65c57f9afeda015c5818038396d5a";

const encoder = new TextEncoder();
const SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";

function manifest(name: string): string {
  return JSON.stringify({ $schema: SCHEMA, name, version: "1.0.0", description: `the ${name} plugin` });
}

/** A directory as a lazily-read tree, recording which paths were read. */
function lazyDirectory(root: string): { candidates: LazyCandidate[]; reads: string[] } {
  const reads: string[] = [];
  const candidates: LazyCandidate[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full, path);
      else if (entry.isFile()) {
        candidates.push({
          path,
          size: statSync(full).size,
          read: async () => {
            reads.push(path);
            return new Uint8Array(readFileSync(full));
          },
        });
      }
    }
  };
  walk(root, "");
  return { candidates, reads };
}

function lazyMemory(files: Record<string, string>): { candidates: LazyCandidate[]; reads: string[] } {
  const reads: string[] = [];
  const candidates = Object.entries(files).map(([path, text]) => {
    const bytes = encoder.encode(text);
    return {
      path,
      size: bytes.length,
      read: async () => {
        reads.push(path);
        return bytes;
      },
    };
  });
  return { candidates, reads };
}

describe("preparePluginFromTree", () => {
  it("yields the CLI's digest for the thermos fixture from a lazily-read tree", async () => {
    const { candidates } = lazyDirectory(`${FIXTURES}thermos`);
    const outcome = await preparePluginFromTree(candidates, { respectGitignore: true });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.prepared.digest).toBe(THERMOS_DIGEST);
    expect(outcome.prepared.plugin.name).toBe("thermos");
    expect(outcome.prepared.stats.filesIncluded).toBe(10);
  });

  it("reads the ignore file and the selected entries only, never an ignored file's bytes", async () => {
    const tree = lazyMemory({
      ".gitignore": "secrets.txt\n",
      "plugin.json": manifest("quiet"),
      "node_modules/left-pad/index.js": "module.exports = 1;",
      "secrets.txt": "hunter2",
      "skills/greet/SKILL.md": "---\nname: greet\ndescription: says hello\n---\nHello.",
    });
    const outcome = await preparePluginFromTree(tree.candidates, { respectGitignore: true });
    expect(outcome.ok).toBe(true);
    expect(tree.reads.sort()).toEqual([".gitignore", "plugin.json", "skills/greet/SKILL.md"]);
  });

  it("refuses an over-cap selection before a selected byte is read", async () => {
    const tree = lazyMemory({
      "plugin.json": manifest("heavy"),
      "skills/big/SKILL.md": "x".repeat(2_000),
    });
    const outcome = await preparePluginFromTree(tree.candidates, { respectGitignore: true, maxBytes: 1_000 });
    expect(outcome).toMatchObject({ ok: false, kind: "too-large", maxBytes: 1_000 });
    if (outcome.ok || outcome.kind !== "too-large") return;
    expect(outcome.selectedBytes).toBeGreaterThan(1_000);
    expect(tree.reads).toEqual([]);
  });

  it("returns the reader's refusal with its findings when the tree is not a plugin", async () => {
    const tree = lazyMemory({ "README.md": "not a plugin" });
    const outcome = await preparePluginFromTree(tree.candidates, { respectGitignore: true });
    expect(outcome.ok).toBe(false);
    if (outcome.ok || outcome.kind !== "refused") throw new Error("expected the reader's refusal");
    expect(outcome.errors.length).toBeGreaterThan(0);
  });
});

describe("isReleaseVersion", () => {
  it("accepts a release and a pre-release the lockstep publish covers", () => {
    expect(isReleaseVersion("3.17.0")).toBe(true);
    // The console used to call this a development build.
    expect(isReleaseVersion("3.17.0-rc.1")).toBe(true);
  });

  it("refuses every shape a source or dev-channel build reports", () => {
    // The CLI used to accept the bare stamp an unbundled server reports.
    expect(isReleaseVersion("dev")).toBe(false);
    expect(isReleaseVersion("0.0.0-dev")).toBe(false);
    expect(isReleaseVersion("3.17.0-dev.20260918120000")).toBe(false);
    expect(isReleaseVersion("3.17.0+build.5")).toBe(false);
    expect(isReleaseVersion("")).toBe(false);
  });
});

describe("rerootSingleDirectory", () => {
  it("names the one directory every path is under", () => {
    const paths = ["my-plugin/plugin.json", "my-plugin/skills/a/SKILL.md", "my-plugin/.gitignore"];
    expect(rerootSingleDirectory(paths)).toBe("my-plugin");
    expect(stripDirectoryPrefix(paths, "my-plugin")).toEqual(["plugin.json", "skills/a/SKILL.md", ".gitignore"]);
  });

  it("leaves a tree that is already rooted, or has two roots, alone", () => {
    expect(rerootSingleDirectory(["plugin.json", "skills/a/SKILL.md"])).toBeNull();
    expect(rerootSingleDirectory(["a/plugin.json", "b/plugin.json"])).toBeNull();
    expect(rerootSingleDirectory(["a/plugin.json", "README.md"])).toBeNull();
    expect(rerootSingleDirectory([])).toBeNull();
  });
});

describe("BUILT_IN_MARKETPLACES", () => {
  it("lists the official catalogue alone, a reserved name; a vendor's repository is a source the user adds", () => {
    expect(BUILT_IN_MARKETPLACES.map((entry) => entry.name)).toEqual([OFFICIAL_MARKETPLACE_NAME]);
    expect(BUILT_IN_MARKETPLACES[0]?.source).toEqual({ type: "official" });
    for (const entry of BUILT_IN_MARKETPLACES) expect(isBuiltInMarketplaceName(entry.name)).toBe(true);
    expect(isBuiltInMarketplaceName("cursor-plugins")).toBe(false);
    expect(isBuiltInMarketplaceName("acme-plugins")).toBe(false);
  });
});
