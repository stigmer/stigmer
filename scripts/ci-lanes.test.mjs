// Tests for scripts/ci-lanes.mjs: which lanes a change needs, the gate's
// verdict, and the shape that ties the map, ci.gate.yaml and the lanes into
// one required check.
// Run via `node --test scripts/ci-lanes.test.mjs` (wired into root `npm test`).
//
// What these guard: the selection (a path in a lane's list selects it, the
// gate's own files and a dispatch select every lane, no base selects every
// lane), the verdict (a needed lane that did not pass, a lane that ran
// without being needed, a selection that gave no answer: each is red), and
// the structure, read from the workflow files as they are. A lane that left
// the gate, a gate job whose condition drifted from the map, a lane that
// kept its own trigger or concurrency, or a lane without the gate's test
// variable would each make `Gate` green over work it never judged; each is a
// failure here. The per-path link rule is scripts/lane-triggers.test.mjs's.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { EVERY_LANE, LANES, laneId, selectLanes, verdict } from "./ci-lanes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(root, ".github/workflows");
const readWorkflow = (file) => parse(readFileSync(join(workflowsDir, file), "utf8"));
const IDS = Object.keys(LANES).map(laneId);

const selected = (changedFiles, event = "pull_request") =>
  Object.entries(selectLanes({ event, changedFiles }).lanes)
    .filter(([, run]) => run)
    .map(([id]) => id);

/** A `needs` context as ci.gate.yaml's `Gate` job sees it. */
function needsFor(chosen, resultOf = () => undefined) {
  const outputs = Object.fromEntries(IDS.map((id) => [id, String(chosen.includes(id))]));
  const needs = { lanes: { result: "success", outputs } };
  for (const id of IDS) {
    needs[id] = { result: resultOf(id) ?? (chosen.includes(id) ? "success" : "skipped"), outputs: {} };
  }
  return needs;
}

test("laneId is the workflow file without `ci.` and the extension", () => {
  assert.equal(laneId("ci.runner.yaml"), "runner");
  assert.equal(laneId("ci.e2e-interactive.yaml"), "e2e-interactive");
});

test("a path in a lane's list selects that lane; the always lane runs for every change", () => {
  assert.deepEqual(selected(["backend/services/runner/src/x.ts"]), [
    "conformance",
    "conformance-execution",
    "e2e-interactive",
    "runner",
    "ts-workspace",
  ]);
  assert.deepEqual(selected(["docs/guides/x.mdx"]), ["docs", "ts-workspace"]);
  assert.deepEqual(selected([]), ["ts-workspace"], "an empty diff still runs the lane that decides inside");
});

test("a lane's own workflow file runs that lane, and the workflow audit", () => {
  // ci.workflows.yaml audits every file under .github, so it runs beside the lane.
  assert.deepEqual(selected([".github/workflows/ci.crate.yaml"]), ["crate", "ts-workspace", "workflows"]);
});

test("any file under .github runs the workflow audit, and only it", () => {
  for (const file of [".github/dependabot.yml", ".github/zizmor.yml", ".github/workflows/ci.codeql.yaml"]) {
    assert.deepEqual(selected([file]), ["ts-workspace", "workflows"], file);
  }
});

test("the gate's own files, a dispatch and a missing base run every lane", () => {
  for (const file of [".github/workflows/ci.gate.yaml", "scripts/ci-lanes.mjs", ".github/actions/turbo-cache/action.yml"]) {
    const { lanes, every } = selectLanes({ event: "pull_request", changedFiles: [file] });
    assert.deepEqual(Object.values(lanes).filter((run) => !run), [], file);
    assert.match(every, /the gate itself changed/, file);
  }
  assert.match(selectLanes({ event: "workflow_dispatch", changedFiles: [] }).every, /manual run/);
  assert.match(selectLanes({ event: "merge_group", changedFiles: null }).every, /no base/);
  assert.deepEqual(EVERY_LANE, [".github/workflows/ci.gate.yaml", "scripts/ci-lanes.mjs", ".github/actions/**"]);
});

test("the verdict passes only when every needed lane passed and every other lane was skipped", () => {
  const green = verdict(needsFor(["runner", "ts-workspace"]));
  assert.equal(green.ok, true);
  assert.equal(green.lines.length, IDS.length + 1);

  const red = verdict(needsFor(["runner", "ts-workspace"], (id) => (id === "runner" ? "failure" : undefined)));
  assert.equal(red.ok, false);
  assert.deepEqual(red.lines.filter((l) => l.startsWith("FAIL")), ["FAIL runner: needed, and failure"]);

  const cancelled = verdict(needsFor(["runner"], (id) => (id === "runner" ? "cancelled" : undefined)));
  assert.equal(cancelled.ok, false, "a cancelled lane is not a pass");

  const stray = verdict(needsFor(["runner"], (id) => (id === "docs" ? "success" : undefined)));
  assert.deepEqual(stray.lines.filter((l) => l.startsWith("FAIL")), ["FAIL docs: not needed, yet success"]);
});

test("the verdict is red when the selection failed or gave no answer for a lane", () => {
  const failed = needsFor(["runner"]);
  failed.lanes.result = "failure";
  assert.equal(verdict(failed).ok, false);
  assert.equal(verdict({}).ok, false, "no selection at all");

  const silent = needsFor(["runner"]);
  delete silent.lanes.outputs.docs;
  assert.deepEqual(
    verdict(silent).lines.filter((l) => l.startsWith("FAIL")),
    ['FAIL docs: the selection gave no answer (undefined)'],
    "a lane the selection forgot is not a lane that was not needed",
  );

  const missing = needsFor(["runner"]);
  delete missing.crate;
  assert.deepEqual(verdict(missing).lines.filter((l) => l.startsWith("FAIL")), ["FAIL crate: not among Gate's needs"]);
});

// ─── The shape, read from the workflow files ────────────────────────────

const gate = readWorkflow("ci.gate.yaml");
const laneJobs = Object.entries(gate.jobs).filter(([, job]) => job.uses);

test("the map, ci.gate.yaml's lane jobs and the callable workflows are one set", () => {
  const called = readdirSync(workflowsDir)
    .filter((file) => /\.ya?ml$/.test(file) && file !== "notify-failure.yaml")
    .filter((file) => readWorkflow(file).on?.workflow_call !== undefined)
    .sort();
  assert.deepEqual(called, Object.keys(LANES).sort());
  assert.deepEqual(
    laneJobs.map(([id, job]) => `${id} ${job.uses}`).sort(),
    Object.keys(LANES).map((file) => `${laneId(file)} ./.github/workflows/${file}`).sort(),
  );
});

test("each lane job runs exactly when the selection says so, and Gate needs them all", () => {
  for (const [id, job] of laneJobs) {
    assert.equal(job.if, `needs.lanes.outputs.${id} == 'true'`, id);
    assert.equal(job.needs, "lanes", id);
    assert.equal(gate.jobs.lanes.outputs[id], `\${{ steps.select.outputs.${id} }}`, id);
  }
  const judge = gate.jobs.gate;
  assert.equal(judge.name, "Gate", "the ruleset requires this exact name");
  assert.equal(judge.if, "always()", "a skipped required check passes, so Gate must never be skippable");
  assert.deepEqual([...judge.needs].sort(), ["lanes", ...IDS].sort());
  assert.match(judge.steps.at(-1).run, /ci-lanes\.mjs verdict/);
  assert.equal(judge.steps.at(-1).env.GATE_NEEDS, "${{ toJSON(needs) }}");
});

test("the lanes run only through the gate, and each sets the gate's test variable itself", () => {
  for (const file of Object.keys(LANES)) {
    const lane = readWorkflow(file);
    for (const event of ["pull_request", "push", "merge_group"]) {
      assert.equal(lane.on?.[event], undefined, `${file} must not trigger on ${event}: the gate calls it`);
    }
    assert.equal(lane.concurrency, undefined, `${file}: a called lane shares the caller's context; ci.gate.yaml owns concurrency`);
    assert.equal(lane.env?.STIGMER_TEST_GATE, "1", `${file}: a caller's env does not reach a called workflow`);
  }
});

test("every required check runs on pull requests and in the merge queue, and none can be skipped", () => {
  for (const event of ["pull_request", "merge_group"]) {
    assert.ok(event in gate.on, `ci.gate.yaml on ${event}`);
  }
  // Both body-reading checks re-run on `edited`: a declaration added to the
  // body changes what Test integrity accepts and what a review verdict binds.
  for (const [file, name] of [["ci.integrity.yaml", "Test integrity"], ["ci.review.yaml", "Review verdict"]]) {
    const workflow = readWorkflow(file);
    assert.deepEqual([...workflow.on.pull_request.types].sort(), ["edited", "opened", "reopened", "synchronize"], file);
    assert.ok("merge_group" in workflow.on, `${file} on merge_group`);
    const job = Object.values(workflow.jobs).find((j) => j.name === name);
    assert.ok(job, `the ruleset requires a job named \`${name}\``);
    assert.equal(job.if, undefined, `${name}: a skipped required check passes`);
  }
});

test("a pull request is judged by the base branch's copy of each body-reading check's script", () => {
  // A pull request that edits the script its check runs must not loosen that
  // check for itself, so neither job runs the pull request's own copy.
  const reviewJob = readWorkflow("ci.review.yaml").jobs.review;
  const reviewCheckout = reviewJob.steps.find((step) => step.uses?.startsWith("actions/checkout@"));
  assert.equal(
    reviewCheckout.with.ref,
    "${{ github.base_ref || github.sha }}",
    "Review verdict checks out the base branch's tip: a recorded base commit can predate the script `--write` used",
  );
  for (const step of reviewJob.steps.filter((s) => s.run)) {
    assert.doesNotMatch(step.run, /git (checkout|fetch|switch|restore)\b/, `${step.name}: no step brings the pull request's own files into the base checkout`);
  }
  assert.ok(
    reviewJob.steps.some((s) => s.run?.includes("node scripts/review-verdict.mjs --status")),
    "Review verdict runs the checked-out base's script",
  );

  const integritySteps = readWorkflow("ci.integrity.yaml").jobs.integrity.steps;
  const pullRequestStep = integritySteps.find((s) => s.if === "github.event_name == 'pull_request'");
  assert.match(pullRequestStep.run, /git show "origin\/\$BASE_REF:scripts\/test-integrity\.mjs" > "\$RUNNER_TEMP\/test-integrity\.mjs"/);
  const parserStep = integritySteps.find((s) => s.name === "Install the TypeScript parser");
  assert.match(parserStep.run, /git show "origin\/\$BASE_REF:package-lock\.json"/, "the parser that judges a pull request is the one the base pins");
  const invoked = [...pullRequestStep.run.matchAll(/\bnode\s+(\S+)/g)].map((m) => m[1]);
  assert.deepEqual(invoked, ['"$RUNNER_TEMP/test-integrity.mjs"'], "Test integrity judges a pull request with the base's copy, and runs nothing else");
});
