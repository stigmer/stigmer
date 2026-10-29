// Tests for scripts/check-migration-sums.mjs: a branch may add schema steps
// after the base's and may not change, reorder or remove a merged one, nor
// delete a sum file the base holds.
// Run via `node --test scripts/check-migration-sums.test.mjs`.
//
// The comparison is proven on texts; the git walk on a throwaway repository
// with a base commit and a working-tree edit, which is how the gate runs it.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  checkMigrationSums,
  compareSums,
  sumLines,
} from "./check-migration-sums.mjs";

const HEADER = "# One line per schema step.\n";
const ONE = "1 aaaa";
const TWO = "2 bbbb";

test("sumLines keeps the step lines and drops comments and blanks", () => {
  assert.deepEqual(sumLines(`${HEADER}\n${ONE}\n${TWO}\n`), [ONE, TWO]);
});

test("a branch that adds a step after the base's passes", () => {
  assert.deepEqual(
    compareSums(
      "x/migrations.sum",
      `${HEADER}${ONE}\n`,
      `${HEADER}${ONE}\n${TWO}\n`,
    ),
    [],
  );
  assert.deepEqual(
    compareSums(
      "x/migrations.sum",
      `${HEADER}${ONE}\n`,
      `# reworded header\n${ONE}\n`,
    ),
    [],
  );
});

test("a changed, reordered or removed merged line is refused, naming it", () => {
  const changed = compareSums(
    "x/migrations.sum",
    `${ONE}\n${TWO}\n`,
    `${ONE}\n2 cccc\n`,
  );
  assert.equal(changed.length, 1);
  assert.match(changed[0], /the merged line "2 bbbb" now reads "2 cccc"/);

  const reordered = compareSums(
    "x/migrations.sum",
    `${ONE}\n${TWO}\n`,
    `${TWO}\n${ONE}\n`,
  );
  assert.equal(reordered.length, 2);

  const removed = compareSums(
    "x/migrations.sum",
    `${ONE}\n${TWO}\n`,
    `${ONE}\n`,
  );
  assert.deepEqual(removed, [
    'x/migrations.sum: the merged line "2 bbbb" was removed',
  ]);
});

test("a deleted sum file is refused", () => {
  assert.deepEqual(compareSums("x/migrations.sum", `${ONE}\n`, undefined), [
    "x/migrations.sum: removed, but its steps have merged; a merged step never goes",
  ]);
});

test("checkMigrationSums reads the base from git and the branch from the working tree", () => {
  const root = mkdtempSync(join(tmpdir(), "migration-sums-"));
  try {
    const run = (...args) =>
      execFileSync("git", args, { cwd: root, stdio: "ignore" });
    run("init", "-q", "-b", "main");
    run("config", "user.email", "test@example.com");
    run("config", "user.name", "test");
    mkdirSync(join(root, "chain"));
    writeFileSync(join(root, "chain", "migrations.sum"), `${HEADER}${ONE}\n`);
    run("add", ".");
    run("commit", "-q", "-m", "base");

    writeFileSync(
      join(root, "chain", "migrations.sum"),
      `${HEADER}${ONE}\n${TWO}\n`,
    );
    assert.deepEqual(checkMigrationSums(root, "main"), {
      checked: ["chain/migrations.sum"],
      refusals: [],
    });

    writeFileSync(join(root, "chain", "migrations.sum"), `${HEADER}1 ffff\n`);
    assert.equal(checkMigrationSums(root, "main").refusals.length, 1);

    rmSync(join(root, "chain", "migrations.sum"));
    assert.match(checkMigrationSums(root, "main").refusals[0], /removed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
