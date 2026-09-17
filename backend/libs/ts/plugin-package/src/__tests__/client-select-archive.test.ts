/**
 * The client entry's identity discipline: the same tree selected and
 * archived from a directory (the CLI's edge) and from a flat in-memory file
 * list (the console's edge) yields one digest, and that digest is the one
 * the CLI produced before this module existed.
 *
 * The two constants below were computed with the unmodified CLI at
 * `d75b0724a` (`preparePluginPush` over `plugins/assistant` and over the
 * vendored `thermos` fixture). `8d1000b4…` is also the digest the live
 * `assistant` plugin carried after `stigmer up` in that release. If either
 * changes, every installed plugin would look like an upgrade; this test is
 * the tripwire.
 *
 * The selection cases pin the walk order (component-wise, directories and
 * files interleaved by name), the whole-subtree skip of an ignored
 * directory, the root `.gitignore` and `.stigmerignore`, and that a
 * negation inside a skipped directory cannot pull a file back.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { archivePlugin, digestArchive } from "../client/archive.js";
import { type CandidateFile, compareWalkOrder, selectPluginFiles } from "../client/select.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/cursor-plugins/", import.meta.url));
const REPO_PLUGINS = fileURLToPath(new URL("../../../../../../plugins/", import.meta.url));

const BASELINE = {
  assistant: "8d1000b4a48136a8530509f603805693fc2478d279962d4fade40716435064ce",
  thermos: "51bc4e5450e24762bb8515765c76bfe262f65c57f9afeda015c5818038396d5a",
} as const;

const encoder = new TextEncoder();

/** Every file under `root`, unordered, the shape a hosted tree listing has. */
function listDirectory(root: string): { candidates: CandidateFile[]; read: (path: string) => Uint8Array } {
  const candidates: CandidateFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const full = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(full, path);
      else if (entry.isFile()) candidates.push({ path, size: statSync(full).size });
    }
  };
  walk(root, "");
  // Reverse so the test proves selection imposes the order, not the listing.
  candidates.reverse();
  return { candidates, read: (path) => new Uint8Array(readFileSync(`${root}/${path}`)) };
}

function inMemory(files: Record<string, string>): { candidates: CandidateFile[]; read: (path: string) => Uint8Array } {
  const bytes = new Map(Object.entries(files).map(([path, text]) => [path, encoder.encode(text)]));
  return {
    candidates: [...bytes].map(([path, content]) => ({ path, size: content.length })),
    read: (path) => {
      const content = bytes.get(path);
      if (content === undefined) throw new Error(`unlisted ${path}`);
      return content;
    },
  };
}

const RESPECT = { respectGitignore: true };

describe("parity with the CLI's original walk", () => {
  it("plugins/assistant archives to the digest stigmer up installed", async () => {
    const { candidates, read } = listDirectory(`${REPO_PLUGINS}assistant`);
    const selection = selectPluginFiles(candidates, read, RESPECT);
    expect(selection.files.entries.map((entry) => entry.path)).toEqual([
      "ai.stigmer/agent.yaml",
      "icon.svg",
      "plugin.json",
    ]);
    expect(await digestArchive(archivePlugin(selection.files))).toBe(BASELINE.assistant);
  });

  it("the thermos fixture archives to the CLI's digest", async () => {
    const { candidates, read } = listDirectory(`${FIXTURES}thermos`);
    const selection = selectPluginFiles(candidates, read, RESPECT);
    expect(selection.stats.filesIncluded).toBe(10);
    expect(await digestArchive(archivePlugin(selection.files))).toBe(BASELINE.thermos);
  });

  it("the same bytes from an in-memory listing yield the same digest", async () => {
    const dir = listDirectory(`${REPO_PLUGINS}assistant`);
    const memory = inMemory(
      Object.fromEntries(dir.candidates.map((c) => [c.path, new TextDecoder().decode(dir.read(c.path))])),
    );
    const selection = selectPluginFiles(memory.candidates, memory.read, RESPECT);
    expect(await digestArchive(archivePlugin(selection.files))).toBe(BASELINE.assistant);
  });
});

describe("compareWalkOrder", () => {
  it("visits a directory before a file that sorts after it by name", () => {
    // A code-point sort of full paths would put "b.txt" before "b/x.txt"
    // ('.' < '/'); the walk visits the directory `b` first.
    expect(["b.txt", "b/x.txt", "a.txt"].sort(compareWalkOrder)).toEqual(["a.txt", "b/x.txt", "b.txt"]);
  });

  it("orders siblings by code point, the CLI's comparison", () => {
    expect(["B.md", "a.md", "_x.md"].sort(compareWalkOrder)).toEqual(["B.md", "_x.md", "a.md"]);
  });
});

describe("selectPluginFiles", () => {
  it("skips an ignored directory whole, and a negation inside it cannot pull a file back", () => {
    const { candidates, read } = inMemory({
      "plugin.json": "{}",
      ".gitignore": "build/\n!build/keep.txt\n",
      "build/keep.txt": "x",
      "build/out.js": "y",
      "src/a.ts": "z",
    });
    const selection = selectPluginFiles(candidates, read, RESPECT);
    expect(selection.files.entries.map((e) => e.path)).toEqual([".gitignore", "plugin.json", "src/a.ts"]);
    expect(selection.stats).toEqual({ filesIncluded: 3, filesIgnored: 0, dirsSkipped: 1, totalSize: 26 });
  });

  it("applies the security defaults and lets .env.example through", () => {
    const { candidates, read } = inMemory({ "plugin.json": "{}", ".env": "S=1", ".env.example": "S=" });
    const selection = selectPluginFiles(candidates, read, RESPECT);
    expect(selection.files.entries.map((e) => e.path)).toEqual([".env.example", "plugin.json"]);
    expect(selection.stats.filesIgnored).toBe(1);
  });

  it("ignores .gitignore when told to, and always reads .stigmerignore", () => {
    const files = { "plugin.json": "{}", ".gitignore": "*.draft\n", ".stigmerignore": "*.tmp\n", "a.draft": "", "b.tmp": "" };
    const loose = selectPluginFiles(inMemory(files).candidates, inMemory(files).read, { respectGitignore: false });
    expect(loose.files.entries.map((e) => e.path)).toContain("a.draft");
    expect(loose.files.entries.map((e) => e.path)).not.toContain("b.tmp");
    const strict = selectPluginFiles(inMemory(files).candidates, inMemory(files).read, RESPECT);
    expect(strict.files.entries.map((e) => e.path)).not.toContain("a.draft");
  });

  it("the selected reader refuses a path it did not list", () => {
    const { candidates, read } = inMemory({ "plugin.json": "{}" });
    const selection = selectPluginFiles(candidates, read, RESPECT);
    expect(() => selection.files.read("missing.md")).toThrow("plugin file 'missing.md' is not listed");
  });
});

describe("digestArchive", () => {
  it("is lowercase hex SHA-256", async () => {
    const digest = await digestArchive(new Uint8Array([1, 2, 3]));
    expect(digest).toBe("039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81");
  });
});
