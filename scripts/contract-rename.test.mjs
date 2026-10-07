// Pins the contract-rename command: its flags (a repeated flag collects, a
// flag without a value is refused), the residue pattern derived from a table
// (whole names only, so `SubAgentRun` is not a hit for `AgentRun`, and a
// message that only moved package is a hit by its full name, never its short one), and the
// `table` command end to end on two images, including the refusal of a
// change that is not a rename with exit code 2. Run via
// `node --test scripts/*.test.mjs` (wired into the root `npm test`).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseArgs, residuePattern } from "./contract-rename.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "contract-rename.mjs");

const image = (messageName, fieldName) => ({
  file: [
    {
      name: "ai/x/v1/api.proto",
      package: "ai.x.v1",
      messageType: [
        {
          name: messageName,
          field: [{ name: fieldName, number: 1, jsonName: fieldName.replace(/_(\w)/g, (_, c) => c.toUpperCase()) }],
        },
      ],
    },
  ],
});

test("flags parse into values and lists, and a bare flag is refused", () => {
  assert.deepEqual(parseArgs(["ts", "--table", "t.json", "--project", "a", "--project", "b"]), {
    command: "ts",
    flags: { table: "t.json", project: ["a", "b"] },
  });
  assert.throws(() => parseArgs(["ts", "--table"]), /--table needs a value/);
  assert.throws(() => parseArgs(["ts", "stray"]), /unexpected argument stray/);
});

test("the residue pattern matches whole old names only", () => {
  const re = new RegExp(
    residuePattern({
      packages: { "ai.x.agentrun.v1": "ai.x.run.v1" },
      typeNames: { "ai.x.agentrun.v1.AgentRun": "ai.x.run.v1.Run", "ai.x.agentrun.v1.Todo": "ai.x.run.v1.Todo" },
      json: { agentRunId: "runId" },
      rpc: { "ai.x.agentrun.v1.Q/get": "ai.x.run.v1.Q/get" },
      ts: { identifiers: { AgentRunSchema: "RunSchema" } },
      directories: { "ai/x/agentrun/v1": "ai/x/run/v1" },
    }),
  );
  for (const hit of [
    "const a: AgentRun",
    "x.agentRunId",
    '"ai.x.agentrun.v1.Q/get"',
    "from 'p/ai/x/agentrun/v1/api_pb'",
    "AgentRunSchema)",
  ]) {
    assert.ok(re.test(hit), hit);
  }
  assert.ok(re.test("ai.x.agentrun.v1.Todo"), "a moved message's full name is a hit");
  for (const miss of ["SubAgentRun", "AgentRunDefaults", "myagentRunId", "const t: Todo"]) {
    assert.ok(!re.test(miss), miss);
  }
});

test("the table command writes a table, and refuses a change that is not a rename", () => {
  const dir = mkdtempSync(join(tmpdir(), "contract-rename-cli-"));
  try {
    writeFileSync(join(dir, "base.json"), JSON.stringify(image("AgentRun", "agent_run_id")));
    writeFileSync(join(dir, "head.json"), JSON.stringify(image("Run", "run_id")));
    const ok = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "table",
        "--base",
        join(dir, "base.json"),
        "--head",
        join(dir, "head.json"),
        "--out",
        join(dir, "t.json"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /2 renamed, 0 added/);
    const t = JSON.parse(readFileSync(join(dir, "t.json"), "utf8"));
    assert.equal(t.ts.identifiers.agentRunId, "runId");

    writeFileSync(
      join(dir, "head.json"),
      JSON.stringify({
        file: [{ name: "ai/x/v1/api.proto", package: "ai.x.v1", messageType: [{ name: "Run", field: [] }] }],
      }),
    );
    const refused = spawnSync(
      process.execPath,
      [
        SCRIPT,
        "table",
        "--base",
        join(dir, "base.json"),
        "--head",
        join(dir, "head.json"),
        "--out",
        join(dir, "t.json"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /not a rename:\n {2}- ai\.x\.v1\.AgentRun: agent_run_id = 1 is gone from the head/);

    const unknown = spawnSync(process.execPath, [SCRIPT, "rename-everything"], { encoding: "utf8" });
    assert.equal(unknown.status, 2);
    assert.match(unknown.stderr, /unknown command rename-everything/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
