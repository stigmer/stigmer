/**
 * The bundled Temporal's setup step refuses a database password with a space,
 * at once and by name. Temporal's Postgres plugin escapes the password with a
 * query-string escape when it builds its connection URL, which turns a space
 * into `+`, and the URL parser reads that `+` back literally
 * (temporalio/temporal#12235), so a spaced password fails as "password
 * authentication failed" after the setup step's minute of retries. Every
 * other byte round-trips, so only the space is refused.
 *
 * Both copies of the script run here under `sh`, compose's and the chart's
 * (the parity test holds them byte for byte equal; this file runs them),
 * with a stub `temporal-sql-tool` first on PATH that records each call and
 * the password it was handed, so nothing needs Docker, Postgres or Temporal:
 *
 *   - a password with a space exits 1 with the line naming the space, never
 *     reaches the tool (so never enters the retry loop), and is never
 *     printed;
 *   - a password carrying any other awkward byte reaches the tool unchanged
 *     and the script exits 0.
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  chartScript,
  composeScript,
  containerNamed,
  findOne,
  RELEASE,
  renderProfile,
} from "./helpers.mjs";

// Records each call's arguments, one line per call, and the password it saw.
const STUB_TOOL = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_DIR/calls"
printf '%s' "$SQL_PASSWORD" > "$STUB_DIR/password"
`;

// Two databases, three steps each: create, setup-schema, update-schema.
const CALLS_ON_SUCCESS = 6;

function scripts() {
  const temporal = findOne(renderProfile("bundled"), "Deployment", `${RELEASE}-temporal`)
    .spec.template.spec;
  return [
    ["compose", composeScript("temporal-schema")],
    ["chart", chartScript(containerNamed(temporal, "temporal-schema", { init: true }))],
  ];
}

/** Runs a setup script with the stub tool and a password; returns what it did. */
function runSetup(script, password) {
  const dir = mkdtempSync(join(tmpdir(), "stigmer-temporal-schema-"));
  try {
    const tool = join(dir, "temporal-sql-tool");
    writeFileSync(tool, STUB_TOOL);
    chmodSync(tool, 0o755);
    const result = spawnSync("sh", ["-c", script], {
      encoding: "utf8",
      // The retry loop sleeps 3 s between attempts; a run that reaches it
      // with the stub succeeding never sleeps, so this bound is generous.
      timeout: 30_000,
      env: {
        PATH: `${dir}:/usr/bin:/bin`,
        STUB_DIR: dir,
        SQL_PASSWORD: password,
      },
    });
    const calls = existsSync(join(dir, "calls"))
      ? readFileSync(join(dir, "calls"), "utf8").trim().split("\n")
      : [];
    const seen = existsSync(join(dir, "password"))
      ? readFileSync(join(dir, "password"), "utf8")
      : null;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls, seen };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const SPACED = ["correct horse battery", " leading", "trailing ", "one space"];

// The bytes the issue measured, each alone and all together, plus a tab and a
// non-ASCII letter: a query-string escape percent-encodes every one of them,
// and the URL parser decodes them back.
const ROUND_TRIP = [
  ..."@$/#?%:&='+".split("").map((ch) => `pa${ch}ss`),
  "@$/#?%:&='+",
  "tab\there",
  "pässwörd",
  "0123456789abcdef0123456789abcdef0123456789abcdef",
];

for (const [source, script] of scripts()) {
  for (const password of SPACED) {
    test(`${source}'s setup step refuses ${JSON.stringify(password)} by name, before the tool`, () => {
      const run = runSetup(script, password);
      assert.equal(run.status, 1, `stderr: ${run.stderr}`);
      assert.match(run.stderr, /^temporal-schema: the database password \(POSTGRES_PASSWORD\) contains a space/m);
      assert.match(run.stderr, /openssl rand -hex 24/);
      assert.deepEqual(run.calls, [], "the tool is never called");
      assert.doesNotMatch(run.stderr, /retrying/);
      assert.ok(!(run.stdout + run.stderr).includes(password), "the password is never printed");
    });
  }

  for (const password of ROUND_TRIP) {
    test(`${source}'s setup step hands ${JSON.stringify(password)} to the tool unchanged`, () => {
      const run = runSetup(script, password);
      assert.equal(run.status, 0, `stderr: ${run.stderr}`);
      assert.equal(run.calls.length, CALLS_ON_SUCCESS, run.calls.join("\n"));
      assert.equal(run.seen, password);
    });
  }
}
