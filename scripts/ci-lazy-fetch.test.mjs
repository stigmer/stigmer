// Tests for scripts/ci-lazy-fetch.mjs: every job the merge queue waits on that checks out without file contents signs in git's fetches of them.
// Run via `node --test scripts/ci-lazy-fetch.test.mjs` (wired into root `npm test`).
//
// What these guard: a blob-free checkout leaves git to download each file's
// contents when a later step reads it, and unsigned those downloads can be
// refused (#2322). The real workflows are read as they are, and fixtures pin
// each way the rule can drift: a blob-free job with no sign-in, a sign-in
// placed after a step that already reads, a full checkout (not judged), a
// partial clone by another filter, a job reached only through a call
// (judged), and a workflow outside the queue's set (not judged). The set is
// pinned as not vacuous: it holds the five blob-free jobs the Gate runs today.
// And the copies of the sign-in step are pinned equal, so a fix to one cannot
// leave the others behind.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { lazyFetchFindings, lazyFetchJobs, SIGN_IN_MARK } from "./ci-lazy-fetch.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(root, ".github/workflows");
const workflows = readdirSync(workflowsDir)
  .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
  .map((file) => ({ file, doc: parse(readFileSync(join(workflowsDir, file), "utf8")) }));

const checkout = (filter) => ({
  uses: "actions/checkout@11d5960a326750d5838078e36cf38b85af677262",
  with: { "fetch-depth": 0, ...(filter === undefined ? {} : { filter }), "persist-credentials": false },
});
const signIn = { name: "Sign in", run: `echo "${SIGN_IN_MARK}" >> "$GITHUB_ENV"` };
const reads = { name: "Read", run: "git show HEAD~1:package.json" };
const job = (...steps) => ({ "runs-on": "ubuntu-latest", "timeout-minutes": 10, steps });

/** A queue root (`on: merge_group`) with the given jobs, plus any further workflows. */
function fixture(jobs, others = []) {
  return [{ file: "ci.root.yaml", doc: { on: { merge_group: null }, jobs } }, ...others];
}

test("every blob-free job the merge queue waits on signs in its fetches", () => {
  assert.deepEqual(lazyFetchFindings(workflows), []);
});

test("the judged set holds the Gate's five blob-free jobs, so the check above is not vacuous", () => {
  const judged = lazyFetchJobs(workflows);
  for (const at of [
    "ci.gate.yaml lanes",
    "ci.gate.yaml coverage",
    "ci.integrity.yaml integrity",
    "ci.review.yaml review",
    "ci.ts-workspace.yaml changes",
  ]) {
    assert.ok(judged.includes(at), at);
  }
});

test("every copy of the sign-in step is the same step", () => {
  const steps = [];
  for (const { doc } of workflows) {
    for (const def of Object.values(doc?.jobs ?? {})) {
      for (const step of def?.steps ?? []) if (typeof step?.run === "string" && step.run.includes(SIGN_IN_MARK)) steps.push(step);
    }
  }
  assert.ok(steps.length >= 5, `found ${steps.length} copies`);
  for (const step of steps.slice(1)) assert.deepEqual(step, steps[0]);
});

test("a blob-free job whose next step signs in passes", () => {
  assert.deepEqual(lazyFetchFindings(fixture({ suite: job(checkout("blob:none"), signIn, reads) })), []);
});

test("a blob-free job with no sign-in is refused, named, with the filter and where to read the fix", () => {
  const findings = lazyFetchFindings(fixture({ suite: job(checkout("blob:none"), reads) }));
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /^ci\.root\.yaml suite checks out with `filter: blob:none`, but its next step does not sign in .*#2322.*scripts\/ci-lazy-fetch\.mjs's header/);
});

test("a sign-in after a step that already reads is refused: that step's fetches went out unsigned", () => {
  const findings = lazyFetchFindings(fixture({ suite: job(checkout("blob:none"), reads, signIn) }));
  assert.equal(findings.length, 1, findings.join("\n"));
});

test("a blob-free checkout as a job's last step is refused", () => {
  assert.equal(lazyFetchFindings(fixture({ suite: job(checkout("blob:none")) })).length, 1);
});

test("a partial clone by another filter is judged too", () => {
  assert.equal(lazyFetchFindings(fixture({ suite: job(checkout("tree:0"), reads) })).length, 1);
});

test("a full checkout is not judged", () => {
  const all = fixture({ suite: job(checkout(), reads), empty: job(checkout(""), reads) });
  assert.deepEqual(lazyFetchFindings(all), []);
  assert.deepEqual(lazyFetchJobs(all), []);
});

test("another action's `filter` input is not a checkout and is not judged", () => {
  const paths = { uses: "dorny/paths-filter@de90cc6fb38fc0963ad72b210f1f284cd68cea36", with: { filter: "blob:none" } };
  assert.deepEqual(lazyFetchFindings(fixture({ suite: job(checkout(), paths, reads) })), []);
});

test("a blob-free job reached only through a call is judged", () => {
  const lane = { file: "ci.lane.yaml", doc: { on: { workflow_call: null }, jobs: { changes: job(checkout("blob:none"), reads) } } };
  const findings = lazyFetchFindings(fixture({ lane: { uses: "./.github/workflows/ci.lane.yaml" } }, [lane]));
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /^ci\.lane\.yaml changes /);
});

test("a workflow the queue does not wait on is not judged", () => {
  const release = { file: "release.yaml", doc: { on: { push: { branches: ["main"] } }, jobs: { publish: job(checkout("blob:none"), reads) } } };
  assert.deepEqual(lazyFetchFindings(fixture({ suite: job(checkout(), reads) }, [release])), []);
});

test("a call that cannot be followed is left to scripts/ci-timeouts.mjs, not reported twice", () => {
  assert.deepEqual(lazyFetchFindings(fixture({ lane: { uses: "./.github/workflows/ci.gone.yaml" } })), []);
});
