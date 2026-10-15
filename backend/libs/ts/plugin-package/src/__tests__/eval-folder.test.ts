/**
 * Pins `readEvalFolder`, a pushed eval's reading: the same cases
 * `readEvalSuite` reads from a plugin's `evals/`, with the archive's root
 * as the suite's directory and no manifest read; every mock directory
 * whose name could be an MCP server's kept, and its name a finding when it
 * could not (`isToolNameSegment`); the suite's `servers` the mock
 * directories its cases read; a deep directory named against the folder's
 * root. The plugin reader's own results are pinned unchanged by
 * `eval-suite.test.ts`.
 */

import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { readEvalFolder, readEvalSuite } from "../evals/read-eval-suite.js";
import type { EvalSuite, EvalSuiteFinding } from "../evals/types.js";
import { inMemoryPluginFiles } from "../files.js";
import { isToolNameSegment } from "../tool-names.js";
import { directoryPluginFiles } from "../__test-utils__/directory-files.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/evals/", import.meta.url));

const LLM_GRADER = "---\ntype: llm\n---\n\nPASS if the reply answers.\n";

/** A pushed folder holding these files and one working case `c`. */
function folderOf(files: Readonly<Record<string, string>>): EvalSuite {
  return readEvalFolder(
    inMemoryPluginFiles(new Map(Object.entries({ "c/prompt.md": "Hi.", "c/graders/judge.md": LLM_GRADER, ...files }))),
  );
}

function onlyFinding(suite: EvalSuite): EvalSuiteFinding {
  expect(suite.findings, JSON.stringify(suite.findings, null, 2)).toHaveLength(1);
  return suite.findings[0] as EvalSuiteFinding;
}

describe("a pushed folder", () => {
  it("reads the cases a plugin's evals/ holds, rooted at the folder, results/ left out", () => {
    const inPlugin = readEvalSuite(directoryPluginFiles(`${FIXTURES}commit-helper`));
    const folder = readEvalFolder(directoryPluginFiles(`${FIXTURES}commit-helper/evals`));
    expect(folder.dir).toBe("");
    expect(folder.findings).toEqual([]);
    expect(folder.cases.map((c) => c.dir)).toEqual([
      "changelog-from-diff",
      "first-case",
      "negative/ignores-unrelated-request",
    ]);
    // Case for case, the same reading with every path one directory shorter.
    expect(folder.cases.map((c) => [c.name, c.prompt, c.graders.length, c.tags])).toEqual(
      inPlugin.cases.map((c) => [c.name, c.prompt, c.graders.length, c.tags]),
    );
  });

  it("reads no manifest: a plugin manifest in the folder is a file like any other", () => {
    const suite = folderOf({ ".claude-plugin/plugin.json": JSON.stringify({ name: "x" }) });
    expect(suite.cases.map((c) => c.dir)).toEqual(["c"]);
    expect(suite.findings).toEqual([]);
  });

  it("keeps a mock for any server a name could be, the root's and the case's merged, and lists them as its servers", () => {
    const suite = folderOf({
      "mocks/billing/charge.md": "Charged.",
      "mocks/billing/_tools.json": "{\"tools\": []}",
      "c/mocks/crm-v2/lookup.md": "Found.",
      "d/prompt.md": "Hello.",
      "d/graders/judge.md": LLM_GRADER,
      "d/mocks/billing/charge.md": "---\nerror: true\n---\nDeclined.",
    });
    expect(suite.findings).toEqual([]);
    expect(suite.servers).toEqual(["billing", "crm-v2"]);
    expect(suite.cases.map((c) => c.dir)).toEqual(["c", "d"]);
    expect(suite.cases[0]?.mocks).toEqual([
      {
        server: "billing",
        tools: [{ tool: "charge", file: "mocks/billing/charge.md", kind: "fixed", error: false }],
        toolsFile: "mocks/billing/_tools.json",
      },
      { server: "crm-v2", tools: [{ tool: "lookup", file: "c/mocks/crm-v2/lookup.md", kind: "fixed", error: false }] },
    ]);
    expect(suite.cases[1]?.mocks).toEqual([
      {
        server: "billing",
        tools: [{ tool: "charge", file: "d/mocks/billing/charge.md", kind: "fixed", error: true }],
        toolsFile: "mocks/billing/_tools.json",
      },
    ]);
  });

  it.each([["two__parts"], ["trailing_"], ["has.dot"], ["sp ace"]])(
    "names a mock directory %j that no MCP server could have, once, and ignores it",
    (server) => {
      const suite = folderOf({ [`mocks/${server}/t.md`]: "x" });
      expect(suite.servers).toEqual([]);
      expect(suite.cases[0]?.mocks).toEqual([]);
      expect(onlyFinding(suite)).toEqual({
        kind: "eval-mock-invalid",
        path: `mocks/${server}`,
        message: `mocks/${server}: '${server}' cannot name an MCP server (letters, digits, '-' and '_', with no '__' and no trailing '_'), so these mocks are ignored`,
      });
    },
  );

  it("holds no case when none loads, every reason a finding", () => {
    const suite = readEvalFolder(inMemoryPluginFiles(new Map([["c/prompt.md", "Hi."]])));
    expect(suite.cases).toEqual([]);
    expect(suite.findings.map((f) => f.kind)).toEqual(["eval-case-invalid"]);
  });

  it("names a directory nested too deep against the folder's root", () => {
    const nested = Array.from({ length: 33 }, (_, i) => `e${i}`).join("/");
    const suite = folderOf({ [`${nested}/prompt.md`]: "Far too deep." });
    const tooDeep = Array.from({ length: 32 }, (_, i) => `e${i}`).join("/");
    expect(onlyFinding(suite)).toEqual({
      kind: "eval-case-invalid",
      path: tooDeep,
      message: `${tooDeep}: the directory is nested too deep (cases sit at most 32 directories below the folder's root), so nothing beneath it is read`,
    });
  });
});

describe("isToolNameSegment", () => {
  it.each([
    ["billing", true],
    ["crm-v2", true],
    ["a_b", true],
    ["A9", true],
    ["two__parts", false],
    ["trailing_", false],
    ["has.dot", false],
    ["", false],
  ])("%j is %s", (name, expected) => {
    expect(isToolNameSegment(name)).toBe(expected);
  });
});
