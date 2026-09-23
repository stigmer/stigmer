// Pins the CLI's edge for the marketplace reader: a tree read through the one
// walker, the refusal shape, entry lookup and directory resolution, and the
// official tree in this repository reading clean.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { writeCursorMarketplace } from "./__fixtures__/cursor-marketplace.js";
import { resolveOfficialMarketplace } from "./official.js";
import { entryDirectory, findEntry, readMarketplaceTree } from "./read.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "stigmer-marketplace-read-"));
  writeCursorMarketplace(root);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("readMarketplaceTree", () => {
  it("reads a Cursor-dialect tree into the one shape, dropping the missing entry with its sentence", () => {
    const tree = readMarketplaceTree(root);
    expect(tree.marketplace.name).toBe("acme-plugins");
    expect(tree.marketplace.dialect).toBe("cursor");
    expect(tree.marketplace.plugins.map((entry) => entry.name)).toEqual([
      "warmer",
      "codeforge",
    ]);
    expect(tree.warnings).toHaveLength(1);
    expect(tree.warnings[0]?.kind).toBe("entry-directory-missing");
    expect(tree.warnings[0]?.subject).toBe("ghost");
  });

  it("refuses a directory with no marketplace file, naming the four locations", () => {
    const empty = mkdtempSync(join(tmpdir(), "stigmer-marketplace-empty-"));
    try {
      writeFileSync(join(empty, "README.md"), "nothing here");
      expect(() => readMarketplaceTree(empty, "github.com/a/b")).toThrow(
        /github\.com\/a\/b: not a marketplace this CLI can read, 1 problem found:\n  - .*marketplace\.json/,
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it("refuses a broken file with every problem and every warning", () => {
    const broken = mkdtempSync(join(tmpdir(), "stigmer-marketplace-broken-"));
    try {
      writeFileSync(
        join(broken, "marketplace.json"),
        JSON.stringify({
          plugins: [
            { name: "a", source: "../out" },
            { name: "b", source: "https://x" },
          ],
        }),
      );
      expect(() => readMarketplaceTree(broken)).toThrow(
        /2 problems found:[\s\S]*and 1 warning:/,
      );
    } finally {
      rmSync(broken, { recursive: true, force: true });
    }
  });
});

describe("findEntry and entryDirectory", () => {
  it("resolves an offered entry to its absolute directory and an unknown name to undefined", () => {
    const tree = readMarketplaceTree(root);
    const codeforge = findEntry(tree.marketplace, "codeforge");
    expect(codeforge?.dir).toBe("third_party/codeforge");
    expect(entryDirectory(tree, codeforge!)).toBe(
      join(root, "third_party", "codeforge"),
    );
    expect(findEntry(tree.marketplace, "ghost")).toBeUndefined();
  });
});

describe("the official tree in this repository", () => {
  it("reads clean through the CLI walker", () => {
    const official = resolveOfficialMarketplace();
    expect(official.source).toBe("repo");
    const tree = readMarketplaceTree(official.dir);
    expect(tree.marketplace.name).toBe("stigmer");
    expect(tree.marketplace.dialect).toBe("stigmer");
    expect(tree.warnings).toEqual([]);
    expect(findEntry(tree.marketplace, "linear")?.dir).toBe("linear");
  });
});
