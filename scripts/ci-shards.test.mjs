// Tests for scripts/ci-shards.mjs: the shape every sharded CI job must have.
// Run via `node --test scripts/ci-shards.test.mjs` (wired into root `npm test`).
//
// What these guard: a job that splits a suite with `--shard=<index>/<count>`
// runs the whole suite only when its matrix lists every index from 1 to
// <count>. A matrix of [1, 2] under `/3`, or a fixed `--shard=1/3`, runs part
// of the suite and every job is green, so the third that never ran is a
// quiet pass. The real workflows are read as they are, and fixtures pin each
// way the shape can drift: a gap, a fixed index, two counts in one job, a
// shard matrix with no shard in its commands, an exclude, include or `if:`
// that drops a listed shard after all, fail-fast cancelling a shard's
// siblings before they report, and artifact names that collide across shards.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { shardFindings, shardedJobs } from "./ci-shards.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(root, ".github/workflows");
const workflows = readdirSync(workflowsDir)
  .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
  .map((file) => ({ file, doc: parse(readFileSync(join(workflowsDir, file), "utf8")) }));

/** A one-job workflow, the job built from the overrides. */
function fixture(job) {
  return [{ file: "ci.fixture.yaml", doc: { jobs: { suite: job } } }];
}

const sharded = (count, overrides = {}) => ({
  strategy: { "fail-fast": false, matrix: { shard: Array.from({ length: count }, (_, i) => i + 1) } },
  steps: [
    { run: `npx vitest run --shard=\${{ matrix.shard }}/${count}` },
    { uses: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", with: { name: "report-${{ matrix.shard }}" } },
  ],
  ...overrides,
});

test("every sharded job in the repository's workflows runs its whole suite", () => {
  assert.deepEqual(shardFindings(workflows), []);
});

test("the repository shards its long lanes, so the check above is not vacuous", () => {
  const jobs = shardedJobs(workflows).map(({ file, job, count }) => `${file} ${job} /${count}`);
  assert.ok(jobs.length > 0, "no job passes --shard; the rule above judged nothing");
});

test("a matrix of every index from 1 to the count, fail-fast off, passes", () => {
  assert.deepEqual(shardFindings(fixture(sharded(3))), []);
  const spaced = sharded(2);
  spaced.steps[0] = { run: "npx playwright test --project=functional --shard ${{ matrix.shard }}/2" };
  assert.deepEqual(shardFindings(fixture(spaced)), []);
});

test("a matrix that misses an index is refused: the missing shard never runs", () => {
  const gapped = sharded(3);
  gapped.strategy.matrix.shard = [1, 2];
  const [finding] = shardFindings(fixture(gapped));
  assert.match(finding, /ci\.fixture\.yaml suite: the matrix's shard list is \[1,2\], but the commands split the suite \/3/);
});

test("a fixed shard index is refused: one job runs part of the suite", () => {
  const fixed = { steps: [{ run: "npm run test:execution -- --shard=1/3" }] };
  const [finding] = shardFindings(fixture(fixed));
  assert.match(finding, /`--shard=1\/3` is not `\$\{\{ matrix\.shard \}\}\/<count>`/);
});

test("two counts in one job are refused", () => {
  const twice = sharded(2);
  twice.steps.push({ run: "npx vitest run --shard=${{ matrix.shard }}/3" });
  assert.ok(shardFindings(fixture(twice)).some((f) => /splits by \/2 and \/3/.test(f)));
});

test("a shard matrix whose commands never shard is refused: every job would run the whole suite", () => {
  const unused = sharded(2);
  unused.steps = [{ run: "npx vitest run" }];
  const [finding] = shardFindings(fixture(unused));
  assert.match(finding, /has a shard matrix but no step passes `--shard`/);
});

test("fail-fast left on is refused: one red shard would cancel the others before they report", () => {
  const fast = sharded(2);
  delete fast.strategy["fail-fast"];
  const [finding] = shardFindings(fixture(fast));
  assert.match(finding, /`strategy\.fail-fast` must be false/);
});

test("an artifact name without the shard is refused: the shards' uploads would collide", () => {
  const colliding = sharded(2);
  colliding.steps[1] = { uses: "actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02", with: { name: "report" } };
  const [finding] = shardFindings(fixture(colliding));
  assert.match(finding, /uploads the artifact `report`, which does not name the shard/);
});

test("a matrix exclude or include that names a shard is refused: the listed shard need not run", () => {
  const excluded = sharded(3);
  excluded.strategy.matrix.exclude = [{ shard: 3 }];
  assert.match(shardFindings(fixture(excluded)).join("\n"), /`strategy\.matrix\.exclude` names a shard/);
  const included = sharded(3);
  included.strategy.matrix.include = [{ shard: 4 }];
  assert.match(shardFindings(fixture(included)).join("\n"), /`strategy\.matrix\.include` names a shard/);
  const other = sharded(2);
  other.strategy.matrix.target = ["a", "b"];
  other.strategy.matrix.include = [{ target: "a", extra: true }];
  assert.deepEqual(shardFindings(fixture(other)), [], "an include that leaves the shard alone is fine");
});

test("a condition on the shard that runs a suite step or the job is refused: it skips that shard green", () => {
  const skipped = sharded(3);
  skipped.steps[0] = { ...skipped.steps[0], if: "matrix.shard != 3" };
  assert.match(shardFindings(fixture(skipped)).join("\n"), /the step running `--shard` is conditional on the shard/);
  const job = sharded(3, { if: "${{ matrix.shard < 3 }}" });
  assert.match(shardFindings(fixture(job)).join("\n"), /the job is conditional on the shard/);
  const once = sharded(3);
  once.steps.unshift({ run: "npm run typecheck", if: "matrix.shard == 1" });
  assert.deepEqual(shardFindings(fixture(once)), [], "a step that runs no shard may run in one shard only");
});

test("continue-on-error over the shard, or a condition over the job index, is refused: both hide a shard", () => {
  const forgiving = sharded(3);
  forgiving.steps[0] = { ...forgiving.steps[0], "continue-on-error": "${{ matrix.shard == 3 }}" };
  assert.match(shardFindings(fixture(forgiving)).join("\n"), /`continue-on-error` on the step running `--shard`/);
  const job = sharded(3, { "continue-on-error": true });
  assert.match(shardFindings(fixture(job)).join("\n"), /`continue-on-error` on the job/);
  const indexed = sharded(3);
  indexed.steps[0] = { ...indexed.steps[0], if: "strategy.job-index != 2" };
  assert.match(shardFindings(fixture(indexed)).join("\n"), /the step running `--shard` is conditional on the shard/);
  const indexedJob = sharded(3, { if: "${{ strategy.job-index < 2 }}" });
  assert.match(shardFindings(fixture(indexedJob)).join("\n"), /the job is conditional on the shard/);
});
