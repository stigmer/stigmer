/**
 * Every component the docs front page renders is one the page imports or one
 * the docs give every page.
 *
 * A page that names a component the docs do not provide fails only when the
 * site builds, far from the change. This reads docs/index.mdx and checks
 * every capitalized tag against the page's own imports and
 * `getMDXComponents`, naming the tag.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getMDXComponents } from "../mdx";

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../docs");

/** The capitalized tags a page renders that it does not import itself. */
function unimportedTags(source: string): string[] {
  const code = source.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const imported = new Set(
    [...code.matchAll(/^import\s+(?:(\w+)|\{([^}]*)\})\s+from/gm)].flatMap(([, single, named]) =>
      single ? [single] : named.split(",").map((name) => name.trim().split(/\s+as\s+/).at(-1)!),
    ),
  );
  const tags = [...code.matchAll(/<([A-Z]\w*)/g)].map(([, tag]) => tag);
  return [...new Set(tags)].filter((tag) => !imported.has(tag));
}

describe("the docs' MDX components", () => {
  it("provides every component the front page renders", () => {
    const provided = getMDXComponents();
    const tags = unimportedTags(readFileSync(join(DOCS, "index.mdx"), "utf8"));

    expect(tags).toContain("JobPath");
    for (const tag of tags) expect(tag in provided, `docs/index.mdx: <${tag}>`).toBe(true);
  });
});
