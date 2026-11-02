/**
 * Every component a docs page renders is one the page imports or one the
 * docs give every page.
 *
 * A page that names a component the docs do not provide fails only when the
 * site builds, far from the change. This reads every page under docs/ (the
 * archive aside, which the site does not build) and checks every
 * capitalized tag against the page's own imports and `getMDXComponents`,
 * naming the page and the tag.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getMDXComponents } from "../mdx";

const DOCS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../docs");

/**
 * A page's text outside its fenced code blocks, read line by line as
 * Markdown does: a fence closes on a line of the same character, at least as
 * long, with nothing after it.
 */
function outsideFences(source: string): string {
  let fence: RegExp | null = null;
  return source
    .split("\n")
    .filter((line) => {
      if (fence) {
        if (fence.test(line)) fence = null;
        return false;
      }
      const open = /^\s*(`{3,}|~{3,})/.exec(line);
      if (open) fence = new RegExp(`^\\s*\\${open[1][0]}{${open[1].length},}\\s*$`);
      return !open;
    })
    .join("\n");
}

/**
 * The capitalized tags a page renders that it neither imports nor declares
 * itself. A tag opens after a space, a line start, a bracket or a pipe,
 * never straight after a word or inside a string's `key:<…>`, so a type in a
 * generated reference (`Promise<Result>`, `"org:<OAuthApp id>"`) is not one.
 */
function unimportedTags(source: string): string[] {
  const code = outsideFences(source).replace(/`[^`\n]*`/g, "");
  const imported = new Set(
    [...code.matchAll(/^import\s+(?:(\w+)|\{([^}]*)\})\s+from/gm)].flatMap(([, single, named]) =>
      single ? [single] : named.split(",").map((name) => name.trim().split(/\s+as\s+/).at(-1)!),
    ),
  );
  const declared = new Set([...code.matchAll(/^export\s+(?:function|const)\s+(\w+)/gm)].map(([, name]) => name));
  const tags = [...code.matchAll(/(?<![\w$.\]:])<([A-Z]\w*)/g)].map(([, tag]) => tag);
  return [...new Set(tags)].filter((tag) => !imported.has(tag) && !declared.has(tag));
}

/** Every page under docs/ the site builds, relative to docs/. */
function pages(): string[] {
  return readdirSync(DOCS, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".mdx") && !file.startsWith("_archive"))
    .map((file) => relative(DOCS, join(DOCS, file)))
    .sort();
}

describe("the docs' MDX components", () => {
  it("provides every component a docs page renders", () => {
    const provided = getMDXComponents();
    const read = pages();
    const missing = read.flatMap((page) =>
      unimportedTags(readFileSync(join(DOCS, page), "utf8"))
        .filter((tag) => !(tag in provided))
        .map((tag) => `docs/${page}: <${tag}>`),
    );

    expect(read).toContain("index.mdx");
    expect(unimportedTags(readFileSync(join(DOCS, "index.mdx"), "utf8"))).toContain("Diagram");
    expect(missing, `tags no import or getMDXComponents provides:\n${missing.join("\n")}`).toEqual([]);
  });
});
