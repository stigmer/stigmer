// The sandbox image holds what the server's launch command starts.
// Run via `node --test scripts/runner-launch-contract.test.mjs` (wired into root `npm test`).
//
// The drivers launch the runner with the command in the server's
// src/sandbox/runner-launch.ts; the image is built by the runner's
// Dockerfile.sandbox, and its compose-runner stage bakes the same command
// as its CMD, because compose sets none. The two files live in two
// packages, so this test reads both and fails when the CMD is not the
// server's runner command, or when the runner layer does not put the Node
// and the slim artifact where that command looks for them.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOCKERFILE = readFileSync(
  join(ROOT, "backend/services/runner/Dockerfile.sandbox"),
  "utf8",
);
const { RUNNER_NODE, RUNNER_ENTRY, runnerCommand } = await import(
  join(ROOT, "backend/services/stigmer-server/src/sandbox/runner-launch.ts")
);

/** The instructions of one stage, from its FROM line to the next. */
function stage(name) {
  const lines = DOCKERFILE.split("\n");
  const start = lines.findIndex((line) =>
    new RegExp(`^FROM\\s.*\\sAS\\s+${name}\\s*$`, "i").test(line),
  );
  assert.notEqual(start, -1, `Dockerfile.sandbox has no stage ${name}`);
  const end = lines.findIndex((line, i) => i > start && /^FROM\s/i.test(line));
  return lines.slice(start, end === -1 ? undefined : end);
}

test("the compose runner's CMD is the server's runner command", () => {
  const cmd = stage("compose-runner").filter((line) => /^CMD\s/.test(line));
  assert.equal(cmd.length, 1);
  assert.deepEqual(JSON.parse(cmd[0].replace(/^CMD\s+/, "")), runnerCommand());
});

test("the runner layer puts the Node and the artifact where the command starts them", () => {
  const copies = stage("runner-layer").filter((line) => /^COPY\s/.test(line));
  const destinations = copies.map((line) => line.trim().split(/\s+/).at(-1));
  assert.ok(
    destinations.includes(RUNNER_NODE),
    `no COPY lands on ${RUNNER_NODE}: ${destinations.join(", ")}`,
  );
  assert.ok(
    destinations.includes(`${dirname(RUNNER_ENTRY)}/`),
    `no COPY lands on ${dirname(RUNNER_ENTRY)}/: ${destinations.join(", ")}`,
  );
});

test("the sandbox image is the base plus the runner layer's own COPY lines", () => {
  const sandbox = stage("sandbox");
  assert.match(sandbox[0], /^FROM\s+base\s+AS\s+sandbox/i);
  const copies = (lines) => lines.filter((line) => /^COPY\s/.test(line));
  assert.deepEqual(copies(sandbox), copies(stage("runner-layer")));
});
