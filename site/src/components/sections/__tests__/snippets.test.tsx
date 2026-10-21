/**
 * Every line of code the homepage shows is a line the Getting Started smoke
 * runs.
 *
 * The hero shows three calls from variance-report.ts, the file "Do the same
 * job from your app" has the reader write; the closing section shows the
 * quickstart's commands. test/install/smoke-getting-started.mjs runs both
 * pages as written, reading their steps with docSteps, so this reads them
 * with the same parser: each shown line must be one of the page's lines, in
 * the page's order (lines may be left out between them; blank lines are not
 * compared). A homepage line that drifts from its page, or a page that drops
 * the line, fails here, naming the line.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { docSteps } from "../../../../../test/install/lib/doc-steps.mjs";
import { Hero } from "../Hero";
import { FinalCTA } from "../FinalCTA";

afterEach(cleanup);

const GETTING_STARTED = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../docs/getting-started");

/** A page's steps, in the shapes docSteps documents. */
type Step =
  | { kind: "file"; path: string; content: string }
  | { kind: "command" | "harness"; line: string };

function steps(page: string): Step[] {
  return docSteps(readFileSync(resolve(GETTING_STARTED, page), "utf8")) as Step[];
}

/** The code lines a rendered section shows, blank lines left out. */
function shownLines(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-code-line]")]
    .map((line) => line.textContent ?? "")
    .filter((line) => line.trim() !== "");
}

/** The first shown line that is not one of `source`'s lines after the line before it, or undefined. */
function firstOutOfOrder(shown: readonly string[], source: readonly string[]): string | undefined {
  let from = 0;
  for (const line of shown) {
    const at = source.indexOf(line, from);
    if (at === -1) return line;
    from = at + 1;
  }
  return undefined;
}

describe("the homepage's snippets", () => {
  it("shows the hero's code as lines of variance-report.ts, in order", () => {
    const file = steps("call-from-your-app.mdx").find(
      (step) => step.kind === "file" && step.path === "variance-report.ts",
    );
    expect(file?.kind, "call-from-your-app.mdx writes variance-report.ts").toBe("file");

    const shown = shownLines(render(<Hero />).container);

    expect(shown.length).toBeGreaterThan(10);
    expect(firstOutOfOrder(shown, file?.kind === "file" ? file.content.split("\n") : [])).toBeUndefined();
  });

  it("shows the closing commands as the quickstart's own steps, in order", () => {
    const commands = steps("quickstart.mdx").flatMap((step) => (step.kind === "file" ? [] : [step.line]));

    const shown = shownLines(render(<FinalCTA />).container);

    expect(shown).toContain("stigmer up");
    expect(firstOutOfOrder(shown, commands)).toBeUndefined();
  });

  it("names the line that left its page", () => {
    expect(firstOutOfOrder(["a", "c"], ["a", "b", "c"])).toBeUndefined();
    expect(firstOutOfOrder(["c", "a"], ["a", "b", "c"])).toBe("a");
    expect(firstOutOfOrder(["a", "d"], ["a", "b", "c"])).toBe("d");
  });
});
