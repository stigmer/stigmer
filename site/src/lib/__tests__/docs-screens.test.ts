/**
 * Every value a docs picture draws is printed on its page.
 *
 * The visual suite draws a docs page's pictures from one examples file
 * (test/visual/src/docs-examples.ts): the routine's name, its message, the
 * Agent's instructions. This holds each value to its page's source, with
 * whitespace collapsed because a sentence wraps across MDX lines, so a page
 * edited without the file, or the file without its page, fails here before
 * the picture says something the page does not.
 *
 * A value named `…Label` is a control the page tells the reader to press or
 * fill, so it is held in the page's bold form (`**Create key**`), as a whole
 * bold span or one step of a bold path (`**Add channel → Slack**`): a short
 * label such as "Name" printed anywhere else on the page does not hold it.
 * The scene's act reaches the control by the same value, so a renamed control
 * fails whichever side moved.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DOCS_EXAMPLES, type DocsExample } from "../../../../test/visual/src/docs-examples";

const DOCS = join(dirname(fileURLToPath(import.meta.url)), "../../../../docs");

const collapsed = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The page's bold spans, each whole and each step of a path (`Settings → Vaults`, `Settings > Service accounts`). */
function boldSpans(page: string): Set<string> {
  const spans = [...page.matchAll(/\*\*([^*]+)\*\*/g)].map((match) => (match[1] ?? "").trim());
  return new Set(spans.flatMap((span) => [span, ...span.split(/ [→>] /)]));
}

/** Each value of `example` its page's source does not print, as `<what>: <value>`; a label as `<what>: **<label>**`. */
function missingValues(example: DocsExample, source: string): string[] {
  const page = collapsed(source);
  const bold = boldSpans(page);
  return Object.entries(example)
    .filter(([what]) => what !== "page")
    .flatMap(([what, value]) => [value].flat().map((one) => [what, one] as const))
    .flatMap(([what, one]) => {
      if (what.endsWith("Label")) return bold.has(collapsed(one)) ? [] : [`${what}: **${one}**`];
      return page.includes(collapsed(one)) ? [] : [`${what}: ${one}`];
    });
}

describe("the docs' pictures say what their pages say", () => {
  it("draws examples from pages that exist, one example per page", () => {
    const pages = DOCS_EXAMPLES.map((example) => example.page);
    expect(new Set(pages).size).toBe(pages.length);
    for (const page of pages) expect(() => readFileSync(join(DOCS, `${page}.mdx`), "utf8"), page).not.toThrow();
  });

  for (const example of DOCS_EXAMPLES) {
    it(`prints every value its pictures draw on ${example.page}`, () => {
      const source = readFileSync(join(DOCS, `${example.page}.mdx`), "utf8");
      expect(missingValues(example, source), `docs/${example.page}.mdx no longer prints these; change the page and test/visual/src/docs-examples.ts together`).toEqual([]);
    });
  }

  it("finds a value its page does not print, across the page's line breaks", () => {
    const example = { page: "p", name: "daily-variance-report", message: "save the report as variances.csv." };
    expect(missingValues(example, "a `daily-variance-report` that will\n   save the report as\n variances.csv.")).toEqual([]);
    expect(missingValues(example, "a `daily-report` that will save the report as variances.csv.")).toEqual(["name: daily-variance-report"]);
  });

  it("holds a label only where the page bolds it, whole or as a step of a path", () => {
    const example = { page: "p", nameLabel: "Name", newLabel: "New service account", slackLabel: "Slack" };
    expect(missingValues(example, "Select **New service\naccount**, give it a **Name**, then **Add channel → Slack**.")).toEqual([]);
    expect(missingValues(example, "Select **New service account**. Name it. Choose **Slack app**.")).toEqual([
      "nameLabel: **Name**",
      "slackLabel: **Slack**",
    ]);
    expect(missingValues({ page: "p", secretLabel: "Client secret" }, "the **Client Secret**")).toEqual(["secretLabel: **Client secret**"]);
    expect(missingValues({ page: "p", accountsLabel: "Service accounts" }, "Open **Settings > Service accounts**.")).toEqual([]);
  });
});
