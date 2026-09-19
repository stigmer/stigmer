/**
 * The presentation read, the one a storefront card runs.
 *
 * Pins: the vendored Cursor fixtures yield their `displayName`, `logo`,
 * `category` and author (thermos, a PNG; playwright, an SVG); a Codex
 * manifest yields the same fields from `interface`, with the `./` spelling
 * stripped; a Claude manifest and an open manifest yield identity only; a
 * root manifest names the plugin ahead of a vendor manifest beside it,
 * while the vendor manifest still lends its appearance; a logo that is
 * absent from the listing, over the cap, not an image, a URL or an escape
 * is dropped without a finding; an unparseable manifest contributes nothing
 * and the read still answers. The lazy twin reads exactly the manifests
 * listed and no other file, and treats a fetch that rejects as a manifest
 * that is not there.
 */

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { type LazyCandidate } from "../client/prepare.js";
import { readPluginPresentationFromTree } from "../client/presentation.js";
import { inMemoryPluginFiles, PLUGIN_DOCUMENT_LIMITS } from "../files.js";
import { MANIFEST_LOCATIONS } from "../messages.js";
import { readPluginPresentation } from "../presentation.js";
import { claudePlugin, codexPlugin, cursorPlugin, openPlugin, withFile, type PluginFixture } from "../testing.js";
import { directoryPluginFiles } from "../__test-utils__/directory-files.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/cursor-plugins/", import.meta.url));
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

function present(files: PluginFixture) {
  return readPluginPresentation(inMemoryPluginFiles(files));
}

describe("readPluginPresentation over the vendored Cursor fixtures", () => {
  it("thermos: display name, PNG logo, category, author", () => {
    const presentation = readPluginPresentation(directoryPluginFiles(`${FIXTURES}thermos`));
    expect(presentation).toEqual({
      displayName: "Thermos",
      logo: "assets/logo.png",
      category: "developer-tools",
      version: "1.0.0",
      description: expect.stringContaining("Thermo-nuclear branch review"),
      author: { name: "Cursor", email: "plugins@cursor.com" },
    });
  });

  it("playwright: an SVG logo is an image too", () => {
    const presentation = readPluginPresentation(directoryPluginFiles(`${FIXTURES}playwright`));
    expect(presentation.displayName).toBe("Playwright");
    expect(presentation.logo).toBe("assets/logo.svg");
  });
});

describe("the dialects that carry appearance", () => {
  it("a Cursor manifest speaks at its top level", () => {
    const files = withFile(
      cursorPlugin({ manifest: { displayName: "GitHub", logo: "assets/logo.png", category: "integrations", author: { name: "Cursor" } } }),
      "assets/logo.png",
      PNG_BYTES,
    );
    expect(present(files)).toMatchObject({ displayName: "GitHub", logo: "assets/logo.png", category: "integrations", author: { name: "Cursor" } });
  });

  it("a legacy Codex manifest speaks through `interface`, and `./` is stripped from its logo", () => {
    const files = withFile(
      codexPlugin({
        version: "6.0.1",
        manifest: { interface: { displayName: "Airtable", logo: "./assets/logo.png", category: "Productivity", developerName: "Airtable" } },
      }),
      "assets/logo.png",
      PNG_BYTES,
    );
    expect(present(files)).toEqual({ displayName: "Airtable", logo: "assets/logo.png", category: "Productivity", version: "6.0.1" });
  });

  it("a Claude manifest and an open manifest yield identity only", () => {
    expect(present(claudePlugin({ version: "1.0.0", description: "Reviews pull requests.", manifest: { author: { name: "Anthropic" } } }))).toEqual({
      version: "1.0.0",
      description: "Reviews pull requests.",
      author: { name: "Anthropic" },
    });
    const open = present(openPlugin({ version: "2.0.0", description: "The assistant." }));
    expect(open.displayName).toBeUndefined();
    expect(open.logo).toBeUndefined();
    expect(open.version).toBe("2.0.0");
  });

  it("a root manifest names the plugin first; a vendor manifest beside it still lends its appearance", () => {
    let files = openPlugin({ version: "3.0.0", description: "From the root manifest." });
    files = withFile(
      files,
      MANIFEST_LOCATIONS.cursor,
      JSON.stringify({ name: "plugin", version: "1.0.0", description: "From the Cursor manifest.", displayName: "Plugin", logo: "assets/logo.png" }),
    );
    files = withFile(files, "assets/logo.png", PNG_BYTES);
    expect(present(files)).toMatchObject({ version: "3.0.0", description: "From the root manifest.", displayName: "Plugin", logo: "assets/logo.png" });
  });
});

describe("a logo that cannot be shown is no logo, never a finding", () => {
  const cases: readonly [string, string, PluginFixture | undefined][] = [
    ["not listed", "assets/missing.png", undefined],
    ["a URL", "https://example.com/logo.png", undefined],
    ["an escape", "../logo.png", undefined],
    ["not an image", "assets/logo.txt", withFile(cursorPlugin(), "assets/logo.txt", "text")],
    ["over the cap", "assets/huge.png", withFile(cursorPlugin(), "assets/huge.png", new Uint8Array(PLUGIN_DOCUMENT_LIMITS.logo + 1))],
  ];
  for (const [label, logo, base] of cases) {
    it(label, () => {
      const files = withFile(base ?? cursorPlugin(), MANIFEST_LOCATIONS.cursor, JSON.stringify({ name: "plugin", displayName: "Plugin", logo }));
      const presentation = present(files);
      expect(presentation.displayName).toBe("Plugin");
      expect(presentation.logo).toBeUndefined();
    });
  }

  it("a wrong type is absent", () => {
    const files = withFile(cursorPlugin(), MANIFEST_LOCATIONS.cursor, JSON.stringify({ name: "plugin", displayName: 7, logo: ["assets/logo.png"], author: "Cursor" }));
    expect(present(files)).toEqual({});
  });

  it("an unparseable manifest contributes nothing and the read answers", () => {
    const files = withFile(cursorPlugin({ version: "1.0.0" }), MANIFEST_LOCATIONS.cursor, "{ not json");
    expect(present(files)).toEqual({});
  });
});

describe("readPluginPresentationFromTree", () => {
  function lazy(files: PluginFixture, reads: string[], failing: ReadonlySet<string> = new Set()): LazyCandidate[] {
    const encoder = new TextEncoder();
    return [...files.entries()].map(([path, content]) => {
      const bytes = typeof content === "string" ? encoder.encode(content) : content;
      return {
        path,
        size: bytes.length,
        read: async () => {
          reads.push(path);
          if (failing.has(path)) throw new Error(`cannot read ${path}`);
          return bytes;
        },
      };
    });
  }

  it("reads exactly the manifests listed and no other file", async () => {
    const reads: string[] = [];
    const files = withFile(cursorPlugin({ manifest: { displayName: "Thermos", logo: "assets/logo.png" }, skills: [{ name: "review" }] }), "assets/logo.png", PNG_BYTES);
    const presentation = await readPluginPresentationFromTree(lazy(files, reads));
    expect(presentation).toMatchObject({ displayName: "Thermos", logo: "assets/logo.png" });
    expect(reads).toEqual([MANIFEST_LOCATIONS.cursor]);
  });

  it("a manifest whose fetch rejects is a manifest that is not there", async () => {
    const reads: string[] = [];
    const files = cursorPlugin({ manifest: { displayName: "Thermos" } });
    const presentation = await readPluginPresentationFromTree(lazy(files, reads, new Set([MANIFEST_LOCATIONS.cursor])));
    expect(presentation).toEqual({});
  });
});
