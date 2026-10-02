#!/usr/bin/env node

/**
 * Decides which CI lanes a change needs, and whether the lanes it ran passed.
 *
 * One workflow, .github/workflows/ci.gate.yaml, runs on every pull request and
 * every merge-queue entry. Its first job asks this script which of the lanes
 * the change needs; it then calls each needed lane as a reusable workflow
 * (`uses: ./.github/workflows/ci.<lane>.yaml`); its last job, `Gate`, asks this
 * script for the verdict. `Gate` is the one required check on `main`.
 *
 * Why one workflow and one map. Each lane used to decide for itself, with
 * workflow-level `paths:` lists or an internal paths filter. A lane whose
 * filter did not match never created its check, so no single check could be
 * required: requiring one lane let every other lane be red at merge, and a
 * workflow that silently stopped matching looked the same as one with nothing
 * to do (#662 merged over a red docs lane that way, #688). Here the lane set
 * is explicit: a lane the change needs either passes or fails `Gate`, and the
 * lists live in one place, guarded by scripts/lane-triggers.test.mjs (a list
 * that watches a standalone package must watch everything it links).
 *
 * Every lane runs when the gate itself could have changed: this script, the
 * orchestrator, or a composite action the lanes use (`EVERY_LANE`); on a
 * manual dispatch; and when no base can be read. A lane's own workflow file
 * is in its own list, so editing one lane runs that lane. Every lane that
 * measures a package (`COVERAGE_LANES`, the lanes the `coverage` job needs)
 * runs when the coverage floors change, so a moved floor is judged against a
 * run that measured its package; turbo-affected.mjs counts the same file as
 * workspace tooling, so the always-run lane measures every package too.
 *
 * The comparison range is `resolveRange` from turbo-affected.mjs, so the gate
 * and the one lane that also reads a range (ci.ts-workspace) agree on the
 * base: a pull request compares with its base branch, a merge-queue entry with
 * the queue's base commit, a push with its `before`.
 *
 * The verdict reads the gate's `needs` context. It fails when the selection
 * did not run, when a needed lane did not succeed, or when a lane that was not
 * needed reports anything but `skipped`. A required check that is skipped
 * counts as passed, so `Gate` itself runs under `if: always()` and this is
 * where the decision is made. One job besides the lanes is judged too:
 * `coverage` (ci.gate.yaml's header says what it refuses), which must succeed
 * whenever the selection did, whichever lanes ran, unless the run is reused.
 *
 * A merge-queue entry that only repeats a pull-request run which already
 * passed runs no lane (`queueReuse`, #1708). That holds when the queue's base
 * is an ancestor of the pull request's head, the queue commit's tree is the
 * head's tree, the pull request's base was never changed (by hand, or by
 * GitHub when a stacked pull request's base branch is deleted), and the newest
 * `Gate` of this workflow's runs for that pull request, against the queue's
 * base branch, passed on the head: the head then contains every `main` its run
 * could have merged onto, so the merge ref that run checked out was the head's
 * tree, the very tree the queue would test. A `Gate` check from any other
 * workflow is not this gate's verdict, and a run from before a retarget merged
 * onto another base, so neither is reused. The selection then selects nothing
 * and names the run it reuses, `coverage` skips, and the verdict passes only
 * if every lane and `coverage` skipped. Anything the selection cannot read
 * runs the lanes as usual, so a failed read never turns `Gate` green. An entry
 * queued behind another has that entry's commit as its base and fails the
 * first condition; a pull request that has moved fails the second.
 *
 * Outputs of the selection (stdout; appended to GITHUB_OUTPUT when set):
 *   <lane id>=true|false      one per lane in LANES, e.g. runner=true
 *   reused=<run url>          the run a queue entry reuses; empty otherwise
 * A summary goes to GITHUB_STEP_SUMMARY when set, for both commands.
 *
 * Usage:
 *   node scripts/ci-lanes.mjs                      # in CI, from the event
 *   node scripts/ci-lanes.mjs --base origin/main   # at a terminal
 *   GATE_NEEDS='<toJSON(needs)>' node scripts/ci-lanes.mjs verdict
 * Exit: 0 selected / passed, 1 the verdict failed, 2 the script could not
 * judge (a usage or git error).
 */

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { matchesGlob } from "./agents-check.mjs";
import { COVERAGE_FLOORS, changedFilesSince, readEventPayload, resolveRange } from "./turbo-affected.mjs";

/**
 * The lanes, keyed by workflow file under .github/workflows. `paths` are the
 * files whose change needs the lane, in the glob dialect the guidance gate
 * reads (`matchesGlob`: `**`, `*`, `?`); lane-triggers.test.mjs refuses the
 * syntax GitHub's filter and that matcher disagree on. `always` marks a lane
 * that runs on every change and decides inside what to cover.
 */
export const LANES = {
  "ci.all-in-one.yaml": {
    paths: [
      "deploy/all-in-one/**",
      "scripts/stage-all-in-one.mjs",
      "test/install/smoke-all-in-one.mjs",
      "scripts/lib/**",
      // The install layer's drivers and probes, and the two test/support
      // modules it loads (the fake model and its wire); the rest of
      // test/support is the contract and e2e suites' machinery.
      "test/install/lib/**",
      "test/support/src/fake-llm-upstream.ts",
      "test/support/src/llm-wire.ts",
      "scripts/publish-libs.mjs",
      "client-apps/cli/src/local/**",
      "client-apps/cli/src/commands/up.ts",
      "backend/services/runner/scripts/bundle-slim.mjs",
      "backend/services/stigmer-server/scripts/bundle-slim.mjs",
      // The model path a self-hoster's runner takes: the client, the base URL
      // it reads (ANTHROPIC_BASE_URL) and the provider routing it applies. The
      // install journeys are its only end-to-end proof. These files, not the
      // runner package, which would pull in the package's links.
      "backend/services/runner/src/shared/model-client.ts",
      "backend/services/runner/src/shared/llm-backend.ts",
      "backend/services/runner/src/shared/llm-proxy.ts",
      "Makefile",
      ".github/workflows/ci.all-in-one.yaml",
    ],
  },
  "ci.authorization-model.yaml": {
    paths: [
      "backend/services/stigmer-server/fga/**",
      "backend/services/stigmer-server/src/authorization/model/data/**",
      "tools/codegen/src/authorization-model/**",
      "tools/codegen/package.json",
      "package-lock.json",
      ".github/workflows/ci.authorization-model.yaml",
    ],
  },
  "ci.cli-up.yaml": {
    // `stigmer up` end to end (test/install/smoke-cli-cutover.mjs): the only run
    // of the CLI binary's own commands against a server it started, so the
    // whole CLI source is in it, not only its runtime acquisition.
    paths: [
      "client-apps/cli/src/**",
      "client-apps/cli/package.json",
      "test/install/smoke-cli-cutover.mjs",
      "scripts/lib/**",
      // The install layer's drivers and probes, and the two test/support
      // modules it loads (the fake model and its wire); the rest of
      // test/support is the contract and e2e suites' machinery.
      "test/install/lib/**",
      "test/support/src/fake-llm-upstream.ts",
      "test/support/src/llm-wire.ts",
      // The published install's registry wait (test/install/lib/install-cli.mjs).
      "scripts/publish-standalone.mjs",
      "backend/services/runner/scripts/bundle-slim.mjs",
      "backend/services/stigmer-server/scripts/bundle-slim.mjs",
      // The runner's model path (ci.all-in-one says why these files).
      "backend/services/runner/src/shared/model-client.ts",
      "backend/services/runner/src/shared/llm-backend.ts",
      "backend/services/runner/src/shared/llm-proxy.ts",
      "Makefile",
      ".github/workflows/ci.cli-up.yaml",
    ],
  },
  "ci.codegen.yaml": {
    paths: [
      "apis/**",
      "tools/codegen/**",
      "mcp-server/src/gen/**",
      "mcp-server/Makefile",
      "sdk/typescript/src/gen/**",
      "sdk/typescript/Makefile",
      "sdk/python/src/stigmer/_gen/**",
      "sdk/python/Makefile",
      "sdk/go/proto/**",
      ".github/workflows/ci.codegen.yaml",
    ],
  },
  "ci.compose-stack.yaml": {
    paths: [
      "docker-compose.yml",
      "docker-compose.dev.yml",
      ".env.example",
      "test/install/smoke-compose.mjs",
      // The whole lib, not one file: the smoke imports stigmer-smoke.mjs and
      // the build-from-source path runs bundle-slim.mjs, which imports
      // source-map-pragma.mjs (#1087).
      "scripts/lib/**",
      // The install layer's drivers and probes, and the two test/support
      // modules it loads (the fake model and its wire); the rest of
      // test/support is the contract and e2e suites' machinery.
      "test/install/lib/**",
      "test/support/src/fake-llm-upstream.ts",
      "test/support/src/llm-wire.ts",
      // The compose-runner image installs the CLI tarballs these two stage
      // (the stage script packs through publish-libs.mjs --only); a change
      // to either is a change to what the runner image contains.
      "scripts/stage-compose-runner-cli.mjs",
      "scripts/publish-libs.mjs",
      "backend/services/runner/Dockerfile.sandbox",
      "backend/services/stigmer-server/Dockerfile",
      // The runner's model path (ci.all-in-one says why these files).
      "backend/services/runner/src/shared/model-client.ts",
      "backend/services/runner/src/shared/llm-backend.ts",
      "backend/services/runner/src/shared/llm-proxy.ts",
      "Makefile",
      ".github/workflows/ci.compose-stack.yaml",
    ],
  },
  "ci.conformance.yaml": {
    paths: [
      "backend/**",
      "test/conformance/**",
      // The shared test machinery the suites import (@stigmer/test-support).
      "test/support/**",
      "apis/**",
      ".github/workflows/ci.conformance.yaml",
    ],
  },
  "ci.conformance-execution.yaml": {
    paths: [
      "backend/**",
      "test/conformance/**",
      "test/support/**",
      "apis/**",
      // The Temporal CLI the suites run against: its pin, downloader and installer.
      "client-apps/cli/src/local/artifact.ts",
      "client-apps/cli/src/local/temporal/download.ts",
      "client-apps/cli/scripts/install-temporal-cli.ts",
      ".github/workflows/ci.conformance-execution.yaml",
    ],
  },
  "ci.crate.yaml": {
    paths: [
      "crates/stigmer-runner-host/**",
      "backend/services/runner/src/ipc-protocol.ts",
      "backend/services/runner/src/ipc-protocol-fixtures.ts",
      ".github/workflows/ci.crate.yaml",
    ],
  },
  "ci.docs.yaml": {
    paths: [
      "docs/**",
      "site/**",
      "apis/**",
      "tools/codegen/**",
      // check-docs-yaml validates the raw manifests under these
      // authoring surfaces too (Makefile: --authoring-dirs).
      "examples/**",
      "plugins/**",
      "client-apps/cli/**",
      "sdk/ink/**",
      "sdk/react/**",
      // The docs site embeds the Ask AI panel through @stigmer/embed's
      // workspace source, so embed changes can break the site build/tests.
      "sdk/embed/**",
      // The rest of what the site links with `file:` and builds against
      // (scripts/lane-triggers.test.mjs fails when one is missing).
      "sdk/typescript/**",
      "sdk/theme/**",
      "backend/libs/ts/plugin-package/**",
      // What `make gen-sdk-docs` writes outside the lists above: SDK Docs
      // Freshness is a gate, so a hand edit to generated output must run it.
      "backend/services/stigmer-server/src/domain/workflow/registry/data/**",
      ".vale.ini",
      ".prettierrc",
      ".lychee.toml",
      "vale/**",
      // Agent guidance: the root and nested AGENTS.md guides, .agents/**, the
      // generated Cursor shims and hook config, and the gate itself (make
      // agents-check). The hook script's own tests run in ci.ts-workspace.
      "AGENTS.md",
      "**/AGENTS.md",
      ".agents/**",
      ".cursor/rules/agents-*.mdc",
      ".cursor/hooks.json",
      "scripts/agents-check.mjs",
      ".github/workflows/ci.docs.yaml",
    ],
  },
  "ci.e2e-interactive.yaml": {
    paths: [
      "test/e2e/**",
      // The console-login stack shape runs the shared OIDC issuer
      // (test/support's local-oidc-issuer-main) as a process.
      "test/support/**",
      "backend/**",
      "client-apps/web/**",
      "sdk/**",
      "apis/**",
      // The Temporal CLI the suites run against: its pin, downloader and installer.
      "client-apps/cli/src/local/artifact.ts",
      "client-apps/cli/src/local/temporal/download.ts",
      "client-apps/cli/scripts/install-temporal-cli.ts",
      ".nvmrc",
      ".github/workflows/ci.e2e-interactive.yaml",
    ],
  },
  "ci.go-sdk.yaml": {
    paths: [
      "apis/**",
      "sdk/go/**",
      "tools/codegen/**",
      "go.work",
      "go.work.sum",
      ".github/workflows/ci.go-sdk.yaml",
    ],
  },
  "ci.helm-chart.yaml": {
    paths: [
      "deploy/helm/**",
      // The parity test reads the compose file: a compose-only change must
      // run it, or the drift it exists to catch merges green.
      "docker-compose.yml",
      "test/install/smoke-helm.mjs",
      // The whole lib: the smoke imports stigmer-smoke.mjs (#1087).
      "scripts/lib/**",
      // The install layer's drivers and probes, and the two test/support
      // modules it loads (the fake model and its wire); the rest of
      // test/support is the contract and e2e suites' machinery.
      "test/install/lib/**",
      "test/support/src/fake-llm-upstream.ts",
      "test/support/src/llm-wire.ts",
      // The kind gate builds the compose-runner image, which installs the
      // CLI tarballs these two stage (ci.compose-stack lists them too).
      "scripts/stage-compose-runner-cli.mjs",
      "scripts/publish-libs.mjs",
      // The runner's model path (ci.all-in-one says why these files).
      "backend/services/runner/src/shared/model-client.ts",
      "backend/services/runner/src/shared/llm-backend.ts",
      "backend/services/runner/src/shared/llm-proxy.ts",
      "Makefile",
      ".github/workflows/ci.helm-chart.yaml",
    ],
  },
  "ci.install-script.yaml": {
    paths: ["site/public/install.sh", ".github/workflows/ci.install-script.yaml"],
  },
  "ci.java-sdk.yaml": {
    paths: [
      "apis/**",
      "sdk/java/**",
      "tools/codegen/**",
      ".github/workflows/ci.java-sdk.yaml",
    ],
  },
  "ci.plugins-static.yaml": {
    paths: [
      "plugins/**",
      "backend/libs/ts/plugin-package/**",
      ".github/workflows/ci.plugins-static.yaml",
    ],
  },
  "ci.proto-breaking.yaml": {
    // Compares apis/ with `main`; in the merge queue that is the queue's base.
    paths: ["apis/**", ".github/workflows/ci.proto-breaking.yaml"],
  },
  "ci.runner.yaml": {
    paths: [
      "backend/services/runner/**",
      "apis/stubs/ts/**",
      "backend/libs/ts/**",
      // `make build-runner-deps` goes through the root `build:runner-deps`
      // script: the turbo wrapper, its task graph and the set it resolves
      // from. A change to any of them must exercise this lane (2026-09-11:
      // a merge reached main without this lane running).
      "package.json",
      "package-lock.json",
      "turbo.json",
      "scripts/turbo-set.mjs",
      "scripts/publish-libs.mjs",
      // scripts/lib/ is imported by this package's bundle-slim.mjs
      // (source-map-pragma.mjs, the slim packages' source-map rule), so a
      // change there must run this gate in its own PR (#1087).
      "scripts/lib/**",
      "Makefile",
      ".github/workflows/ci.runner.yaml",
    ],
  },
  "ci.stigmer-server.yaml": {
    paths: [
      "backend/services/stigmer-server/**",
      // The packages the server links with `file:` and builds against.
      "apis/stubs/ts/**",
      "backend/libs/ts/**",
      // `npm run build:runner-deps` is the turbo wrapper, its task graph and
      // the set it resolves from. A change to any of them changes what this
      // lane builds, so it must run here in its own PR.
      "package.json",
      "package-lock.json",
      "turbo.json",
      "scripts/turbo-set.mjs",
      "scripts/publish-libs.mjs",
      "client-apps/web/nginx.conf",
      // scripts/lib/ and test/install/lib/ are imported by this package's own
      // scripts: bundle-slim.mjs (source-map-pragma.mjs) and
      // verify-slim-artifact.mjs / smoke-docker-image.mjs (stigmer-smoke.mjs,
      // the shared console-lane probe). A change there must run this gate in
      // its own PR (#1087: the probe's contract moved and this lane went red on
      // main).
      "scripts/lib/**",
      "test/install/lib/**",
      "scripts/verify-static-export-routes.mjs",
      "test/extension-consumer/**",
      "Makefile",
      ".github/workflows/ci.stigmer-server.yaml",
    ],
  },
  "ci.ts-workspace.yaml": {
    // turbo-affected.mjs chooses the packages inside the lane.
    always: true,
  },
  "ci.upgrade-rehearsal.yaml": {
    // Each install moved from the newest release to this change by its
    // guide's procedure (test/install/rehearse-upgrade.mjs): the changes that can
    // break what the last release stored, or the way a user upgrades.
    paths: [
      // Both engines' migrations and the row code that reads what they hold:
      // a changed read can lose the last release's rows as surely as a
      // migration can.
      "backend/services/stigmer-server/src/store/**",
      "deploy/**",
      "docker-compose.yml",
      ".env.example",
      // The CLI's runtime acquisition and `up`: how its upgrade happens.
      "client-apps/cli/src/local/**",
      "client-apps/cli/src/commands/up.ts",
      "test/install/rehearse-upgrade.mjs",
      "scripts/lib/**",
      // The install layer's drivers and probes, and the two test/support
      // modules it loads (the fake model and its wire); the rest of
      // test/support is the contract and e2e suites' machinery.
      "test/install/lib/**",
      "test/support/src/fake-llm-upstream.ts",
      "test/support/src/llm-wire.ts",
      "scripts/publish-standalone.mjs",
      "scripts/stage-all-in-one.mjs",
      "scripts/stage-compose-runner-cli.mjs",
      // The images' users and data paths decide whether a volume the last
      // release wrote is still readable after the upgrade.
      "backend/services/stigmer-server/Dockerfile",
      "backend/services/runner/Dockerfile.sandbox",
      "Makefile",
      ".github/workflows/ci.upgrade-rehearsal.yaml",
    ],
  },
  "ci.workflows.yaml": {
    // zizmor audits everything under .github: the workflows, the composite
    // actions, dependabot.yml and zizmor.yml, its own configuration.
    paths: [".github/**"],
  },
};

/** A change to any of these could change the gate itself, so every lane runs. */
export const EVERY_LANE = [
  ".github/workflows/ci.gate.yaml",
  "scripts/ci-lanes.mjs",
  ".github/actions/**",
];

/** The jobs in ci.gate.yaml that are not lanes and that `Gate` needs to have passed. */
export const GATE_JOBS = ["coverage"];

/**
 * The lanes whose jobs run a package's own suite with coverage and upload it
 * (`coverage-*` artifacts): exactly what the `coverage` job needs besides the
 * selection, held to it by scripts/ci-coverage.test.mjs.
 */
export const COVERAGE_LANES = [
  "ci.authorization-model.yaml",
  "ci.conformance.yaml",
  "ci.docs.yaml",
  "ci.go-sdk.yaml",
  "ci.runner.yaml",
  "ci.stigmer-server.yaml",
  "ci.ts-workspace.yaml",
];

/** `ci.runner.yaml` -> `runner`: the lane's job id in ci.gate.yaml and its output name. */
export function laneId(file) {
  return file.replace(/^ci\./, "").replace(/\.ya?ml$/, "");
}

/** The check `Gate` reports: the name the ruleset requires, and the one a queue entry reuses. */
export const GATE_CHECK = "Gate";

/** The pull request and base branch a merge-queue ref names (`gh-readonly-queue/<base>/pr-<n>-<sha>`), or null. */
export function queueRef(headRef) {
  const match = /^(?:refs\/heads\/)?gh-readonly-queue\/(.+)\/pr-(\d+)-[0-9a-f]{40}$/.exec(headRef ?? "");
  return match === null ? null : { pull: Number(match[2]), base: match[1] };
}

/**
 * The timeline events that change a pull request's base: a retarget by hand,
 * and GitHub's own when the base branch is deleted under a stacked pull
 * request (which records only the second).
 */
export const RETARGET_EVENTS = ["base_ref_changed", "automatic_base_change_succeeded"];

/** The workflow whose `Gate` a queue entry may reuse: this gate's, as its own runs report their path. */
export const GATE_WORKFLOW = ".github/workflows/ci.gate.yaml";

/**
 * Whether a merge-queue entry repeats a pull-request run that already passed
 * (the header says why the conditions suffice). `facts` is what GitHub
 * answered, each field null when it could not be read:
 *   - `groupTree`, `headTree`: the queue commit's tree and the pull request
 *     head's;
 *   - `compareStatus`: `compare/<queue base>...<head>`, `ahead` or
 *     `identical` when the base is an ancestor of the head;
 *   - `retargeted`: whether the pull request's base was ever changed
 *     (`RETARGET_EVENTS`);
 *   - `gateSuites`: the check suites of this workflow's runs for this pull
 *     request, against the queue's base branch, on the head;
 *   - `checkRuns`: the head's `Gate` check runs, `{ app, suite, status,
 *     conclusion, startedAt, url }`.
 * Returns `{ reused: <run url> | null, reason }`.
 */
export function queueReuse({ groupTree, headTree, compareStatus, retargeted, gateSuites, checkRuns }) {
  const no = (reason) => ({ reused: null, reason });
  if (compareStatus === null) return no("the queue's base could not be compared with the pull request's head");
  if (compareStatus !== "ahead" && compareStatus !== "identical") {
    return no(`the pull request's head does not contain the queue's base (compare: ${compareStatus})`);
  }
  if (groupTree === null || headTree === null) return no("a tree could not be read");
  if (groupTree !== headTree) return no(`the queue commit's tree ${groupTree.slice(0, 12)} is not the pull request head's ${headTree.slice(0, 12)}`);
  if (retargeted === null) return no("the pull request's base changes could not be read");
  if (retargeted) return no("the pull request's base was changed, so a run before that merged onto another base");
  if (gateSuites === null || checkRuns === null) return no(`the pull request head's \`${GATE_CHECK}\` runs could not be read`);
  const newest = checkRuns
    .filter((run) => run.app === "github-actions" && gateSuites.includes(run.suite))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)))[0];
  if (newest === undefined) return no(`the pull request's head has no \`${GATE_CHECK}\` from ${GATE_WORKFLOW}'s runs for this pull request against the queue's base`);
  if (newest.status !== "completed" || newest.conclusion !== "success") {
    return no(`the head's newest \`${GATE_CHECK}\` is ${newest.status === "completed" ? newest.conclusion : newest.status} (${newest.url})`);
  }
  return { reused: newest.url, reason: `the queue commit's tree is the pull request head's, which contains the queue's base; the pull request was never retargeted; and the newest \`${GATE_CHECK}\` of ${GATE_WORKFLOW}'s runs for it against the queue's base passed: ${newest.url}` };
}

/**
 * Which lanes run. `changedFiles` is null when no base could be read;
 * `reused` is the run a queue entry reuses (`queueReuse`), which selects no
 * lane, the always-run one included. Returns `{ lanes: { <id>: boolean },
 * every: <reason> | null, measure: <reason> | null, reused: <run url> | null
 * }`, `measure` saying why every coverage lane runs.
 */
export function selectLanes({ event, changedFiles, reused = null }) {
  if (reused !== null) {
    return { lanes: Object.fromEntries(Object.keys(LANES).map((file) => [laneId(file), false])), every: null, measure: null, reused };
  }
  let every = null;
  const measure = changedFiles?.includes(COVERAGE_FLOORS)
    ? `the coverage floors changed (${COVERAGE_FLOORS}): every lane that measures a package runs, so each moved floor is judged`
    : null;
  if (event === "workflow_dispatch") {
    every = "workflow_dispatch: a manual run runs every lane";
  } else if (changedFiles === null) {
    every = "no base to compare with";
  } else {
    const hits = changedFiles.filter((file) =>
      EVERY_LANE.some((glob) => matchesGlob(glob, file)),
    );
    if (hits.length > 0) every = `the gate itself changed: ${hits.join(", ")}`;
  }
  const lanes = {};
  for (const [file, lane] of Object.entries(LANES)) {
    lanes[laneId(file)] =
      every !== null ||
      lane.always === true ||
      (measure !== null && COVERAGE_LANES.includes(file)) ||
      changedFiles.some((changed) =>
        lane.paths.some((glob) => matchesGlob(glob, changed)),
      );
  }
  return { lanes, every, measure, reused: null };
}

/**
 * The gate's verdict from its `needs` context: `{ ok, lines }`, one line per
 * lane and per gate job, plus the selection's own.
 */
export function verdict(needs) {
  const lines = [];
  let ok = true;
  const fail = (line) => {
    ok = false;
    lines.push(`FAIL ${line}`);
  };
  const selection = needs.lanes;
  if (selection?.result !== "success") {
    fail(`lanes: the selection did not succeed (${selection?.result ?? "absent"})`);
    return { ok, lines };
  }
  const reused = selection.outputs?.reused || null;
  lines.push(reused === null ? "ok   lanes: selection succeeded" : `ok   lanes: selection succeeded, reusing ${reused}`);
  for (const file of Object.keys(LANES)) {
    const id = laneId(file);
    const selected = selection.outputs?.[id];
    const result = needs[id]?.result;
    if (selected !== "true" && selected !== "false") {
      fail(`${id}: the selection gave no answer (${JSON.stringify(selected)})`);
    } else if (result === undefined) {
      fail(`${id}: not among Gate's needs`);
    } else if (reused !== null && (selected !== "false" || result !== "skipped")) {
      fail(`${id}: the run is reused, yet the lane was ${selected === "true" ? "needed" : "not needed"} and ${result}`);
    } else if (selected === "true" && result !== "success") {
      fail(`${id}: needed, and ${result}`);
    } else if (selected === "false" && result !== "skipped") {
      fail(`${id}: not needed, yet ${result}`);
    } else {
      lines.push(`ok   ${id}: ${reused !== null ? "reused" : selected === "true" ? "needed, passed" : "not needed"}`);
    }
  }
  for (const id of GATE_JOBS) {
    const result = needs[id]?.result;
    if (result === undefined) fail(`${id}: not among Gate's needs`);
    else if (reused !== null) {
      if (result !== "skipped") fail(`${id}: the run is reused, yet ${result}`);
      else lines.push(`ok   ${id}: reused`);
    } else if (result !== "success") fail(`${id}: ${result}`);
    else lines.push(`ok   ${id}: passed`);
  }
  return { ok, lines };
}

function parseFlags(argv) {
  const flags = { command: "select" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "verdict" && i === 0) {
      flags.command = "verdict";
      continue;
    }
    const [key, inline] = arg.split("=", 2);
    if (key !== "--base" && key !== "--head") {
      throw new Error(`ci-lanes: unknown argument "${arg}"`);
    }
    const value = inline ?? argv[++i];
    if (!value) throw new Error(`ci-lanes: ${key} needs a ref`);
    flags[key.slice(2)] = value;
  }
  return flags;
}

/**
 * The selection's step summary: the range, then the lanes it needs and why,
 * the reason every coverage lane runs included, so a reader sees why a change
 * to the floors alone ran them.
 */
export function selectionSummary({ range, changedFiles, lanes, every, measure, reuse = null }) {
  const needed = Object.entries(lanes).filter(([, run]) => run).map(([id]) => `\`${id}\``);
  return [
    "### Lanes this change needs",
    "",
    `Base \`${range.base ?? "(none)"}\` (${range.source}), head \`${range.head}\`, ${changedFiles?.length ?? "?"} changed file(s).`,
    ...(reuse === null ? [] : ["", reuse.reused === null ? `Not reused: ${reuse.reason}.` : `**Reused**: ${reuse.reason}.`]),
    "",
    every ? `**Every lane**: ${every}.` : `${needed.length} lane(s): ${needed.join(", ") || "none"}.`,
    ...(measure && !every ? ["", `**Every coverage lane**: ${measure}.`] : []),
  ].join("\n");
}

/** `gh api <args>`: stdout, trimmed; throws on a non-zero exit. */
function ghApi(args) {
  return execFileSync("gh", ["api", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 }).trim();
}

/** The first line a failed command wrote to stderr, else its message. */
function firstLine(error) {
  const stderr = String(error?.stderr ?? "").trim();
  return (stderr || String(error?.message ?? error)).split("\n")[0];
}

/**
 * What GitHub says about a merge-queue entry and the pull request it names,
 * for `queueReuse`. A read that fails, or answers what cannot be parsed,
 * leaves its field null rather than throwing, so it runs the lanes, and says
 * why through `warn` (stderr in CI), so reuse never stays off unexplained.
 * `gh` runs one `gh api` call (`ghApi` in CI, a fake in the tests).
 */
export function queueFacts(env, group, gh = ghApi, warn = (line) => console.error(line)) {
  const repo = env.GITHUB_REPOSITORY;
  const read = (args, parse = (text) => text) => {
    try {
      return parse(gh(args));
    } catch (error) {
      warn(`ci-lanes: queue reuse could not read ${args[0]}: ${firstLine(error)}`);
      return null;
    }
  };
  const unknown = { groupTree: null, headTree: null, compareStatus: null, retargeted: null, gateSuites: null, checkRuns: null };
  const ref = queueRef(group?.head_ref);
  if (ref === null || !group?.base_sha || !group?.head_sha) return unknown;
  const { pull, base } = ref;
  const headSha = read([`repos/${repo}/pulls/${pull}`, "--jq", ".head.sha"]);
  if (!headSha) return unknown;
  const tree = (sha) => read([`repos/${repo}/git/commits/${sha}`, "--jq", ".tree.sha"]) || null;
  const list = (text) => {
    const value = JSON.parse(text);
    if (!Array.isArray(value)) throw new Error("not a list");
    return value;
  };
  const retargets = RETARGET_EVENTS.map((event) => JSON.stringify(event)).join(", ");
  const ours = `.path == ${JSON.stringify(GATE_WORKFLOW)} and any(.pull_requests[]; .number == ${pull} and .base.ref == ${JSON.stringify(base)})`;
  return {
    groupTree: tree(group.head_sha),
    headTree: tree(headSha),
    compareStatus: read([`repos/${repo}/compare/${group.base_sha}...${headSha}`, "--jq", ".status"]) || null,
    retargeted: read([`repos/${repo}/issues/${pull}/timeline?per_page=100`, "--paginate", "--jq", `[.[] | select(.event | IN(${retargets}))] | length`], (text) =>
      text.split("\n").some((count) => Number(count) > 0)),
    gateSuites: read([`repos/${repo}/actions/runs?head_sha=${headSha}&event=pull_request&per_page=100`, "--jq", `[.workflow_runs[] | select(${ours}) | .check_suite_id]`], list),
    checkRuns: read(
      [`repos/${repo}/commits/${headSha}/check-runs?check_name=${GATE_CHECK}&per_page=100`, "--jq", "[.check_runs[] | {app: .app.slug, suite: .check_suite.id, status, conclusion, startedAt: .started_at, url: .html_url}]"],
      list,
    ),
  };
}

function select(flags, env) {
  const range = resolveRange(env, flags);
  const changedFiles =
    range.base === null ? null : changedFilesSince(range.base, range.head);
  if (range.base !== null && changedFiles === null) {
    throw new Error(`ci-lanes: git could not compare ${range.base} with ${range.head}`);
  }
  const reuse = env.GITHUB_EVENT_NAME === "merge_group" ? queueReuse(queueFacts(env, readEventPayload(env)?.merge_group)) : null;
  const { lanes, every, measure, reused } = selectLanes({ event: env.GITHUB_EVENT_NAME, changedFiles, reused: reuse?.reused ?? null });
  const lines = [...Object.entries(lanes).map(([id, run]) => `${id}=${run}`), `reused=${reused ?? ""}`];
  console.log(lines.join("\n"));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  const summary = selectionSummary({ range, changedFiles, lanes, every, measure, reuse });
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary + "\n");
  else console.log("\n" + summary);
  return 0;
}

function judge(env) {
  if (!env.GATE_NEEDS) throw new Error("ci-lanes verdict: GATE_NEEDS (toJSON(needs)) is unset");
  const { ok, lines } = verdict(JSON.parse(env.GATE_NEEDS));
  console.log(lines.join("\n"));
  if (env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      env.GITHUB_STEP_SUMMARY,
      ["### Gate", "", ok ? "Every lane this change needs passed." : "**Red.**", "", "```", ...lines, "```", ""].join("\n"),
    );
  }
  return ok ? 0 : 1;
}

function main(argv, env) {
  const flags = parseFlags(argv);
  return flags.command === "verdict" ? judge(env) : select(flags, env);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exit(main(process.argv.slice(2), process.env));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
