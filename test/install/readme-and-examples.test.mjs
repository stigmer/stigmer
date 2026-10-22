// Pins the root README and the examples folder to the Getting Started pages
// the smoke runs (smoke-getting-started.mjs), so the first commands and code
// a visitor to the repository sees are ones that have run. Run via
// `npm run test:scripts`.
//
// What these pin, each read with the smoke's own parser (lib/doc-steps.mjs):
//   - the README's quick start is the quickstart's commands in its order, plus
//     only the install and key lines the harness performs and one `curl` per
//     file the quickstart has the reader write, each fetching that file from
//     examples/variance-report;
//   - those example files are byte-equal to the quickstart's;
//   - the commands examples/README.md shows are the quickstart's, in its order;
//   - the README's React code is runs of consecutive lines of the src/App.tsx
//     "Put the agent in your app" writes, each run split from the next by a
//     `// …` line, so no line goes missing without a mark.
// The smoke runs the pages; this holds the copies to them, so a README line
// that drifts from its page, or a page that drops the line, fails here,
// naming the line.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { docSteps } from "./lib/doc-steps.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFileSync(`${ROOT}${path}`, "utf8");

const EXAMPLE_DIR = "examples/variance-report";
const EXAMPLE_URL = `https://raw.githubusercontent.com/stigmer/stigmer/main/${EXAMPLE_DIR}/`;
const ELISION = "// …";

const quickstart = docSteps(read("docs/getting-started/quickstart.mdx"));
const quickstartCommands = quickstart.filter((step) => step.kind === "command").map((step) => step.line);
const quickstartFiles = quickstart.filter((step) => step.kind === "file");

/** The body of the first fence of `language` in `markdown`'s section under `## <heading>`. */
function firstFence(markdown, heading, language) {
  const section = new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "mi").exec(markdown)?.[1];
  assert.ok(section !== undefined, `a "## ${heading}" section`);
  const body = new RegExp(`^\`\`\`${language}\\n([\\s\\S]*?)^\`\`\`$`, "m").exec(section)?.[1];
  assert.ok(body !== undefined, `a \`\`\`${language} fence under "## ${heading}"`);
  return body;
}

/** The README quick start's steps: its one bash fence, read as the smoke reads a page. */
function readmeQuickStart() {
  return docSteps(["```bash", firstFence(read("README.md"), "Quick start", "bash"), "```"].join("\n"));
}

const isFetch = (line) => line.startsWith("curl ");

test("the README's quick start is the quickstart's commands, in its order", () => {
  const steps = readmeQuickStart();
  assert.ok(steps.some((step) => step.kind === "harness" && step.performs === "cli"), "installs the CLI");
  assert.ok(steps.some((step) => step.kind === "harness" && step.performs === "model-key"), "hands Stigmer a model key");
  const commands = steps.filter((step) => step.kind === "command" && !isFetch(step.line)).map((step) => step.line);
  assert.deepEqual(commands, quickstartCommands);
});

test("the README fetches each file the quickstart writes from the examples folder, before it is used", () => {
  const lines = readmeQuickStart().flatMap((step) => (step.kind === "command" ? [step.line] : []));
  const fetched = lines.filter(isFetch).map((line) => {
    const match = /^curl -fsSLO (\S+)$/.exec(line);
    assert.ok(match !== null, `one URL per curl, saved under its own name: ${line}`);
    assert.ok(match[1].startsWith(EXAMPLE_URL), `fetched from ${EXAMPLE_DIR}: ${line}`);
    return match[1].slice(EXAMPLE_URL.length);
  });
  assert.deepEqual(fetched, quickstartFiles.map((step) => step.path));
  const firstUse = lines.findIndex((line) => !isFetch(line) && line !== "stigmer up");
  assert.ok(lines.findLastIndex(isFetch) < firstUse, "every file is fetched before the first command that uses it");
});

test("the example files are the quickstart's, byte for byte", () => {
  for (const step of quickstartFiles) {
    assert.equal(read(`${EXAMPLE_DIR}/${step.path}`), step.content, `${EXAMPLE_DIR}/${step.path}`);
  }
});

test("examples/README.md shows the quickstart's commands, in its order", () => {
  const shown = docSteps(read("examples/README.md")).flatMap((step) => (step.kind === "command" ? [step.line] : []));
  assert.ok(shown.some((line) => line.startsWith("stigmer run ")), "shows the run");
  assert.equal(firstOutOfOrder(shown, quickstartCommands), undefined);
});

test("the README's React code is runs of the embed page's src/App.tsx, every gap marked", () => {
  const app = docSteps(read("docs/getting-started/embed-agent.mdx")).find(
    (step) => step.kind === "file" && step.path === "src/App.tsx",
  );
  assert.ok(app !== undefined, "embed-agent.mdx writes src/App.tsx");
  const runs = elidedRuns(firstFence(read("README.md"), "Put the agent in your app", "tsx").split("\n"));
  assert.ok(runs.flat().length > 10, "shows more than a fragment");
  assert.equal(firstUnmarkedGap(runs, app.content.split("\n")), undefined);
});

/** The runs of code lines between `// …` lines, blank lines left out. */
function elidedRuns(lines) {
  const runs = [[]];
  for (const line of lines) {
    if (line.trim() === ELISION) runs.push([]);
    else if (line.trim() !== "") runs.at(-1).push(line);
  }
  return runs.filter((run) => run.length > 0);
}

/**
 * The first run that is not consecutive lines of `source` after the run
 * before it (blank source lines skipped), as its first line, or undefined.
 */
function firstUnmarkedGap(runs, source) {
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
function firstOutOfOrder(shown, source) {
  let from = 0;
  for (const line of shown) {
    const at = source.indexOf(line, from);
    if (at === -1) return line;
    from = at + 1;
  }
  return undefined;
}

test("a run that skips a line without a mark, or a line out of order, is named", () => {
  const source = ["a", "", "b", "c", "d", "b", "e"];
  assert.deepEqual(elidedRuns(["a", "b", "  // …  ", "", "d"]), [["a", "b"], ["d"]]);
  assert.equal(firstUnmarkedGap([["a", "b"], ["d"]], source), undefined);
  assert.equal(firstUnmarkedGap([["b", "e"]], source), undefined);
  assert.equal(firstUnmarkedGap([["a", "c"]], source), "a");
  assert.equal(firstUnmarkedGap([["d"], ["c"]], source), "c");
  assert.equal(firstOutOfOrder(["a", "c"], ["a", "b", "c"]), undefined);
  assert.equal(firstOutOfOrder(["c", "a"], ["a", "b", "c"]), "a");
});
