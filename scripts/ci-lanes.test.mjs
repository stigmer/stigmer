// Tests for scripts/ci-lanes.mjs: which lanes a change needs, the gate's
// verdict, and the shape that ties the map, ci.gate.yaml and the lanes into
// one required check.
// Run via `node --test scripts/ci-lanes.test.mjs` (wired into root `npm test`).
//
// What these guard: the selection (a path in a lane's list selects it, the
// gate's own files and a dispatch select every lane, no base selects every
// lane, the coverage floors select every lane that measures), the verdict (a needed lane that did not pass, a lane that ran
// without being needed, a selection that gave no answer, a coverage job that
// did not pass: each is red), the merge-queue reuse (a queue entry repeats a
// passed pull-request run only when the queue's base is in the head, the
// trees match and the head's newest `Gate` passed; anything unread or
// otherwise runs the lanes, as do a retargeted pull request and a `Gate`
// check from another workflow; the reads map GitHub's answers and turn a
// failed or unparsable one into null; a reused verdict passes only when every
// lane and coverage skipped), and
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

import {
  COVERAGE_LANES,
  EVERY_LANE,
  GATE_CHECK,
  GATE_JOBS,
  GATE_WORKFLOW,
  LANES,
  laneId,
  queueFacts,
  queueRef,
  queueReuse,
  RETARGET_EVENTS,
  selectionSummary,
  selectLanes,
  verdict,
} from "./ci-lanes.mjs";
import { COVERAGE_FLOORS } from "./turbo-affected.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(root, ".github/workflows");
const readWorkflow = (file) => parse(readFileSync(join(workflowsDir, file), "utf8"));
const IDS = Object.keys(LANES).map(laneId);

const selected = (changedFiles, event = "pull_request") =>
  Object.entries(selectLanes({ event, changedFiles }).lanes)
    .filter(([, run]) => run)
    .map(([id]) => id);

/** A `needs` context as ci.gate.yaml's `Gate` job sees it; `reused` is the selection's `reused` output. */
function needsFor(chosen, resultOf = () => undefined, reused = "") {
  const outputs = { ...Object.fromEntries(IDS.map((id) => [id, String(chosen.includes(id))])), reused };
  const needs = { lanes: { result: "success", outputs } };
  for (const id of IDS) {
    needs[id] = { result: resultOf(id) ?? (chosen.includes(id) ? "success" : "skipped"), outputs: {} };
  }
  for (const id of GATE_JOBS) needs[id] = { result: resultOf(id) ?? "success", outputs: {} };
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

test("the runner's model path runs every install journey beside the runner's own lanes", () => {
  const installs = ["all-in-one", "cli-up", "compose-stack", "conformance", "conformance-execution", "e2e-interactive", "helm-chart", "runner", "ts-workspace"];
  assert.deepEqual(selected(["backend/services/runner/src/shared/model-client.ts"]), installs);
  assert.deepEqual(selected(["backend/services/runner/src/shared/llm-backend.ts"]), installs);
  assert.deepEqual(selected(["backend/services/runner/src/shared/llm-proxy.ts"]), installs);
});

test("a store migration runs the upgrade rehearsal; a CLI command runs `stigmer up`", () => {
  assert.deepEqual(selected(["backend/services/stigmer-server/src/store/sqlite/migrations.ts"]), [
    "conformance",
    "conformance-execution",
    "e2e-interactive",
    "stigmer-server",
    "ts-workspace",
    "upgrade-rehearsal",
  ]);
  assert.deepEqual(selected(["client-apps/cli/src/commands/run.ts"]), ["cli-up", "docs", "ts-workspace"]);
  // An image's user and data paths decide whether the last release's volume is still readable.
  assert.ok(selected(["backend/services/stigmer-server/Dockerfile"]).includes("upgrade-rehearsal"));
  assert.ok(selected(["backend/services/runner/Dockerfile.sandbox"]).includes("upgrade-rehearsal"));
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

test("a change to the coverage floors selects every lane that measures a package, and says so; nothing else does", () => {
  const always = Object.entries(LANES).filter(([, lane]) => lane.always).map(([file]) => laneId(file));
  const expected = [...new Set([...always, ...COVERAGE_LANES.map(laneId)])].sort();
  const { lanes, every, measure } = selectLanes({ event: "pull_request", changedFiles: [COVERAGE_FLOORS] });
  assert.deepEqual(Object.entries(lanes).filter(([, run]) => run).map(([id]) => id).sort(), expected);
  assert.equal(every, null);
  assert.match(measure, /the coverage floors changed \(test\/coverage-floors\.json\): every lane that measures a package runs/);
  assert.equal(selectLanes({ event: "pull_request", changedFiles: ["test/README.md"] }).measure, null);
  assert.equal(selectLanes({ event: "merge_group", changedFiles: null }).measure, null);
  for (const file of COVERAGE_LANES) assert.ok(LANES[file], `${file} is a lane`);
});

test("the selection's summary names the lanes and why every coverage lane ran; every lane's reason stands alone", () => {
  const range = { base: "origin/main", head: "HEAD", source: "pull_request base branch" };
  const floors = selectLanes({ event: "pull_request", changedFiles: [COVERAGE_FLOORS] });
  const text = selectionSummary({ range, changedFiles: [COVERAGE_FLOORS], ...floors });
  assert.match(text, /^### Lanes this change needs\n\nBase `origin\/main` \(pull_request base branch\), head `HEAD`, 1 changed file\(s\)\.\n\n7 lane\(s\): /);
  assert.match(text, /\n\n\*\*Every coverage lane\*\*: the coverage floors changed \(test\/coverage-floors\.json\): every lane that measures a package runs, so each moved floor is judged\.$/);
  const plain = selectLanes({ event: "pull_request", changedFiles: ["test/README.md"] });
  assert.doesNotMatch(selectionSummary({ range, changedFiles: ["test/README.md"], ...plain }), /Every coverage lane/);
  const every = selectLanes({ event: "pull_request", changedFiles: [COVERAGE_FLOORS, "scripts/ci-lanes.mjs"] });
  const all = selectionSummary({ range, changedFiles: [COVERAGE_FLOORS, "scripts/ci-lanes.mjs"], ...every });
  assert.match(all, /\*\*Every lane\*\*: the gate itself changed: scripts\/ci-lanes\.mjs\.$/);
  assert.doesNotMatch(all, /Every coverage lane/, "every lane already says it all");
});

test("the verdict passes only when every needed lane passed and every other lane was skipped", () => {
  const green = verdict(needsFor(["runner", "ts-workspace"]));
  assert.equal(green.ok, true);
  assert.equal(green.lines.length, IDS.length + GATE_JOBS.length + 1);
  assert.ok(green.lines.includes("ok   coverage: passed"));

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

test("the verdict is red unless the coverage job passed, whichever lanes ran, unless the run is reused", () => {
  for (const result of ["failure", "cancelled", "skipped"]) {
    const judged = verdict(needsFor(["runner"], (id) => (id === "coverage" ? result : undefined)));
    assert.equal(judged.ok, false, result);
    assert.deepEqual(judged.lines.filter((l) => l.startsWith("FAIL")), [`FAIL coverage: ${result}`]);
  }
  const absent = needsFor([]);
  delete absent.coverage;
  assert.deepEqual(verdict(absent).lines.filter((l) => l.startsWith("FAIL")), ["FAIL coverage: not among Gate's needs"]);
  assert.equal(verdict(needsFor([])).ok, true, "a change no lane judged still needs coverage, and it passed");
});

// ─── The merge-queue reuse ──────────────────────────────────────────────

const RUN = "https://github.com/stigmer/stigmer/actions/runs/1/job/2";
const TREE = "a".repeat(40);
const SUITE = 100222223371;
const passed = { app: "github-actions", suite: SUITE, status: "completed", conclusion: "success", startedAt: "2026-10-02T10:00:00Z", url: RUN };
const OPENED = "2026-10-01T08:00:00Z";
const ourRun = { path: ".github/workflows/ci.gate.yaml", suite: SUITE, createdAt: "2026-10-02T09:59:00Z", pullRequests: [{ number: 1695, base: "main" }] };
const repeat = { pull: 1695, base: "main", pullCreatedAt: OPENED, groupTree: TREE, headTree: TREE, compareStatus: "ahead", retargeted: false, gateRuns: [ourRun], checkRuns: [passed] };

test("the queue ref names its pull request and base branch, and nothing else does", () => {
  const sha = "f5079c1738b510e92150fadd2881fcaa04e7ec16";
  assert.deepEqual(queueRef(`gh-readonly-queue/main/pr-1696-${sha}`), { pull: 1696, base: "main" });
  assert.deepEqual(queueRef(`refs/heads/gh-readonly-queue/main/pr-1696-${sha}`), { pull: 1696, base: "main" });
  assert.deepEqual(queueRef(`gh-readonly-queue/release/v3/pr-12-${sha}`), { pull: 12, base: "release/v3" });
  for (const ref of [undefined, null, "", "main", `gh-readonly-queue/main/pr-x-${sha}`, "gh-readonly-queue/main/pr-1696-abc", `feature/pr-1696-${sha}`]) {
    assert.equal(queueRef(ref), null, String(ref));
  }
});

test("a queue entry reuses its pull request's run only when the base is in the head, the trees match, the base never moved and this gate's newest Gate passed", () => {
  assert.equal(GATE_CHECK, "Gate", "the ruleset's required check");
  assert.equal(GATE_WORKFLOW, ".github/workflows/ci.gate.yaml");
  const reused = queueReuse(repeat);
  assert.equal(reused.reused, RUN);
  assert.match(reused.reason, /tree is the pull request head's, which contains the queue's base; the pull request was never retargeted; and the newest `Gate` of \.github\/workflows\/ci\.gate\.yaml's runs for it against the queue's base passed/);
  assert.equal(queueReuse({ ...repeat, compareStatus: "identical" }).reused, RUN, "a head that is the base itself");
});

test("an entry behind another, a moved head, a red or unfinished Gate, or anything unread runs the lanes", () => {
  const cases = [
    [{ compareStatus: "diverged" }, /does not contain the queue's base \(compare: diverged\)/],
    [{ compareStatus: "behind" }, /does not contain the queue's base/],
    [{ groupTree: "b".repeat(40) }, /tree bbbbbbbbbbbb is not the pull request head's aaaaaaaaaaaa/],
    [{ checkRuns: [] }, /has no `Gate` from/],
    [{ checkRuns: [{ ...passed, conclusion: "failure" }] }, /newest `Gate` is failure/],
    [{ checkRuns: [{ ...passed, status: "in_progress", conclusion: null }] }, /newest `Gate` is in_progress/],
    [{ checkRuns: [passed, { ...passed, conclusion: "failure", startedAt: "2026-10-02T11:00:00Z" }] }, /newest `Gate` is failure/],
    [{ checkRuns: [passed, { ...passed, status: "queued", conclusion: null, startedAt: null }] }, /newest `Gate` is queued/],
    [{ checkRuns: [{ ...passed, app: "someone-else" }] }, /has no `Gate` from \.github\/workflows\/ci\.gate\.yaml's runs for this pull request against the queue's base/],
    [{ checkRuns: [{ ...passed, suite: 7 }] }, /has no `Gate` from/],
    [{ checkRuns: [{ ...passed, conclusion: "failure" }, { ...passed, suite: 7, startedAt: "2026-10-02T12:00:00Z" }] }, /newest `Gate` is failure/],
    [{ retargeted: true }, /base was changed, so a run before that merged onto another base/],
    [{ retargeted: null }, /base changes could not be read/],
    [{ gateRuns: null }, /`Gate` runs could not be read/],
    [{ gateRuns: [{ ...ourRun, path: ".github/workflows/other.yaml" }] }, /has no `Gate` from/],
    [{ gateRuns: [{ ...ourRun, pullRequests: [] }] }, /has no `Gate` from/],
    [{ gateRuns: [{ ...ourRun, pullRequests: [{ number: 1700, base: "main" }] }] }, /has no `Gate` from/],
    [{ gateRuns: [{ ...ourRun, pullRequests: [{ number: 1695, base: "main" }, { number: 1701, base: "release" }] }] }, /has no `Gate` from/],
    [{ gateRuns: [{ ...ourRun, pullRequests: [{ number: 1695, base: "release" }] }] }, /has no `Gate` from/],
    [{ gateRuns: [{ ...ourRun, createdAt: "2026-10-01T07:59:59Z" }] }, /has no `Gate` from/],
    [{ pullCreatedAt: null }, /has no `Gate` from/],
    [{ compareStatus: null }, /could not be compared/],
    [{ groupTree: null }, /a tree could not be read/],
    [{ headTree: null }, /a tree could not be read/],
    [{ checkRuns: null }, /`Gate` runs could not be read/],
  ];
  for (const [change, reason] of cases) {
    const verdictOf = queueReuse({ ...repeat, ...change });
    assert.equal(verdictOf.reused, null, JSON.stringify(change));
    assert.match(verdictOf.reason, reason, JSON.stringify(change));
  }
  const olderRed = queueReuse({ ...repeat, checkRuns: [{ ...passed, conclusion: "failure", startedAt: "2026-10-02T09:00:00Z" }, passed] });
  assert.equal(olderRed.reused, RUN, "the newest run decides, as a rerun's green does");
});

test("a run GitHub lists for this pull request and others against the same base still counts; one that also lists another base does not", () => {
  const shared = { ...ourRun, pullRequests: [{ number: 1695, base: "main" }, { number: 1702, base: "main" }] };
  assert.equal(queueReuse({ ...repeat, gateRuns: [shared] }).reused, RUN, "every listed pull request merges onto main, so the run's merge ref was the head's tree");
  const mixed = { ...ourRun, pullRequests: [{ number: 1702, base: "release" }, { number: 1695, base: "main" }] };
  assert.equal(queueReuse({ ...repeat, gateRuns: [mixed] }).reused, null, "the run may have been the other pull request's, merged onto another base");
});

test("a run started before this pull request was opened is never reused: GitHub drops a closed pull request from a run's list", () => {
  const before = { ...ourRun, createdAt: "2026-09-30T12:00:00Z" };
  assert.equal(queueReuse({ ...repeat, gateRuns: [before] }).reused, null, "a stacked pull request against another base, closed and reopened against main with no push, left this run");
  assert.equal(queueReuse({ ...repeat, gateRuns: [{ ...ourRun, createdAt: OPENED }] }).reused, RUN, "a run started the moment it was opened is its own");
});

test("a Gate job of another workflow on the head, newer and green, is never the run reused", () => {
  const impostor = { ...passed, suite: 7, startedAt: "2026-10-02T12:00:00Z", url: "https://example.invalid/impostor" };
  assert.equal(queueReuse({ ...repeat, checkRuns: [passed, impostor] }).reused, RUN);
  assert.equal(queueReuse({ ...repeat, checkRuns: [impostor] }).reused, null);
});

/** A fake `gh api` answering each call by its first argument's path, or throwing for an unknown one. */
function fakeGh(answers) {
  const calls = [];
  const gh = (args) => {
    calls.push(args);
    const path = args[0].split("?")[0];
    const answer = answers[path];
    if (answer === undefined || answer instanceof Error) throw answer ?? new Error(`no answer for ${path}`);
    return answer;
  };
  return { gh, calls };
}

const HEAD = "4845fb4a6f746ff16cdc27cad8c82e9abb20475c";
const BASE = "aeb33121c" + "0".repeat(31);
const GROUP = { head_ref: `refs/heads/gh-readonly-queue/main/pr-1695-${BASE}`, base_sha: BASE, head_sha: "c".repeat(40) };
const ENV = { GITHUB_REPOSITORY: "stigmer/stigmer" };
const ANSWERS = {
  "repos/stigmer/stigmer/pulls/1695": `${HEAD} ${OPENED}`,
  [`repos/stigmer/stigmer/git/commits/${"c".repeat(40)}`]: TREE,
  [`repos/stigmer/stigmer/git/commits/${HEAD}`]: TREE,
  [`repos/stigmer/stigmer/compare/${BASE}...${HEAD}`]: "ahead",
  "repos/stigmer/stigmer/issues/1695/timeline": "0\n0",
  "repos/stigmer/stigmer/actions/runs": JSON.stringify([ourRun]),
  [`repos/stigmer/stigmer/commits/${HEAD}/check-runs`]: JSON.stringify([passed]),
};

const quiet = () => {};

test("the reads ask GitHub for each fact and hand the rule exactly what it judges", () => {
  const { gh, calls } = fakeGh(ANSWERS);
  const facts = queueFacts(ENV, GROUP, gh, quiet);
  assert.deepEqual(facts, repeat);
  assert.equal(queueReuse(facts).reused, RUN);
  const byPath = Object.fromEntries(calls.map((args) => [args[0].split("?")[0], args]));
  assert.match(byPath["repos/stigmer/stigmer/actions/runs"][0], new RegExp(`head_sha=${HEAD}&event=pull_request`));
  assert.equal(
    byPath["repos/stigmer/stigmer/actions/runs"].at(-1),
    "[.workflow_runs[] | {path, suite: .check_suite_id, createdAt: .created_at, pullRequests: [.pull_requests[] | {number, base: .base.ref}]}]",
    "every run comes back with its path and the pull requests GitHub lists for it; the rule, not the query, decides which count",
  );
  assert.deepEqual(RETARGET_EVENTS, ["base_ref_changed", "automatic_base_change_succeeded"], "GitHub's own retarget after a base branch is deleted records only the second");
  assert.equal(byPath["repos/stigmer/stigmer/issues/1695/timeline"].at(-1), '[.[] | select(.event | IN("base_ref_changed", "automatic_base_change_succeeded"))] | length');
  assert.match(byPath[`repos/stigmer/stigmer/commits/${HEAD}/check-runs`][0], /check_name=Gate/);
  assert.match(byPath[`repos/stigmer/stigmer/commits/${HEAD}/check-runs`].at(-1), /suite: \.check_suite\.id/);
  assert.ok(byPath["repos/stigmer/stigmer/issues/1695/timeline"].includes("--paginate"), "a long timeline is read whole");
});

test("a failed or unparsable read leaves its fact null, and a missing pull request leaves every fact null", () => {
  const nulls = { pull: 1695, base: "main", pullCreatedAt: null, groupTree: null, headTree: null, compareStatus: null, retargeted: null, gateRuns: null, checkRuns: null };
  for (const [path, answer, field] of [
    [`repos/stigmer/stigmer/compare/${BASE}...${HEAD}`, new Error("HTTP 404"), "compareStatus"],
    ["repos/stigmer/stigmer/issues/1695/timeline", new Error("HTTP 403"), "retargeted"],
    ["repos/stigmer/stigmer/actions/runs", "not json", "gateRuns"],
    ["repos/stigmer/stigmer/actions/runs", "{}", "gateRuns"],
    ["repos/stigmer/stigmer/issues/1695/timeline", "", "retargeted"],
    ["repos/stigmer/stigmer/issues/1695/timeline", "null", "retargeted"],
    [`repos/stigmer/stigmer/commits/${HEAD}/check-runs`, new Error("HTTP 403"), "checkRuns"],
    [`repos/stigmer/stigmer/git/commits/${HEAD}`, "", "headTree"],
    [`repos/stigmer/stigmer/compare/${BASE}...${HEAD}`, "", "compareStatus"],
  ]) {
    const warnings = [];
    const facts = queueFacts(ENV, GROUP, fakeGh({ ...ANSWERS, [path]: answer }).gh, (line) => warnings.push(line));
    assert.equal(facts[field], null, `${path} -> ${field}`);
    assert.equal(queueReuse(facts).reused, null, `${path}: an unread fact never reuses`);
    assert.equal(warnings.length, 1, `${path}: a failed read says why`);
    assert.ok(warnings[0].startsWith(`ci-lanes: queue reuse could not read ${path}`), warnings[0]);
  }
  const denied = Object.assign(new Error("Command failed: gh api"), { stderr: "gh: Resource not accessible by integration (HTTP 403)\n" });
  const warnings = [];
  queueFacts(ENV, GROUP, fakeGh({ ...ANSWERS, "repos/stigmer/stigmer/actions/runs": denied }).gh, (line) => warnings.push(line));
  assert.deepEqual(warnings, ["ci-lanes: queue reuse could not read repos/stigmer/stigmer/actions/runs?head_sha=" + HEAD + "&event=pull_request&per_page=100: gh: Resource not accessible by integration (HTTP 403)"], "the warning carries gh's own first line");
  assert.deepEqual(queueFacts(ENV, GROUP, fakeGh({ ...ANSWERS, "repos/stigmer/stigmer/pulls/1695": new Error("HTTP 404") }).gh, quiet), nulls);
  for (const answer of ["", HEAD, `${HEAD} yesterday`, `abc ${OPENED}`, `${HEAD} ${OPENED} extra`]) {
    assert.deepEqual(queueFacts(ENV, GROUP, fakeGh({ ...ANSWERS, "repos/stigmer/stigmer/pulls/1695": answer }).gh, quiet), nulls, `a pull request read as ${JSON.stringify(answer)} is unread`);
  }
  const noRef = { ...nulls, pull: null, base: null };
  assert.deepEqual(queueFacts(ENV, { ...GROUP, head_ref: "main" }, fakeGh(ANSWERS).gh, quiet), noRef);
  assert.deepEqual(queueFacts(ENV, undefined, fakeGh(ANSWERS).gh, quiet), noRef);
  assert.equal(queueFacts(ENV, GROUP, fakeGh({ ...ANSWERS, "repos/stigmer/stigmer/issues/1695/timeline": "0\n1" }).gh, quiet).retargeted, true, "a retarget on a later page counts");
});

test("a reused selection runs no lane, the always-run lane included, whatever changed", () => {
  const { lanes, every, measure, reused } = selectLanes({ event: "merge_group", changedFiles: [COVERAGE_FLOORS, "scripts/ci-lanes.mjs"], reused: RUN });
  assert.deepEqual(Object.entries(lanes).filter(([, run]) => run), []);
  assert.deepEqual(Object.keys(lanes).sort(), [...IDS].sort());
  assert.equal(every, null);
  assert.equal(measure, null);
  assert.equal(reused, RUN);
  assert.equal(selectLanes({ event: "merge_group", changedFiles: ["test/README.md"] }).reused, null);
});

test("a reused verdict passes only when every lane and coverage skipped, and names the run", () => {
  const green = verdict(needsFor([], (id) => (id === "coverage" ? "skipped" : undefined), RUN));
  assert.equal(green.ok, true);
  assert.equal(green.lines[0], `ok   lanes: selection succeeded, reusing ${RUN}`);
  assert.ok(green.lines.includes("ok   coverage: reused"));

  const ranCoverage = verdict(needsFor([], () => undefined, RUN));
  assert.deepEqual(ranCoverage.lines.filter((l) => l.startsWith("FAIL")), ["FAIL coverage: the run is reused, yet success"]);

  const ranLane = verdict(needsFor(["runner"], (id) => (id === "coverage" ? "skipped" : undefined), RUN));
  assert.deepEqual(ranLane.lines.filter((l) => l.startsWith("FAIL")), ["FAIL runner: the run is reused, yet the lane was needed and success"]);

  const strayLane = verdict(needsFor([], (id) => (id === "coverage" ? "skipped" : id === "docs" ? "failure" : undefined), RUN));
  assert.deepEqual(strayLane.lines.filter((l) => l.startsWith("FAIL")), ["FAIL docs: the run is reused, yet the lane was not needed and failure"]);
});

test("the summary says whether a queue entry was reused, and why", () => {
  const range = { base: "abc", head: "HEAD", source: "merge_group base commit" };
  const reuse = queueReuse(repeat);
  const reused = selectionSummary({ range, changedFiles: ["a"], ...selectLanes({ event: "merge_group", changedFiles: ["a"], reused: reuse.reused }), reuse });
  assert.match(reused, /\n\n\*\*Reused\*\*: the queue commit's tree is the pull request head's, .*\.\n\n0 lane\(s\): none\.$/);
  const fresh = queueReuse({ ...repeat, compareStatus: "diverged" });
  const ran = selectionSummary({ range, changedFiles: ["test/README.md"], ...selectLanes({ event: "merge_group", changedFiles: ["test/README.md"] }), reuse: fresh });
  assert.match(ran, /\n\nNot reused: the pull request's head does not contain the queue's base \(compare: diverged\)\.\n\n/);
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
  assert.deepEqual([...judge.needs].sort(), ["lanes", ...IDS, ...GATE_JOBS].sort());
  assert.match(judge.steps.at(-1).run, /ci-lanes\.mjs verdict/);
  assert.equal(judge.steps.at(-1).env.GATE_NEEDS, "${{ toJSON(needs) }}");
});

test("only the selection reads GitHub, read-only, and it hands Gate the run it reused", () => {
  const lanes = gate.jobs.lanes;
  assert.equal(lanes.outputs.reused, "${{ steps.select.outputs.reused }}");
  assert.deepEqual(lanes.permissions, { actions: "read", checks: "read", contents: "read", issues: "read", "pull-requests": "read" });
  assert.deepEqual(gate.permissions, { contents: "read" }, "every other job keeps the workflow's read-only contents");
  const tokened = Object.entries(gate.jobs).flatMap(([id, job]) => (job.steps ?? []).filter((step) => step.env?.GH_TOKEN !== undefined).map((step) => `${id}/${step.id ?? step.name}`));
  assert.deepEqual(tokened, ["lanes/select"], "the token reaches the selection's step alone");
  assert.equal(lanes.steps.find((step) => step.id === "select").env.GH_TOKEN, "${{ github.event_name == 'merge_group' && github.token || '' }}", "and only on a merge-queue entry: a pull-request run reads nothing, and its code gets no token");
  assert.equal(lanes.steps.find((step) => step.id === "select").run, "node scripts/ci-lanes.mjs");
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
