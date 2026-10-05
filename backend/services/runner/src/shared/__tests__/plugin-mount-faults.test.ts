/**
 * Pins the plugin tamper guard's two failure paths a real filesystem only
 * meets by accident, staged here by faults injected at the module seams:
 *  - a file that cannot be read mid-check (the shell removed it between the
 *    listing and the read) counts as a difference, and the tree is rebuilt;
 *  - a tree that still differs once written (a filesystem that folds two
 *    names into one) refuses, so no hook runs from something other than the
 *    archive.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const faults = vi.hoisted(() => ({ failingReads: 0, dropFirstEntry: false }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    readFile: ((...args: Parameters<typeof actual.readFile>) => {
      if (faults.failingReads > 0) {
        faults.failingReads -= 1;
        return Promise.reject(Object.assign(new Error("removed mid-check"), { code: "ENOENT" }));
      }
      return actual.readFile(...args);
    }) as typeof actual.readFile,
  };
});

vi.mock("../archive-mount.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../archive-mount.js")>();
  return {
    ...actual,
    writeArchiveEntries: ((dir, entries, label) =>
      actual.writeArchiveEntries(dir, faults.dropFirstEntry ? entries.slice(1) : entries, label)) as typeof actual.writeArchiveEntries,
  };
});

import { PluginTree } from "../plugin-mount.js";

const entries = [
  { path: "hooks/check", content: new TextEncoder().encode("#!/bin/sh\nexit 0\n") },
  { path: "hooks/hooks.json", content: new TextEncoder().encode('{"hooks":{}}') },
];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "plugin-mount-faults-"));
  faults.failingReads = 0;
  faults.dropFirstEntry = false;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("the tamper guard under faults", () => {
  it("rebuilds a tree it could not read to the end", async () => {
    const tree = new PluginTree(join(dir, "tree"), entries);
    await tree.verify();
    writeFileSync(join(tree.root, "hooks/check"), "#!/bin/sh\nexit 9\n");
    faults.failingReads = 1;
    await tree.verify();
    expect(readFileSync(join(tree.root, "hooks/check"), "utf-8")).toBe("#!/bin/sh\nexit 0\n");
  });

  it("refuses a tree that still differs from the archive once written", async () => {
    faults.dropFirstEntry = true;
    const tree = new PluginTree(join(dir, "tree"), entries);
    await expect(tree.verify()).rejects.toThrow("does not match its verified archive after a rebuild");
  });
});
