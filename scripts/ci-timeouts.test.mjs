// Tests for scripts/ci-timeouts.mjs: every job the merge queue waits on caps its own run time.
// Run via `node --test scripts/ci-timeouts.test.mjs` (wired into root `npm test`).
//
// What these guard: a job with no `timeout-minutes` runs under GitHub's
// six-hour default, so one hung step holds a pull request's `Gate` and a
// runner for hours and a merge-queue entry until the queue ejects it. The
// real workflows are read as they are, and fixtures pin each way the rule
// can drift: a job with no cap, a cap of zero, one above the ceiling, an
// expression, an uncapped job reached only through a nested call, a caller
// job (which cannot carry a cap and is not judged), a workflow outside the
// queue's set (not judged), a call to a workflow that does not exist, and a
// call to another repository's workflow. The set itself is pinned as not
// vacuous: it holds the three required checks' workflows and every lane
// ci.gate.yaml calls.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { MAX_TIMEOUT_MINUTES, queueWorkflows, timeoutFindings } from "./ci-timeouts.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(root, ".github/workflows");
const workflows = readdirSync(workflowsDir)
  .filter((file) => file.endsWith(".yaml") || file.endsWith(".yml"))
  .map((file) => ({ file, doc: parse(readFileSync(join(workflowsDir, file), "utf8")) }));

const capped = (minutes = 10) => ({ "runs-on": "ubuntu-latest", "timeout-minutes": minutes, steps: [{ run: "true" }] });
const uncapped = () => ({ "runs-on": "ubuntu-latest", steps: [{ run: "true" }] });

/** A queue root (`on: merge_group`) with the given jobs, plus any further workflows. */
function fixture(jobs, others = []) {
  return [{ file: "ci.root.yaml", doc: { on: { merge_group: null }, jobs } }, ...others];
}

test("every job the merge queue waits on carries a cap within the ceiling", () => {
  assert.deepEqual(timeoutFindings(workflows), []);
});

test("the queue's set holds the required checks and every lane ci.gate.yaml calls, so the check above is not vacuous", () => {
  const { reached } = queueWorkflows(workflows);
  for (const file of ["ci.gate.yaml", "ci.integrity.yaml", "ci.review.yaml"]) assert.ok(reached.includes(file), file);
  const gate = workflows.find(({ file }) => file === "ci.gate.yaml").doc;
  const lanes = Object.values(gate.jobs)
    .map((job) => /^\.\/\.github\/workflows\/(.+)$/.exec(String(job.uses ?? ""))?.[1])
    .filter(Boolean);
  assert.ok(lanes.length > 0, "ci.gate.yaml calls no lane; the set would be its own jobs alone");
  for (const lane of lanes) assert.ok(reached.includes(lane), lane);
});

test("a capped job within the ceiling passes, at both ends of the range", () => {
  assert.deepEqual(timeoutFindings(fixture({ low: capped(1), high: capped(MAX_TIMEOUT_MINUTES) })), []);
});

test("a job with no cap is refused, named, with where to read how to size one", () => {
  const [finding] = timeoutFindings(fixture({ suite: uncapped() }));
  assert.match(finding, /^ci\.root\.yaml suite sets no `timeout-minutes`: .*six-hour default.*scripts\/ci-timeouts\.mjs's header/);
});

test("a cap of zero, one above the ceiling, a fraction or a string is refused", () => {
  for (const cap of [0, MAX_TIMEOUT_MINUTES + 1, 360, 2.5, "10"]) {
    const [finding] = timeoutFindings(fixture({ suite: capped(cap) }));
    assert.match(finding, new RegExp(`^ci\\.root\\.yaml suite: \`timeout-minutes: ${cap}\` is not a whole number of minutes from 1 to ${MAX_TIMEOUT_MINUTES}`), String(cap));
  }
});

test("a cap that is an expression is refused: its value cannot be judged from the file", () => {
  const [finding] = timeoutFindings(fixture({ suite: capped("${{ inputs.minutes }}") }));
  assert.match(finding, /`timeout-minutes: \$\{\{ inputs\.minutes \}\}` is not a whole number/);
});

test("an uncapped job reached only through a nested call is refused", () => {
  const lane = { file: "ci.lane.yaml", doc: { on: { workflow_call: null }, jobs: { inner: { uses: "./.github/workflows/ci.leaf.yaml" } } } };
  const leaf = { file: "ci.leaf.yaml", doc: { on: { workflow_call: null }, jobs: { deep: uncapped() } } };
  const all = fixture({ lane: { uses: "./.github/workflows/ci.lane.yaml" } }, [lane, leaf]);
  assert.deepEqual(queueWorkflows(all).reached, ["ci.lane.yaml", "ci.leaf.yaml", "ci.root.yaml"]);
  const findings = timeoutFindings(all);
  assert.equal(findings.length, 1, findings.join("\n"));
  assert.match(findings[0], /^ci\.leaf\.yaml deep sets no `timeout-minutes`/);
});

test("a job that calls a workflow is not judged itself: GitHub refuses a cap there, and its callee is judged", () => {
  const lane = { file: "ci.lane.yaml", doc: { on: { workflow_call: null }, jobs: { work: capped() } } };
  assert.deepEqual(timeoutFindings(fixture({ caller: { uses: "./.github/workflows/ci.lane.yaml" } }, [lane])), []);
});

test("a workflow the queue does not wait on is not judged, in any shape of `on:`", () => {
  const others = [
    { file: "release.yaml", doc: { on: { push: { branches: ["main"] } }, jobs: { publish: uncapped() } } },
    { file: "nightly.yaml", doc: { on: "schedule", jobs: { sweep: uncapped() } } },
    { file: "pr-only.yaml", doc: { on: ["pull_request", "workflow_dispatch"], jobs: { lint: uncapped() } } },
  ];
  assert.deepEqual(timeoutFindings(fixture({ suite: capped() }, others)), []);
  const listed = [{ file: "ci.list.yaml", doc: { on: ["pull_request", "merge_group"], jobs: { suite: uncapped() } } }];
  assert.match(timeoutFindings(listed).join("\n"), /ci\.list\.yaml suite sets no `timeout-minutes`/, "a root whose `on:` is a list is still a root");
});

test("a call to a local workflow that does not exist is refused, not skipped", () => {
  const [finding] = timeoutFindings(fixture({ lane: { uses: "./.github/workflows/ci.gone.yaml" } }));
  assert.match(finding, /^ci\.root\.yaml lane calls `\.\/\.github\/workflows\/ci\.gone\.yaml`, which is not a workflow in \.github\/workflows/);
});

test("a call to another repository's workflow is refused: its jobs' caps cannot be judged here", () => {
  const [finding] = timeoutFindings(fixture({ lane: { uses: "octo-org/shared/.github/workflows/ci.yaml@0123456789abcdef0123456789abcdef01234567" } }));
  assert.match(finding, /^ci\.root\.yaml lane calls `octo-org\/shared\/.*`, a workflow outside this repository/);
});

test("a workflow called from two places is judged once", () => {
  const lane = { file: "ci.lane.yaml", doc: { on: { workflow_call: null }, jobs: { work: uncapped() } } };
  const all = fixture({ a: { uses: "./.github/workflows/ci.lane.yaml" }, b: { uses: "./.github/workflows/ci.lane.yaml" } }, [lane]);
  assert.equal(timeoutFindings(all).length, 1);
});
