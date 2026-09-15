/**
 * Pins who may CREATE a transcript row: an `AgentMessage`, a `ToolCall` or a
 * `SubAgentExecution` on the execution status. Two writers, and no third:
 *
 *  - `src/harness/transcript/` — the one transcript builder, which every
 *    harness folds its engine's events through (`TurnSink.transcript`);
 *  - `src/harness/terminal-table.ts` — the runtime's terminal system rows
 *    (the pause copy, the failure copy), which are not transcript facts of
 *    any engine and never were.
 *
 * Why it matters (the canonical-transcript entry, Q-S4-1): the promise that a
 * third harness is "a translator and nothing else" holds only while there
 * is exactly one place a row comes from. A module that builds a row itself
 * — an adapter pushing an AI message with a WAITING call, a settle
 * synthesizing a SYSTEM line — is a second copy of the folding rule, and
 * the two copies drift (the memo counted three such copies before this
 * entry). The rule is about CREATION. Amending a row a builder created —
 * flipping a WAITING row SKIPPED, stamping a change-set id, marking a
 * sub-agent CANCELLED, the Cursor boundary's identity-based collapses — is
 * legitimate, and the modules that do it are named in `TurnSink`'s header;
 * a fence over them would be a list, not a rule.
 *
 * Until the runtime seeds a reinvocation's prior rows through the builder,
 * `src/harness/turn-context.ts` is a third creator (its `seedFromPersistedStatus`
 * pushes the persisted transcript straight onto the status); the allow-list
 * names it so the shrink to two is a predicted move, not a surprise.
 *
 * The rule is read off the TypeScript syntax tree, as the import fences are
 * (`import-direction.test.ts`): a schema named in a header comment, or a
 * `.messages.push(` in prose, cannot trip it; a row built through any of the
 * three schemas, or an array push onto `messages` / `subAgentExecutions`
 * wherever the array is reached from, cannot slip past it.
 */

import { describe, it, expect } from "vitest";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { readSource, typeScriptFilesUnder } from "../../__test-utils__/module-specifiers.js";

const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The proto schemas a transcript row is created through; naming one is creating one. */
const ROW_SCHEMAS: ReadonlySet<string> = new Set(["AgentMessageSchema", "ToolCallSchema", "SubAgentExecutionSchema"]);

/** The status arrays a created row is pushed onto. */
const ROW_ARRAYS: ReadonlySet<string> = new Set(["messages", "subAgentExecutions"]);

/**
 * The modules allowed to create rows, relative to `src/`: a directory (every
 * file under it) or a file. `turn-context.ts` leaves this list when the seed
 * goes through the builder (see the header).
 */
const ALLOWED_CREATORS: readonly string[] = [
  join("harness", "transcript") + sep,
  join("harness", "terminal-table.ts"),
  join("harness", "turn-context.ts"),
];

/** Every row-creating construct in `source`, in source order: `names <Schema>` or `pushes onto .<array>`. */
export function transcriptRowWrites(fileName: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, /* setParentNodes */ false);
  const writes: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && ROW_SCHEMAS.has(node.text)) {
      const write = `names ${node.text}`;
      if (!writes.includes(write)) writes.push(write);
    } else if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "push" &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      ROW_ARRAYS.has(node.expression.expression.name.text)
    ) {
      const write = `pushes onto .${node.expression.expression.name.text}`;
      if (!writes.includes(write)) writes.push(write);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return writes;
}

function isAllowedCreator(relativeFile: string): boolean {
  return ALLOWED_CREATORS.some((allowed) => (allowed.endsWith(sep) ? relativeFile.startsWith(allowed) : relativeFile === allowed));
}

interface Offence {
  readonly file: string;
  readonly writes: readonly string[];
}

interface Sweep {
  readonly visited: string[];
  readonly creators: string[];
  readonly offences: Offence[];
}

/** Production modules only: tests and test utilities build rows freely (fixtures, goldens' drivers). */
function sweep(): Sweep {
  const visited: string[] = [];
  const creators: string[] = [];
  const offences: Offence[] = [];
  for (const file of typeScriptFilesUnder(SRC_ROOT, new Set(["__tests__", "__test-utils__"]))) {
    const relativeFile = relative(SRC_ROOT, file);
    visited.push(relativeFile);
    const writes = transcriptRowWrites(file, readSource(file));
    if (writes.length === 0) continue;
    creators.push(relativeFile);
    if (!isAllowedCreator(relativeFile)) offences.push({ file: relativeFile, writes });
  }
  return { visited, creators, offences };
}

function describeOffences(offences: readonly Offence[]): string {
  return offences.map((o) => `  ${o.file}: ${o.writes.join(", ")}`).join("\n");
}

describe("transcriptRowWrites (the checker itself)", () => {
  const file = join(SRC_ROOT, "activities", "some-harness", "settle.ts");

  it.each([
    ["a message built through its schema", 'const m = create(AgentMessageSchema, { content: "x" });', "names AgentMessageSchema"],
    ["a tool call built through its schema", "const tc = create(ToolCallSchema, { id });", "names ToolCallSchema"],
    ["a sub-agent row built through its schema", "const row = create(SubAgentExecutionSchema, { id });", "names SubAgentExecutionSchema"],
    ["a schema merely imported", 'import { AgentMessageSchema } from "@stigmer/protos/x_pb";', "names AgentMessageSchema"],
    ["a push onto the root transcript", "status.messages.push(msg);", "pushes onto .messages"],
    ["a push onto a nested transcript", "scope.row.messages.push(msg);", "pushes onto .messages"],
    ["a spread push", "sink.status.messages.push(...seed.messages);", "pushes onto .messages"],
    ["a push onto the sub-agent rows", "this.proto.subAgentExecutions.push(row);", "pushes onto .subAgentExecutions"],
  ])("flags %s", (_label, source, expected) => {
    expect(transcriptRowWrites(file, source)).toEqual([expected]);
  });

  it.each([
    ["a schema named in a comment", "// built through AgentMessageSchema elsewhere\nconst x = 1;"],
    ["a push described in a comment", "// the builder does status.messages.push(msg)\nconst x = 1;"],
    ["a schema named in a string", 'const hint = "AgentMessageSchema";'],
    ["a read of the transcript", "const last = status.messages.at(-1);"],
    ["a push onto an unrelated array", "status.artifacts.push(artifact);"],
    ["a push onto a bare `messages` local", "messages.push(m);"],
    ["the message TYPE, not its schema", 'import type { AgentMessage } from "@stigmer/protos/x_pb";'],
    ["an in-place amendment of a row", "row.status = ToolCallStatus.TOOL_CALL_SKIPPED;"],
  ])("does not flag %s", (_label, source) => {
    expect(transcriptRowWrites(file, source)).toEqual([]);
  });

  it("names each construct once, in source order", () => {
    const source = [
      "const a = create(AgentMessageSchema, {});",
      "const b = create(ToolCallSchema, {});",
      "const c = create(AgentMessageSchema, {});",
      "a.toolCalls.push(b); status.messages.push(a); status.messages.push(c);",
    ].join("\n");
    expect(transcriptRowWrites(file, source)).toEqual(["names AgentMessageSchema", "names ToolCallSchema", "pushes onto .messages"]);
  });
});

describe("only the transcript builder and the terminal table create transcript rows", () => {
  const result = sweep();

  it("inspected production modules across src/ and skipped the test trees (the walk is rooted where it claims)", () => {
    expect(result.visited).toEqual(
      expect.arrayContaining([
        join("harness", "run-turn.ts"),
        join("harness", "transcript", "builder.ts"),
        join("activities", "execute-cursor", "boundary-rows.ts"),
        join("activities", "execute-deep-agent", "hitl.ts"),
        join("shared", "exact-apply.ts"),
      ]),
    );
    expect(
      result.visited.some((f) => f.includes(`${sep}__tests__${sep}`) || f.includes(`${sep}__test-utils__${sep}`)),
      "the production sweep must skip the test trees",
    ).toBe(false);
  });

  it("found the allowed creators (the checker sees the rows it exists to see)", () => {
    expect(result.creators).toEqual(
      expect.arrayContaining([
        join("harness", "transcript", "builder.ts"),
        join("harness", "transcript", "state.ts"),
        join("harness", "terminal-table.ts"),
      ]),
    );
  });

  it("finds no creator outside the allow-list", () => {
    expect(
      result.offences,
      `a transcript row is created through TurnSink.transcript, never built in place:\n${describeOffences(result.offences)}`,
    ).toEqual([]);
  });
});
