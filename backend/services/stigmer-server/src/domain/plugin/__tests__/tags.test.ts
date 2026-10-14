/**
 * Pins tags.ts: a plugin's tags derived from its manifest's keywords.
 *
 *   - every keyword in the plugin catalogue (each plugin's
 *     .cursor-plugin manifest under plugins) becomes a tag the contract admits, the catalogue's offenders ("sec
 *     filings", "a/b testing", "otter.ai") included;
 *   - each run of other characters becomes one hyphen, the ends are
 *     trimmed, a tag is cut at 50 with no trailing hyphen, a keyword that
 *     leaves nothing is dropped, repeats keep their first place, and at
 *     most 20 are kept.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MAX_TAGS, tagOfKeyword, tagsOfKeywords } from "../tags.js";

/** The contract's tag rule (metadata.proto's tags items). */
const TAG_RULE = /^[a-z0-9][a-z0-9-]{0,49}$/;

const PLUGINS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../../plugins",
);

function catalogueKeywords(): Array<[string, string[]]> {
  return readdirSync(PLUGINS)
    .map((name) => path.join(PLUGINS, name, ".cursor-plugin", "plugin.json"))
    .filter((manifest) => existsSync(manifest))
    .map((manifest) => {
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name?: string; keywords?: string[] };
      return [parsed.name ?? manifest, parsed.keywords ?? []];
    });
}

describe("tagsOfKeywords over the plugin catalogue", () => {
  it("gives every catalogue plugin tags the contract admits, its offenders included", () => {
    const catalogue = catalogueKeywords();
    expect(catalogue.length).toBeGreaterThan(10);
    const offenders = catalogue.flatMap(([, keywords]) => keywords.filter((keyword) => !TAG_RULE.test(keyword)));
    expect(offenders).toEqual(expect.arrayContaining(["sec filings", "a/b testing", "otter.ai"]));
    for (const [name, keywords] of catalogue) {
      const tags = tagsOfKeywords(keywords);
      for (const tag of tags) {
        expect(tag, `${name}: ${tag}`).toMatch(TAG_RULE);
      }
      expect(new Set(tags).size, name).toBe(tags.length);
      expect(tags.length, name).toBeLessThanOrEqual(MAX_TAGS);
    }
  });

  it("names the catalogue's offenders as search words", () => {
    expect(tagsOfKeywords(["sec filings", "a/b testing", "otter.ai", "SP Global", "mcp apps"])).toEqual([
      "sec-filings",
      "a-b-testing",
      "otter-ai",
      "sp-global",
      "mcp-apps",
    ]);
  });
});

describe("tagOfKeyword and tagsOfKeywords", () => {
  it("lowercases, joins each run of other characters with one hyphen, and trims the ends", () => {
    expect(tagOfKeyword("  Feature   Flags!! ")).toBe("feature-flags");
    expect(tagOfKeyword("--C++ / Rust--")).toBe("c-rust");
    expect(tagOfKeyword("café")).toBe("caf");
  });

  it("cuts a tag at 50 characters with no hyphen left at the end", () => {
    const long = `${"a".repeat(49)} ${"b".repeat(10)}`;
    expect(tagOfKeyword(long)).toBe("a".repeat(49));
    expect(tagOfKeyword("x".repeat(80))).toBe("x".repeat(50));
  });

  it("drops a keyword that leaves nothing, keeps a repeat's first place, and keeps at most 20", () => {
    expect(tagsOfKeywords(["!!!", "", "Go", "go", "GO!", "rust"])).toEqual(["go", "rust"]);
    const many = Array.from({ length: 30 }, (_, i) => `word ${i}`);
    expect(tagsOfKeywords(many)).toEqual(many.slice(0, MAX_TAGS).map((word) => word.replace(" ", "-")));
  });
});
