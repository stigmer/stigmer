/**
 * Every component a docs page renders is one the page imports or one the
 * docs give every page.
 *
 * A page that names a component the docs do not provide fails only when the
 * site builds, far from the change. This reads every page under docs/ (the
 * archive aside, which the site does not build) and checks every
 * capitalized tag against the page's own imports and `getMDXComponents`,
 * naming the page and the tag.
 *
 * And every Markdown code block's and table's scroll area is a Tab stop, so
 * a keyboard can scroll a long line or a wide table (stigmer#2902,
 * stigmer#3314). The table's wrapper is drawn here rather than by fumadocs,
 * so it is held to every class fumadocs' own wrapper carries: a fumadocs bump
 * that changes the wrapper reds this file instead of changing the look.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import defaultMdxComponents from "fumadocs-ui/mdx";
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

afterEach(cleanup);

describe("the docs' MDX components", () => {
  it("makes every code block's scroll area a Tab stop", () => {
    const { pre: Pre } = getMDXComponents();
    const { container } = render(
      <Pre>
        <code>echo a line long enough to scroll</code>
      </Pre>,
    );
    const area = container.querySelector(".fd-scroll-container");
    expect(area?.getAttribute("tabindex")).toBe("0");
    expect(area?.textContent).toBe("echo a line long enough to scroll");
  });

  it("makes every table's scroll area a Tab stop", () => {
    const { table: Table } = getMDXComponents();
    const { container } = render(
      <Table>
        <tbody>
          <tr>
            <td>a cell wide enough to scroll</td>
          </tr>
        </tbody>
      </Table>,
    );
    const area = container.firstElementChild;
    expect(area?.getAttribute("tabindex")).toBe("0");
    expect(area?.querySelector(":scope > table td")?.textContent).toBe("a cell wide enough to scroll");
  });

  it("keeps every class of fumadocs' own table wrapper", () => {
    const { table: Table } = getMDXComponents();
    const { table: FumadocsTable } = defaultMdxComponents;
    const ours = render(<Table />).container.firstElementChild;
    const theirs = render(<FumadocsTable />).container.firstElementChild;
    const theirClasses = [...(theirs?.classList ?? [])];

    expect(theirClasses).toContain("overflow-auto");
    expect(theirClasses.filter((name) => !ours?.classList.contains(name))).toEqual([]);
  });

  it("provides every component a docs page renders", () => {
    const provided = getMDXComponents();
    const read = pages();
    const missing = read.flatMap((page) =>
      unimportedTags(readFileSync(join(DOCS, page), "utf8"))
        .filter((tag) => !(tag in provided))
        .map((tag) => `docs/${page}: <${tag}>`),
    );

    expect(read).toContain("index.mdx");
    expect(unimportedTags(readFileSync(join(DOCS, "index.mdx"), "utf8"))).toContain("SetupPrompt");
    expect(missing, `tags no import or getMDXComponents provides:\n${missing.join("\n")}`).toEqual([]);
  });
});
