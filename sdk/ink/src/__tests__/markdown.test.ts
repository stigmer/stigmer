// Pins the terminal's markdown (INK-13): a reply split into its top-level
// blocks, as a streaming reply settles; each drawn without its syntax (no
// `#`, no backticks, no pipes) and with no colour, only weight; a table laid
// out to its columns and wrapping inside them in a narrow frame; and
// `renderMarkdown`, the same drawing as a string. Colour codes are forced on
// so the "no colour" cases see what a terminal would.
import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.FORCE_COLOR = "3";
});

import { stripVTControlCharacters } from "node:util";
import { renderMarkdown } from "../components/Markdown.js";
import { markdownBlocks, settledBlockCount } from "../markdown.js";

const REPLY = [
  "## What changed",
  "",
  "Invoices now round **once**, at the *total*, ~~per line~~ & <b>safely</b>:",
  "",
  "1. `lineTotal` keeps full precision.",
  "2. `invoiceTotal` rounds half-even to the cent.",
  "   - A credit note uses the same rule.",
  "   - [x] Its test passes.",
  "",
  "```ts",
  "export function invoiceTotal(lines: readonly Line[]): Cents {",
  "  return roundHalfEven(lines.reduce((sum, line) => sum + lineTotal(line), 0));",
  "}",
  "```",
  "",
  "| Case | Before | After |",
  "| --- | ---: | :---: |",
  "| 3 × 0.335 | 1.02 | 1.01 |",
  "| 1 × 9.995 | 10.00 | 10.00 |",
  "",
  "> Checked against `x<y` too.",
  "",
  "---",
  "",
  "See [the notes][notes], <https://example.com>, ![chart](c.png) and a  ",
  "hard break.",
  "",
  "[notes]: https://example.com/notes",
].join("\n");

/** The codes that set a colour: a foreground or background, by name, 256 or RGB. */
function colourCodes(text: string): string[] {
  const codes: string[] = [];
  for (const match of text.matchAll(/\u001b\[([\d;]*)m/g)) {
    const params = match[1]!.split(";").map(Number);
    for (let i = 0; i < params.length; i += 1) {
      const p = params[i]!;
      if (p === 38 || p === 48) {
        codes.push(match[0]);
        break;
      }
      if ((p >= 30 && p <= 37) || (p >= 40 && p <= 47) || (p >= 90 && p <= 97) || (p >= 100 && p <= 107)) codes.push(match[0]);
    }
  }
  return codes;
}

describe("renderMarkdown", () => {
  it("renders plain text without modification", () => {
    const result = renderMarkdown("Hello world");
    expect(result).toContain("Hello world");
  });

  it("renders bold text with ANSI styling", () => {
    const result = renderMarkdown("This is **bold** text");
    expect(result).toContain("bold");
    expect(result).not.toBe("This is **bold** text");
  });

  it("renders code blocks", () => {
    const result = renderMarkdown("```\nconst x = 1;\n```");
    expect(result).toContain("const x = 1");
  });

  it("renders headings", () => {
    const result = renderMarkdown("# Title");
    expect(result).toContain("Title");
  });

  it("renders lists", () => {
    const result = renderMarkdown("- item one\n- item two");
    expect(result).toContain("item one");
    expect(result).toContain("item two");
  });

  it("handles empty content", () => {
    const result = renderMarkdown("");
    expect(result).toBe("");
  });

  it("trims trailing whitespace", () => {
    const result = renderMarkdown("Hello");
    expect(result).toBe(result.trimEnd());
  });

  it("accepts custom width", () => {
    const result = renderMarkdown("A very long sentence that might wrap", 40);
    expect(result).toContain("A very long sentence");
  });
});

describe("INK-13 long markdown (lists, code, tables) reads cleanly in the terminal", () => {
  it("splits a reply into its drawn blocks, spacing and link definitions left out", () => {
    expect(markdownBlocks(REPLY).map((block) => block.type)).toEqual(["heading", "paragraph", "list", "code", "table", "blockquote", "hr", "paragraph"]);
    expect(markdownBlocks("  \n\n")).toEqual([]);
  });

  it("counts every block settled once a reply is complete, all but the last while it is written", () => {
    expect([settledBlockCount(4, false), settledBlockCount(4, true), settledBlockCount(0, true)]).toEqual([4, 3, 0]);
  });

  it("draws each block without its markdown syntax", () => {
    const text = stripVTControlCharacters(renderMarkdown(REPLY, 100));
    expect(text).toMatch(/^What changed$/m);
    expect(text).toContain("Invoices now round once, at the total, per line & <b>safely</b>:");
    expect(text).toMatch(/^1\. lineTotal keeps full precision\.$/m);
    expect(text).toMatch(/^ {3}• +A credit note uses the same rule\.$/m);
    expect(text).toMatch(/^ {3}\[x\] Its test passes\.$/m);
    expect(text).toMatch(/^│ {3}return roundHalfEven/m);
    expect(text).toMatch(/^Case\s+Before\s+After$/m);
    expect(text).toMatch(/^─+\s+─+\s+─+$/m);
    expect(text).toMatch(/^3 × 0\.335\s+1\.02\s+1\.01$/m);
    expect(text).toMatch(/^┃ Checked against x<y too\.$/m);
    expect(text).toMatch(/^─{100}$/m);
    expect(text).toContain("See the notes (https://example.com/notes), https://example.com, [chart] (c.png) and a\nhard break.");
    for (const syntax of ["##", "`", "**", "~~", "| ---", "[notes]:", "&amp;", "&lt;"]) expect(text).not.toContain(syntax);
  });

  it("right-aligns and centres the columns a table asks for", () => {
    const text = stripVTControlCharacters(renderMarkdown(REPLY, 100));
    expect(text).toMatch(/^1 × 9\.995\s+10\.00\s+10\.00$/m);
    expect(text).toMatch(/^3 × 0\.335 {4}1\.02 {2}1\.01$/m);
  });

  it("draws in weight alone: bold, italic, dim, underline and strikethrough, never a colour", () => {
    const raw = renderMarkdown(REPLY, 100);
    expect(raw).toContain("\u001b[1m");
    expect(raw).toContain("\u001b[3m");
    expect(raw).toContain("\u001b[2m");
    expect(raw).toContain("\u001b[4m");
    expect(raw).toContain("\u001b[9m");
    expect(colourCodes(raw)).toEqual([]);
  });

  it("wraps a table's cells inside their columns in a frame narrower than the table", () => {
    const table = "| Case | What it checks |\n| --- | --- |\n| half cent | a total of three lines at a third of a cent each, rounded once |";
    const wide = stripVTControlCharacters(renderMarkdown(table, 100));
    expect(wide).toMatch(/^half cent\s+a total of three lines at a third of a cent each, rounded once$/m);
    const narrow = stripVTControlCharacters(renderMarkdown(table, 60)).split("\n");
    for (const line of narrow) expect(line.length).toBeLessThanOrEqual(60);
    expect(narrow[0]).toMatch(/^Case\s+What it checks$/);
    expect(narrow[1]).toMatch(/^─+\s+─+$/);
    expect(narrow[2]).toMatch(/^half\s+a total of three lines/);
    expect(narrow.slice(2).join("\n")).toMatch(/rounded once$/);
  });

  it("draws an html block as written, and a link whose text is its address once", () => {
    expect(stripVTControlCharacters(renderMarkdown("<details>open</details>"))).toBe("<details>open</details>");
    expect(stripVTControlCharacters(renderMarkdown("Mail <me@example.com> or [x](x)."))).toBe("Mail me@example.com or x.");
  });
});
