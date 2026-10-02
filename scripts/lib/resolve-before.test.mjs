// Pins the gates' resolution margin: the `--before` cutoff is exactly the
// margin before now, a missing margin adds nothing (a release resolves live),
// and a margin that is not a positive number of hours is refused rather than
// silently resolving against now or the future. Run via
// `node --test scripts/lib/*.test.mjs` (wired into the root `npm test`).

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { resolveBefore, resolveBeforeArgs, resolveBeforeFromArgv } from "./resolve-before.mjs";

const NOW = new Date("2026-10-02T12:00:00.000Z");
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "resolve-before.mjs");

test("the cutoff is the margin's hours before now, as an ISO timestamp", () => {
  assert.equal(resolveBefore(1, NOW), "2026-10-02T11:00:00.000Z");
  assert.equal(resolveBefore("1", NOW), "2026-10-02T11:00:00.000Z", "a flag's value arrives as a string");
  assert.equal(resolveBefore(0.5, NOW), "2026-10-02T11:30:00.000Z");
});

test("no margin adds no argument, so a release resolves live", () => {
  assert.deepEqual(resolveBeforeArgs(undefined, NOW), []);
  assert.deepEqual(resolveBeforeArgs("1", NOW), ["--before=2026-10-02T11:00:00.000Z"]);
});

test("the command line gives the cutoff in either form, nothing without the flag, and refuses the flag with no value", () => {
  const cutoff = ["--before=2026-10-02T11:00:00.000Z"];
  assert.deepEqual(resolveBeforeFromArgv(["--resolve-before=1"], NOW), cutoff);
  assert.deepEqual(resolveBeforeFromArgv(["--package", "backend/services/runner", "--resolve-before", "1"], NOW), cutoff);
  assert.deepEqual(resolveBeforeFromArgv(["--package", "backend/services/runner"], NOW), [], "a release passes no flag and resolves live");
  for (const argv of [["--resolve-before"], ["--resolve-before="], ["--resolve-before", "--package", "x"]]) {
    assert.throws(() => resolveBeforeFromArgv(argv, NOW), /--resolve-before needs a number of hours/, argv.join(" "));
  }
  assert.throws(() => resolveBeforeFromArgv(["--resolve-before=soon"], NOW), /must be a positive number of hours/);
});

test("a margin that is not a positive number of hours is refused", () => {
  for (const bad of [0, -1, "", "an hour", Number.NaN, Number.POSITIVE_INFINITY, null]) {
    assert.throws(() => resolveBefore(bad, NOW), /must be a positive number of hours/, String(bad));
  }
});

test("as a command it prints the cutoff, and refuses a bad margin with exit 2", () => {
  const printed = execFileSync(process.execPath, [SCRIPT, "1"], { encoding: "utf8" }).trim();
  assert.match(printed, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const age = Date.now() - Date.parse(printed);
  assert.ok(age >= 3_600_000 - 5_000 && age <= 3_600_000 + 5_000, `an hour before now, not ${age} ms`);
  assert.throws(() => execFileSync(process.execPath, [SCRIPT, "soon"], { stdio: "pipe" }), (error) => error.status === 2);
});
