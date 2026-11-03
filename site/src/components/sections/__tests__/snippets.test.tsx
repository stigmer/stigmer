/**
 * Every line of code the homepage shows is a line the Getting Started smoke
 * runs.
 *
 * The closing section shows the quickstart's commands, and "Drop it in" the
 * embed guide's src/App.tsx. test/install/smoke-getting-started.mjs runs
 * those pages as written, reading their steps with docSteps, so this reads
 * them with the same parser, and quotes them under the rule the README's
 * copy follows (test/install/lib/doc-steps.mjs). The closing commands must
 * be the quickstart's commands, in its order; "Drop it in" must be runs of
 * the guide's consecutive lines, every gap marked `// …`. A homepage line
 * that drifts from its page, or a page that drops the line, fails here,
 * naming the line.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  docSteps,
  elidedRuns,
  firstOutOfOrder,
  firstUnmarkedGap,
} from "../../../../../test/install/lib/doc-steps.mjs";
import { DropItIn } from "../DropItIn";
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

describe("the homepage's snippets", () => {
  it("shows the closing commands as the quickstart's own steps, in order", () => {
    const commands = steps("quickstart.mdx").flatMap((step) => (step.kind === "file" ? [] : [step.line]));

    const shown = shownLines(render(<FinalCTA />).container);

    expect(shown).toContain("stigmer up");
    expect(firstOutOfOrder(shown, commands)).toBeUndefined();
  });

  it("shows the embed guide's src/App.tsx as runs of its lines, every gap marked", () => {
    const app = steps("embed-agent.mdx").find((step) => step.kind === "file" && step.path === "src/App.tsx");
    if (app?.kind !== "file") throw new Error("embed-agent.mdx writes src/App.tsx");

    const shown = [...render(<DropItIn />).container.querySelectorAll("[data-code-line]")].map((line) => line.textContent ?? "");
    const runs = elidedRuns(shown);

    expect(runs.flat()).toContain("        <AgentChat agent={`${org}/variance-reporter`} />");
    expect(runs.length).toBeGreaterThan(1);
    expect(firstUnmarkedGap(runs, app.content.split("\n"))).toBeUndefined();
  });

  it("names the line that left its page", () => {
    expect(firstOutOfOrder(["a", "c"], ["a", "b", "c"])).toBeUndefined();
    expect(firstOutOfOrder(["c", "a"], ["a", "b", "c"])).toBe("a");
    expect(firstOutOfOrder(["a", "d"], ["a", "b", "c"])).toBe("d");
  });
});
