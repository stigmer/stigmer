/**
 * The shared tool-view fixtures' Claude cases are the rows the real engine
 * wrote (`test/fixtures/tool-view/result-views.json`, `harness: "claude"`).
 *
 * Why it matters: every surface reads a tool's result through one view model,
 * pinned by those fixtures, and the engine's result formats change with its
 * releases. Each Claude case names the hermetic run whose row it is
 * ({@link SOURCES}); this test holds the case's tool, server, arguments,
 * result and status equal to that row, so a fixture is never a guess at the
 * engine's format, and an engine change that moves a row fails here as well
 * as in its golden.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { capturedCase, type CapturedCase, type GoldenRow } from "../__test-utils__/tool-view-capture.js";

const GOLDENS = new URL("./hermetic/goldens/", import.meta.url);
const FIXTURE = new URL("../../../../../../../test/fixtures/tool-view/result-views.json", import.meta.url);

/** Each Claude fixture case's row: the golden that holds it, and the call's id. */
const SOURCES: Readonly<Record<string, readonly [golden: string, callId: string]>> = {
  claude_shell_success: ["tool-results.cases.json", "toolu_shell_ok"],
  claude_shell_failure: ["tool-results.cases.json", "toolu_shell_fail"],
  claude_write: ["tool-results.cases.json", "toolu_write"],
  claude_read_numbered_lines: ["tool-results.cases.json", "toolu_read"],
  claude_edit: ["tool-results.cases.json", "toolu_edit"],
  claude_glob: ["tool-results.cases.json", "toolu_glob"],
  claude_grep: ["tool-results.cases.json", "toolu_grep"],
  claude_todo_write: ["todo-list.rows.json", "toolu_todo_1"],
  claude_skill: ["plugin-skill.rows.json", "toolu_skill_lint"],
  claude_agent: ["saved-subagent.rows.json", "toolu_delegate"],
  claude_remember_proposal: ["mcp-servers.rows.json", "toolu_mcp_memory"],
};

interface FixtureCase {
  readonly name: string;
  readonly harness: string;
  readonly toolName: string;
  readonly mcpServerSlug: string;
  readonly args: Record<string, unknown>;
  readonly result: string;
  readonly error?: string;
  readonly status?: string;
}

/** Every row a golden holds, by id: a captured cases file's entries, or a rows golden's tool calls (the first row under an id). */
function rowsOf(golden: string): Map<string, CapturedCase> {
  const document = JSON.parse(readFileSync(new URL(golden, GOLDENS), "utf8")) as unknown;
  if (Array.isArray(document)) return new Map((document as CapturedCase[]).map((row) => [row.id, row]));
  const rows = new Map<string, CapturedCase>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (node !== null && typeof node === "object") {
      const row = node as Partial<GoldenRow>;
      // A sub-agent's own row shares its call's id; the call's row comes first.
      if (typeof row.id === "string" && typeof row.name === "string" && typeof row.status === "string" && !rows.has(row.id)) rows.set(row.id, capturedCase(row as GoldenRow));
      Object.values(node).forEach(walk);
    }
  };
  walk(document);
  return rows;
}

const claudeCases = (JSON.parse(readFileSync(FIXTURE, "utf8")) as { cases: FixtureCase[] }).cases.filter((c) => c.harness === "claude");

describe("the tool-view fixtures' Claude cases", () => {
  it("are exactly the cases this test names a row for", () => {
    expect(claudeCases.map((c) => c.name).sort()).toEqual(Object.keys(SOURCES).sort());
  });

  for (const fixture of claudeCases) {
    it(`${fixture.name} is the engine's own row`, () => {
      const [golden, callId] = SOURCES[fixture.name] ?? ["", ""];
      const { id: _id, ...row } = rowsOf(golden).get(callId) ?? ({} as CapturedCase);
      const { name: _name, harness: _harness, expected: _expected, ...captured } = fixture as FixtureCase & { expected: unknown };
      expect(captured).toEqual(row);
    });
  }
});
