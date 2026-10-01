// Tests for the coverage wiring: every package with a floor is measured by
// the gate, the way the gate's Coverage job expects to read it.
// Run via `node --test scripts/ci-coverage.test.mjs` (wired into root `npm test`).
//
// What these guard, read from the files as they are. The floors file
// (test/coverage-floors.json) names the packages the gate judges; each must
// be run, in the job this file names, with the one set of coverage flags,
// and uploaded as a `coverage-*` artifact that holds its coverage directory.
// Without that, the Coverage job (ci.gate.yaml) would judge a package that
// was never measured as one the change did not reach, and a floor would hold
// nothing up. A package that runs vitest but is neither a subject nor named
// with its reason would never be measured, so the tool's refusal of a measured
// package with no floor could never fire for it. A package script that ran
// something after vitest would swallow
// the flags (npm appends them to the script's last command). The Coverage
// job must need every lane that uploads coverage, or it could run before one
// finished. And the coverage provider peers on one exact vitest, so the two
// are pinned together wherever the provider is declared.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

import { GATE_JOBS, laneId } from "./ci-lanes.mjs";
import { readFloors } from "./test-coverage.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflowsDir = join(root, ".github/workflows");
const readWorkflow = (file) => parse(readFileSync(join(workflowsDir, file), "utf8"));
const readJson = (path) => JSON.parse(readFileSync(join(root, path), "utf8"));

/** The flags every subject run carries: coverage on, written beside a JSON report, the PR's annotations kept. */
const FLAGS =
  "--coverage.enabled --coverage.reportsDirectory=coverage/v8 --reporter=default --reporter=github-actions --reporter=json --outputFile.json=coverage/report.json";

const LIBS = ["ci.ts-workspace.yaml", "libs"];

/** Each package with a floor: the script its job runs, and the jobs that run it with coverage. */
const SUBJECTS = {
  "backend/libs/ts/outbound": { script: "test", jobs: [LIBS] },
  "backend/libs/ts/plugin-package": { script: "test", jobs: [LIBS] },
  "backend/libs/ts/temporal-codecs": { script: "test", jobs: [LIBS] },
  "backend/libs/ts/zip-structure": { script: "test", jobs: [LIBS] },
  "backend/services/runner": { script: "test", jobs: [["ci.runner.yaml", "runner-vitest"]] },
  "backend/services/stigmer-server": { script: "test", jobs: [["ci.stigmer-server.yaml", "server-tests"]] },
  "client-apps/cli": { script: "test", jobs: [LIBS] },
  "client-apps/desktop": { script: "test", jobs: [["ci.ts-workspace.yaml", "desktop-tests"]] },
  "client-apps/web": { script: "test", jobs: [["ci.ts-workspace.yaml", "web-tests"]] },
  "mcp-server": { script: "test", jobs: [LIBS] },
  plugins: { script: "test", jobs: [LIBS] },
  "sdk/embed": { script: "test", jobs: [LIBS] },
  "sdk/ink": { script: "test", jobs: [LIBS] },
  "sdk/react": { script: "test", jobs: [["ci.ts-workspace.yaml", "react-tests"]] },
  "sdk/theme": { script: "test", jobs: [LIBS] },
  "sdk/typescript": { script: "test", jobs: [LIBS] },
  site: { script: "test:unit", jobs: [["ci.docs.yaml", "lint-and-build"]] },
  "test/conformance": { script: "test:unit", jobs: [["ci.conformance.yaml", "conformance-local"]] },
  "tools/codegen": { script: "test", jobs: [["ci.go-sdk.yaml", "go-sdk"], ["ci.authorization-model.yaml", "model"]] },
};

/** Packages that run vitest and are not coverage subjects, each with the reason. */
const NOT_SUBJECTS = new Map([
  [
    "test/support",
    "the suites' shared machinery, not a product package: its layout rule (test-integrity.mjs `layout-support-import`) lets it import only `node:*` and its own files, so it cannot carry a vitest config and its coverage block",
  ],
]);

const isUpload = (step) => String(step.uses ?? "").startsWith("actions/upload-artifact@");
const isCoverageUpload = (step) => isUpload(step) && String(step.with?.name ?? "").startsWith("coverage-");
const uploadPaths = (step) => String(step.with?.path ?? "").split("\n").map((line) => line.trim()).filter(Boolean);

test("every package with a floor is a subject here, and every subject has a floor", () => {
  const floors = readFloors(readFileSync(join(root, "test/coverage-floors.json"), "utf8"));
  assert.deepEqual(floors.problems, []);
  assert.deepEqual(Object.keys(SUBJECTS).sort(), Object.keys(floors.packages).sort());
});

test("every package that runs vitest is a subject, or is named with the reason it is not", () => {
  const manifests = execFileSync("git", ["ls-files", "*package.json"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((path) => path.endsWith("package.json"));
  const vitest = [];
  for (const manifest of manifests) {
    const scripts = readJson(manifest).scripts ?? {};
    const runs = Object.entries(scripts).some(([name, command]) => !/watch/.test(name) && /(^|&&\s*)vitest run\b/.test(command));
    if (runs) vitest.push(manifest === "package.json" ? "." : dirname(manifest));
  }
  const unmeasured = vitest.filter((pkg) => !(pkg in SUBJECTS) && !NOT_SUBJECTS.has(pkg));
  assert.deepEqual(unmeasured, [], "each runs vitest with no floor and no wiring: give it a floor and a row in SUBJECTS, or a reason in NOT_SUBJECTS");
  for (const pkg of NOT_SUBJECTS.keys()) {
    assert.ok(vitest.includes(pkg), `NOT_SUBJECTS names ${pkg}, which runs no vitest suite`);
    assert.ok(!(pkg in SUBJECTS), `${pkg} is both a subject and named as not one`);
  }
});

test("each subject's job runs its tests with the coverage flags and uploads its coverage directory", () => {
  for (const [pkg, { jobs }] of Object.entries(SUBJECTS)) {
    for (const [file, jobId] of jobs) {
      const job = readWorkflow(file).jobs[jobId];
      assert.ok(job, `${file} has no job ${jobId}`);
      const steps = job.steps ?? [];
      assert.ok(steps.some((step) => String(step.run ?? "").includes(FLAGS)), `${file} ${jobId}: no step runs ${pkg}'s tests with the coverage flags`);
      const uploads = steps.filter(isCoverageUpload);
      assert.equal(uploads.length, 1, `${file} ${jobId}: one coverage-* upload`);
      assert.ok(uploadPaths(uploads[0]).includes(`${pkg}/coverage/`), `${file} ${jobId}: the upload does not hold ${pkg}/coverage/`);
      assert.equal(uploads[0].if, "${{ !cancelled() }}", `${file} ${jobId}: a red run still uploads what it covered`);
    }
  }
});

test("every path a coverage upload holds belongs to a subject this file runs in that job", () => {
  const owner = new Map();
  for (const [pkg, { jobs }] of Object.entries(SUBJECTS)) {
    for (const [file, jobId] of jobs) owner.set(`${file} ${jobId} ${pkg}/coverage/`, true);
  }
  for (const file of readdirSync(workflowsDir).filter((f) => /^ci\..*\.ya?ml$/.test(f))) {
    for (const [jobId, job] of Object.entries(readWorkflow(file).jobs ?? {})) {
      for (const step of (job.steps ?? []).filter(isCoverageUpload)) {
        for (const path of uploadPaths(step)) {
          assert.ok(owner.has(`${file} ${jobId} ${path}`), `${file} ${jobId} uploads ${path}, which no subject here names for that job`);
        }
      }
    }
  }
});

test("each subject's script runs vitest last, so the flags appended to it reach vitest", () => {
  for (const [pkg, { script }] of Object.entries(SUBJECTS)) {
    const command = readJson(`${pkg}/package.json`).scripts?.[script];
    assert.ok(command, `${pkg} has no "${script}" script`);
    const last = command.split("&&").at(-1).trim();
    assert.match(last, /^vitest run(\s|$)/, `${pkg}'s "${script}" ends in \`${last}\`, which would receive the coverage flags`);
  }
});

test("the Coverage job needs exactly the lanes that upload coverage, and Gate needs it", () => {
  const uploading = new Set();
  for (const file of readdirSync(workflowsDir).filter((f) => /^ci\..*\.ya?ml$/.test(f))) {
    for (const job of Object.values(readWorkflow(file).jobs ?? {})) {
      if ((job.steps ?? []).some(isCoverageUpload)) uploading.add(laneId(file));
    }
  }
  const gate = readWorkflow("ci.gate.yaml");
  const coverage = gate.jobs.coverage;
  assert.ok(GATE_JOBS.includes("coverage"));
  assert.deepEqual([...coverage.needs].sort(), ["lanes", ...uploading].sort());
  assert.equal(coverage.if, "${{ !cancelled() && needs.lanes.result == 'success' }}", "it runs whichever lanes were needed, and never on a cancelled run");
  assert.ok(gate.jobs.gate.needs.includes("coverage"));
  const download = coverage.steps.find((step) => String(step.uses ?? "").startsWith("actions/download-artifact@"));
  assert.equal(download.with.pattern, "coverage-*");
  const judged = coverage.steps.map((step) => String(step.run ?? "")).join("\n");
  assert.match(judged, /node scripts\/test-coverage\.mjs --floors test\/coverage-floors\.json --input "\$RUNNER_TEMP\/coverage"/);
});

test("the coverage provider and vitest are pinned to one exact version wherever the provider is declared", () => {
  for (const manifest of ["package.json", "backend/services/runner/package.json", "backend/services/stigmer-server/package.json", "site/package.json"]) {
    const { dependencies = {}, devDependencies = {} } = readJson(manifest);
    const declared = { ...dependencies, ...devDependencies };
    const provider = declared["@vitest/coverage-v8"];
    assert.match(String(provider), /^\d+\.\d+\.\d+$/, `${manifest}: @vitest/coverage-v8 is exact`);
    assert.equal(declared.vitest, provider, `${manifest}: vitest is pinned beside the provider it peers with`);
  }
});
