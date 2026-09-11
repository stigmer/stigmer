// Tests for scripts/turbo-affected.mjs: how the CI lane's gate turns "what
// changed" into "which packages run".
// Run via `node --test scripts/turbo-affected.test.mjs` (wired into root `npm test`).
//
// What these guard: the reading of turbo's task-level answer (an upstream
// task is not an affected package; an unknown reason is), the three
// run-everything rules (dispatch, the lane's own tooling, an SCM fallback),
// the base ref derived from each GitHub event, and the exact lines the
// workflow's `if:` conditions read. Turbo itself is not run here; the query
// JSON is the shape recorded on 2026-09-11 (T01_6 in stigmer-cloud project
// 20260904.04), so a change in turbo's output would fail the one live probe
// in the lane, not these.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LANE_TASKS,
  WORKSPACE_TOOLING,
  decide,
  everythingBecause,
  outputLines,
  readAffected,
  resolveRange,
  summaryMarkdown,
  workflowFileOf,
} from "./turbo-affected.mjs";

const WORKSPACE = ["@stigmer/protos", "@stigmer/sdk", "@stigmer/react", "web"];
const SETS_BY_NAME = {
  libs: ["@stigmer/protos", "@stigmer/sdk", "@stigmer/react"],
  workspace: WORKSPACE,
};

function task(pkg, name, reason) {
  return {
    name,
    fullName: `${pkg}#${name}`,
    package: { name: pkg },
    reason: { __typename: reason },
  };
}
function query(items) {
  return { data: { affectedTasks: { items, length: items.length } } };
}

const CI_PR = {
  GITHUB_EVENT_NAME: "pull_request",
  GITHUB_BASE_REF: "main",
  GITHUB_WORKFLOW_REF:
    "stigmer/stigmer/.github/workflows/ci.ts-workspace.yaml@refs/pull/9/merge",
};

test("LANE_TASKS are the tasks the lane runs; the browser suite is one of them", () => {
  assert.deepEqual(LANE_TASKS, [
    "build",
    "typecheck",
    "lint",
    "test",
    "test:a11y",
  ]);
});

test("resolveRange: a pull request compares with origin/<base branch>", () => {
  assert.deepEqual(resolveRange(CI_PR), {
    base: "origin/main",
    head: "HEAD",
    source: "pull_request base branch",
  });
});

test("resolveRange: a push compares with the event's `before`; an all-zero `before` is no base", () => {
  const push = { GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: "/event.json" };
  assert.deepEqual(
    resolveRange(push, {}, () => ({ before: "abc123" })),
    {
      base: "abc123",
      head: "HEAD",
      source: "push event `before`",
    },
  );
  const fresh = resolveRange(push, {}, () => ({ before: "0".repeat(40) }));
  assert.equal(fresh.base, null);
  assert.match(fresh.source, /without a usable/);
});

test("resolveRange: a terminal run defaults to origin/main; --base and --head win everywhere", () => {
  assert.deepEqual(resolveRange({}), {
    base: "origin/main",
    head: "HEAD",
    source: "default",
  });
  assert.deepEqual(resolveRange(CI_PR, { base: "v1", head: "v2" }), {
    base: "v1",
    head: "v2",
    source: "--base",
  });
});

test("workflowFileOf reads the lane's own path out of GITHUB_WORKFLOW_REF", () => {
  assert.equal(workflowFileOf(CI_PR), ".github/workflows/ci.ts-workspace.yaml");
  assert.equal(workflowFileOf({}), null);
});

test("readAffected: changed and downstream tasks name their package; an upstream-only task does not", () => {
  // The (d) row of the 2026-09-11 matrix: a tool-view fixture edit.
  const { packages, rows, fallback } = readAffected(
    query([
      task("@stigmer/protos", "build", "TaskAllChanged"),
      task("@stigmer/react", "test", "TaskFileChanged"),
      task("@stigmer/sdk", "build", "TaskAllChanged"),
      task("@stigmer/sdk", "test", "TaskFileChanged"),
      task("@stigmer/theme", "build", "TaskAllChanged"),
    ]),
  );
  assert.equal(fallback, null);
  assert.deepEqual(packages.sort(), ["@stigmer/react", "@stigmer/sdk"]);
  assert.equal(rows.length, 5, "every task is kept for the summary");
  assert.ok(rows.find((r) => r.package === "@stigmer/theme").upstreamOnly);
});

test("readAffected: a dependency's change reaches the dependents; the root package is dropped", () => {
  const { packages } = readAffected(
    query([
      task("@stigmer/protos", "build", "TaskFileChanged"),
      task("@stigmer/sdk", "build", "TaskDependencyTaskChanged"),
      task("//", "test", "TaskFileChanged"),
    ]),
  );
  assert.deepEqual(packages.sort(), ["@stigmer/protos", "@stigmer/sdk"]);
});

test("readAffected: a reason type this script does not know counts as affected, and says so", () => {
  const { packages, rows } = readAffected(
    query([task("web", "build", "TaskSomethingNew")]),
  );
  assert.deepEqual(packages, ["web"]);
  assert.match(rows[0].note, /unknown reason/);
});

test("readAffected: turbo's own error is the fallback, on one line", () => {
  const { fallback, packages } = readAffected({
    data: null,
    errors: [
      {
        message:
          "Failed to calculate affected packages: Unable to query SCM:\n  fatal: bad ref\n",
      },
    ],
  });
  assert.deepEqual(packages, []);
  assert.equal(
    fallback,
    "Failed to calculate affected packages: Unable to query SCM: fatal: bad ref",
  );
});

test("everythingBecause: a manual dispatch runs everything", () => {
  assert.match(
    everythingBecause({ GITHUB_EVENT_NAME: "workflow_dispatch" }, []),
    /manual run/,
  );
});

test("everythingBecause: the lane's own workflow file and the workspace tooling run everything; other root files do not", () => {
  assert.match(
    everythingBecause(CI_PR, [
      "docs/x.mdx",
      ".github/workflows/ci.ts-workspace.yaml",
    ]),
    /ci\.ts-workspace\.yaml/,
  );
  assert.equal(
    everythingBecause(CI_PR, [
      ".github/workflows/ci.docs.yaml",
      "docs/x.mdx",
      "Makefile",
    ]),
    null,
    "another lane's file, docs and the Makefile are not this lane's tooling",
  );
  for (const file of [
    "package.json",
    "package-lock.json",
    "scripts/turbo-set.mjs",
  ]) {
    assert.match(everythingBecause(CI_PR, [file]), /workspace tooling/, file);
  }
  assert.equal(
    everythingBecause(CI_PR, ["sdk/react/package.json"]),
    null,
    "a package's manifest is the graph's business",
  );
  assert.equal(
    everythingBecause(CI_PR, ["scripts-of-someone-else/x"]),
    null,
    "prefix match is on the directory, not the string",
  );
  assert.deepEqual(WORKSPACE_TOOLING, [
    "package.json",
    "package-lock.json",
    "scripts/",
  ]);
});

test("decide: the graph's answer, in workspace order", () => {
  const decision = decide({
    env: CI_PR,
    changedFiles: ["sdk/react/src/x.ts", "test/fixtures/tool-view/a.json"],
    query: query([
      task("web", "build", "TaskDependencyTaskChanged"),
      task("@stigmer/react", "build", "TaskFileChanged"),
      task("@stigmer/protos", "build", "TaskAllChanged"),
    ]),
    workspace: WORKSPACE,
  });
  assert.deepEqual(
    decision.packages,
    ["@stigmer/react", "web"],
    "workspace order, upstream-only dropped",
  );
  assert.equal(decision.everything, null);
  assert.equal(decision.warning, null);
});

test("decide: nothing affected is an empty list, not everything", () => {
  const decision = decide({
    env: CI_PR,
    changedFiles: ["docs/x.mdx"],
    query: query([]),
    workspace: WORKSPACE,
  });
  assert.deepEqual(decision.packages, []);
  assert.equal(decision.everything, null);
});

test("decide: tooling changes and SCM fallbacks both yield the whole workspace; only the fallback warns", () => {
  const tooling = decide({
    env: CI_PR,
    changedFiles: ["scripts/turbo-set.mjs"],
    query: query([]),
    workspace: WORKSPACE,
  });
  assert.deepEqual(tooling.packages, WORKSPACE);
  assert.match(tooling.everything, /workspace tooling/);
  assert.equal(tooling.warning, null, "an intended full run is not a warning");

  const scm = decide({
    env: CI_PR,
    changedFiles: [],
    query: { data: null, errors: [{ message: "unknown revision" }] },
    workspace: WORKSPACE,
  });
  assert.deepEqual(scm.packages, WORKSPACE);
  assert.match(scm.everything, /could not compare/);
  assert.match(scm.warning, /falling back to every package/);
});

test("outputLines: the JSON list, the everything flag, one boolean per set", () => {
  const decision = {
    packages: ["web"],
    everything: null,
    rows: [],
    warning: null,
  };
  assert.deepEqual(outputLines(decision, SETS_BY_NAME), [
    'packages=["web"]',
    "everything=false",
    "libs=false",
    "workspace=true",
  ]);
  const none = { packages: [], everything: null, rows: [], warning: null };
  assert.deepEqual(outputLines(none, SETS_BY_NAME), [
    "packages=[]",
    "everything=false",
    "libs=false",
    "workspace=false",
  ]);
});

test("summaryMarkdown: names the range, the packages and each task's reason; upstream-only tasks are labelled", () => {
  const range = {
    base: "origin/main",
    head: "HEAD",
    source: "pull_request base branch",
  };
  const decision = decide({
    env: CI_PR,
    changedFiles: [],
    query: query([
      task("@stigmer/sdk", "test", "TaskFileChanged"),
      task("@stigmer/protos", "build", "TaskAllChanged"),
    ]),
    workspace: WORKSPACE,
  });
  const md = summaryMarkdown(decision, range);
  assert.match(
    md,
    /Base `origin\/main` \(pull_request base branch\), head `HEAD`/,
  );
  assert.match(md, /1 package\(s\): `@stigmer\/sdk`/);
  assert.match(md, /`@stigmer\/sdk#test` \| TaskFileChanged/);
  assert.match(
    md,
    /`@stigmer\/protos#build` \| TaskAllChanged \(upstream of an affected task; runs via \^build\)/,
  );

  const empty = summaryMarkdown(
    { packages: [], everything: null, rows: [] },
    range,
  );
  assert.match(empty, /No package is affected; every job below is skipped/);
  const all = summaryMarkdown(
    {
      packages: WORKSPACE,
      everything: "workflow_dispatch: a manual run runs everything",
      rows: [],
    },
    range,
  );
  assert.match(all, /\*\*Everything\*\* \(4 packages\): workflow_dispatch/);
});
