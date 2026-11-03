/**
 * Every line of code the hooks guide shows is a line of the program it
 * builds, and the guide shows all of it.
 *
 * "Build a chat from the hooks" (docs/sdk/react-core/build-a-chat.mdx)
 * quotes sdk/react-core/examples/chat/Chat.tsx, which the package's
 * typecheck compiles and the gallery draws on the page. Each of its
 * `Chat.tsx` fences must be runs of the program's consecutive lines, every
 * gap marked `// …`, under the rule the homepage's snippets follow
 * (test/install/lib/doc-steps.mjs); and every section of the program (its
 * `// ---- … ----` lines) must be quoted somewhere, so a part added to the
 * program cannot go unexplained. A guide line that drifts from the program
 * fails here, naming the line.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { elidedRuns, firstUnmarkedGap } from "../../../../../test/install/lib/doc-steps.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GUIDE = readFileSync(resolve(HERE, "../../../../../docs/sdk/react-core/build-a-chat.mdx"), "utf8");
const PROGRAM = readFileSync(resolve(HERE, "../../../../../sdk/react-core/examples/chat/Chat.tsx"), "utf8").split("\n");

/** The bodies of the guide's fences titled `Chat.tsx`, as lines. */
function quotedFences(markdown: string): string[][] {
  return [...markdown.matchAll(/^```tsx title="Chat\.tsx"[^\n]*\n([\s\S]*?)^```$/gm)].map((match) => match[1]!.replace(/\n$/, "").split("\n"));
}

describe("the hooks guide", () => {
  const fences = quotedFences(GUIDE);

  it("quotes the program in fences titled Chat.tsx", () => {
    expect(fences.length).toBeGreaterThanOrEqual(5);
  });

  it("shows each fence as runs of the program's consecutive lines, every gap marked", () => {
    for (const fence of fences) expect(firstUnmarkedGap(elidedRuns(fence), PROGRAM)).toBeUndefined();
  });

  it("quotes every part of the program", () => {
    const sections = PROGRAM.filter((line) => /^\/\/ ---- .+ ----$/.test(line));
    const firstLines = sections.map((header) => PROGRAM[PROGRAM.indexOf(header) + 2]!);
    const quoted = new Set(fences.flat());
    expect(sections.length).toBeGreaterThanOrEqual(5);
    expect(firstLines.filter((line) => !quoted.has(line))).toEqual([]);
  });

  it("names the program every reader can open beside it", () => {
    expect(GUIDE).toContain('no-compile="a run of sdk/react-core/examples/chat/Chat.tsx');
  });
});
