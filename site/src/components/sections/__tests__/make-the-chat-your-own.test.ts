/**
 * Each step of "Make the chat your own" changes `src/App.tsx` by an excerpt,
 * and the run step shows the file whole: the whole file is what the
 * embedding tutorial's end-to-end test writes and builds (strict), so every
 * excerpt must be runs of its lines, in order, every gap marked `// …`,
 * under the rule the hooks guide and the homepage's snippets follow
 * (test/install/lib/doc-steps.mjs). Lines compare without their leading
 * spaces, so an excerpt can show a JSX attribute at the margin. The whole
 * file also imports every file the page writes, so no step's file is left
 * out of the app the test builds. A step that drifts from the file fails
 * here, naming the line. And every import the whole file has that the
 * embedding tutorial's `src/App.tsx` does not is shown in some excerpt, so a
 * reader who applies the steps one at a time is never missing one.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { docSteps, elidedRuns, firstUnmarkedGap } from "../../../../../test/install/lib/doc-steps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(resolve(HERE, "../../../../../docs/getting-started/make-the-chat-your-own.mdx"), "utf8");
const EMBED_PAGE = readFileSync(resolve(HERE, "../../../../../docs/getting-started/embed-agent.mdx"), "utf8");
const EXCERPT = 'no-compile="a run of src/App.tsx, shown whole in the last step"';

interface FileStep {
  readonly kind: "file";
  readonly path: string;
  readonly content: string;
}

const files = (docSteps(PAGE) as { kind: string }[]).filter((step): step is FileStep => step.kind === "file");
const whole = files.find((file) => file.path === "src/App.tsx");

/** The bodies of the page's App.tsx excerpts, as lines. */
function excerpts(markdown: string): string[][] {
  return [...markdown.matchAll(/^```tsx ([^\n]*)\n([\s\S]*?)^```$/gm)]
    .filter((match) => match[1]!.includes(EXCERPT))
    .map((match) => match[2]!.replace(/\n$/, "").split("\n"));
}

const trimmed = (lines: readonly string[]) => lines.map((line) => line.trim());

/** Each import statement in `source`, its whitespace collapsed. */
function imports(source: string): string[] {
  return [...source.matchAll(/^import [\s\S]*?;$/gm)].map((match) => match[0].replace(/\s+/g, " ").replace(/{ /g, "{").replace(/,? }/g, "}"));
}

describe("Make the chat your own", () => {
  it("writes src/App.tsx whole, last, after the files it imports", () => {
    expect(whole).toBeDefined();
    expect(files.at(-1)?.path).toBe("src/App.tsx");
  });

  it("changes src/App.tsx by excerpts, one or more per step", () => {
    expect(excerpts(PAGE).length).toBeGreaterThanOrEqual(5);
  });

  it("shows each excerpt as runs of the whole file's consecutive lines, every gap marked", () => {
    const source = trimmed(whole!.content.split("\n"));
    for (const excerpt of excerpts(PAGE)) expect(firstUnmarkedGap(elidedRuns(trimmed(excerpt)), source)).toBeUndefined();
  });

  it("shows in an excerpt every import the steps add to the tutorial's App.tsx", () => {
    const before = (docSteps(EMBED_PAGE) as { kind: string; path?: string; content?: string }[]).find((step) => step.kind === "file" && step.path === "src/App.tsx");
    const had = new Set(imports(before!.content!));
    const shown = new Set(excerpts(PAGE).flatMap((excerpt) => imports(excerpt.join("\n"))));
    expect(imports(whole!.content).filter((line) => !had.has(line) && !shown.has(line))).toEqual([]);
  });

  it("imports every file the page writes into the app", () => {
    const written = files.filter((file) => file.path !== "src/App.tsx").map((file) => `./${file.path.replace(/^src\//, "").replace(/\.tsx$/, "")}`);
    const imported = [...whole!.content.matchAll(/^import (?:[^"]* from )?"([^"]+)";$/gm)].map((match) => match[1]);
    expect(written.filter((path) => !imported.includes(path))).toEqual([]);
  });
});
