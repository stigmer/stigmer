// Pins the Go pass of a contract rename: the compiler's complaint lines are
// read for the flagged token or the import no module provides, the token
// nearest the reported column is rewritten through the table, a moved
// package's import follows and its default alias is renamed throughout the
// file, and a token the table does not know, or an unflagged one spelled the
// same, is left alone. Run via `node --test scripts/lib/*.test.mjs`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseGoDiagnostics, renamedImportPath, rewriteGoFile } from "./contract-rename-go.mjs";

const TABLE = {
  directories: { "ai/x/agentrun/v1": "ai/x/run/v1" },
  go: {
    identifiers: { AgentRun: "Run", GetAgentRunId: "GetRunId", AgentRunId: "RunId", Kind_agent_run: "Kind_run" },
    packageAliases: { agentrunv1: "runv1" },
  },
};

test("compiler lines become flagged tokens and missing imports", () => {
  const output = [
    "# example.com/sdk",
    "vet: from_proto.go:12:20: undefined: agentrunv1.AgentRun",
    "./client.go:30:9: r.GetAgentRunId undefined (type *runv1.Run has no field or method GetAgentRunId)",
    "kinds.go:5:12: undefined: Kind_agent_run",
    "from_proto.go:9:2: no required module provides package example.com/proto/ai/x/agentrun/v1; to add it:",
    "lit.go:3:4: unknown field AgentRunId in struct literal of type runv1.Ref",
    "something unrelated",
  ].join("\n");
  assert.deepEqual(parseGoDiagnostics(output), [
    { file: "from_proto.go", line: 12, col: 20, name: "AgentRun" },
    { file: "./client.go", line: 30, col: 9, name: "GetAgentRunId" },
    { file: "kinds.go", line: 5, col: 12, name: "Kind_agent_run" },
    { file: "from_proto.go", line: 9, col: 2, importPath: "example.com/proto/ai/x/agentrun/v1" },
    { file: "lit.go", line: 3, col: 4, name: "AgentRunId" },
  ]);
});

test("an import path follows its moved directory only on a whole-segment match", () => {
  assert.equal(
    renamedImportPath("example.com/proto/ai/x/agentrun/v1", TABLE.directories),
    "example.com/proto/ai/x/run/v1",
  );
  assert.equal(renamedImportPath("example.com/proto/ai/x/session/v1", TABLE.directories), undefined);
});

test("the flagged token is rewritten, the alias follows its package, and the rest stays", () => {
  const text = [
    "package sdk",
    "",
    "import (",
    '\tagentrunv1 "example.com/proto/ai/x/agentrun/v1"',
    ")",
    "",
    "// AgentRun in a comment stays; only flagged tokens change.",
    'func f(r *agentrunv1.AgentRun) string { return r.GetAgentRunId() + "AgentRunId" }',
  ].join("\n");
  const {
    text: out,
    count,
    left,
  } = rewriteGoFile(
    text,
    [
      { line: 4, col: 2, importPath: "example.com/proto/ai/x/agentrun/v1" },
      { line: 8, col: 21, name: "AgentRun" },
      { line: 8, col: 49, name: "GetAgentRunId" },
      { line: 8, col: 1, name: "Unknown" },
    ],
    TABLE,
  );
  assert.equal(count, 4, "import, two tokens, alias");
  assert.deepEqual(left, [{ line: 8, col: 1, name: "Unknown" }]);
  assert.match(out, /\trunv1 "example\.com\/proto\/ai\/x\/run\/v1"/);
  assert.match(out, /func f\(r \*runv1\.Run\) string \{ return r\.GetRunId\(\) \+ "AgentRunId" \}/);
  assert.match(out, /\/\/ AgentRun in a comment stays/);
});

test("of two same-spelled tokens on a line, the one nearest the column is rewritten", () => {
  const { text } = rewriteGoFile("x := AgentRunId; y := AgentRunId", [{ line: 1, col: 23, name: "AgentRunId" }], TABLE);
  assert.equal(text, "x := AgentRunId; y := RunId");
});
