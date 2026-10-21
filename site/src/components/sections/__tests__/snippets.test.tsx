/**
 * Every line of code the homepage shows is a line the Getting Started smoke
 * runs.
 *
 * The hero shows three calls from variance-report.ts, the file "Do the same
 * job from your app" has the reader write; the closing section shows the
 * quickstart's commands. test/install/smoke-getting-started.mjs runs both
 * pages as written, reading their steps with docSteps, so this reads them
 * with the same parser. The hero's lines between two elision marks must be
 * consecutive lines of the file, each run after the one before (blank lines
 * are not compared), so no line goes missing without a mark; the closing
 * commands must be the quickstart's commands, in its order. A homepage line
 * that drifts from its page, or a page that drops the line, fails here,
 * naming the line.
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

/** The runs of code lines between elision marks, blank lines left out. */
function shownRuns(container: HTMLElement): string[][] {
  const runs: string[][] = [[]];
  for (const row of container.querySelectorAll("[data-code-line], [data-code-elided]")) {
    if (row.hasAttribute("data-code-elided")) runs.push([]);
    else if ((row.textContent ?? "").trim() !== "") runs.at(-1)!.push(row.textContent ?? "");
  }
  return runs.filter((run) => run.length > 0);
}

/**
 * The first run that is not consecutive lines of `source` after the run
 * before it (blank source lines skipped), as its first line, or undefined.
 */
function firstUnmarkedGap(runs: readonly string[][], source: readonly string[]): string | undefined {
  const lines = source.filter((line) => line.trim() !== "");
  let from = 0;
  for (const run of runs) {
    let at = lines.indexOf(run[0], from);
    while (at !== -1 && run.some((line, i) => lines[at + i] !== line)) at = lines.indexOf(run[0], at + 1);
    if (at === -1) return run[0];
    from = at + run.length;
  }
  return undefined;
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
  it("shows the hero's code as runs of variance-report.ts, every gap marked", () => {
    const file = steps("call-from-your-app.mdx").find(
      (step) => step.kind === "file" && step.path === "variance-report.ts",
    );
    expect(file?.kind, "call-from-your-app.mdx writes variance-report.ts").toBe("file");

    const runs = shownRuns(render(<Hero />).container);

    expect(runs.flat().length).toBeGreaterThan(10);
    expect(firstUnmarkedGap(runs, file?.kind === "file" ? file.content.split("\n") : [])).toBeUndefined();
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

  it("names the run that skips a line without a mark", () => {
    const source = ["a", "", "b", "c", "d", "b", "e"];
    expect(firstUnmarkedGap([["a", "b"], ["d"]], source)).toBeUndefined();
    expect(firstUnmarkedGap([["b", "e"]], source)).toBeUndefined();
    expect(firstUnmarkedGap([["a", "c"]], source)).toBe("a");
    expect(firstUnmarkedGap([["d"], ["c"]], source)).toBe("c");
  });
});
