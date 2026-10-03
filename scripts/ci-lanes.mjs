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
 * that watches a standalone package must watch everything it links, a lane
 * must watch every file an action it calls runs, what its steps set up and
 * install from, and the Makefile and scripts behind the `make` targets its
 * steps call).
 *
 * Every lane runs when the gate itself could have changed: this script, the
 * orchestrator, or a composite action the lanes use (`EVERY_LANE`); on a
 * manual dispatch; and when no base can be read. turbo-affected.mjs counts an
 * action's folder as workspace tooling, so in the always-run lane every job
 * that calls the action runs too. A lane's own workflow file
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
 * whenever the selection did, whichever lanes ran.
 *
 * Outputs of the selection (stdout; appended to GITHUB_OUTPUT when set):
 *   <lane id>=true|false      one per lane in LANES, e.g. runner=true
 * A summary goes to GITHUB_STEP_SUMMARY when set, for both commands.
 *
 * Usage:
 *   node scripts/ci-lanes.mjs                      # in CI, from the event
 *   node scripts/ci-lanes.mjs --base origin/main   # at a terminal
 *   GATE_NEEDS='<toJSON(needs)>' node scripts/ci-lanes.mjs verdict
 * Exit: 0 selected / passed, 1 the verdict failed, 2 the script could not
 * judge (a usage or git error).
 */

import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { matchesGlob } from "./agents-check.mjs";
import { COVERAGE_FLOORS, changedFilesSince, resolveRange } from "./turbo-affected.mjs";

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
      // The Makefile that defines the targets the lane's steps call, and the
      // targets those pull in (scripts/lane-triggers.test.mjs fails when it, or
      // a script a reached recipe runs, is missing).
      "Makefile",
      // What the lane's steps set up and install from: the Node version, and
      // the root manifest and lockfile, decide everything its `npm ci` puts on
      // disk and runs (scripts/lane-triggers.test.mjs fails when one is missing).
      ".nvmrc",
      "package.json",
      "package-lock.json",
      ".github/workflows/ci.all-in-one.yaml",
    ],
  },
  "ci.authorization-model.yaml": {
    paths: [
      "backend/services/stigmer-server/fga/**",
      "backend/services/stigmer-server/src/authorization/model/data/**",
      "tools/codegen/src/authorization-model/**",
      "tools/codegen/package.json",
      // The Makefile its steps' targets come from (ci.all-in-one says why).
      "Makefile",
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
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
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
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
      // The Makefile its steps' targets come from (ci.all-in-one says why).
      "Makefile",
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
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
      // The server's packaging script, which `make smoke-compose` runs
      // (scripts/lane-triggers.test.mjs fails when it is missing).
      "backend/services/stigmer-server/scripts/bundle-slim.mjs",
      // The runner's model path (ci.all-in-one says why these files).
      "backend/services/runner/src/shared/model-client.ts",
      "backend/services/runner/src/shared/llm-backend.ts",
      "backend/services/runner/src/shared/llm-proxy.ts",
      "Makefile",
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
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
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
      ".github/workflows/ci.conformance.yaml",
    ],
  },
  "ci.conformance-execution.yaml": {
    paths: [
      "backend/**",
      "test/conformance/**",
      "test/support/**",
      "apis/**",
      // The CLI, run from source: `make install-cli-shim` gives the suites
      // `stigmer`, because memory-enabled executions spawn `stigmer mcp-server`
      // (the workflow says why). Its source holds the Temporal CLI's pin,
      // downloader and the errors it exits with too; the installer is beside it
      // (scripts/lane-triggers.test.mjs fails when any is missing). What the
      // CLI imports by package name (@stigmer/sdk and the others) is not
      // traced, as that guard's header says, so their changes reach this lane
      // only through the paths above.
      "client-apps/cli/src/**",
      "client-apps/cli/scripts/install-temporal-cli.ts",
      // The tsconfig the shim passes tsx. The guard traces scripts, not
      // configuration, so this one is kept by hand.
      "tsconfig.tsx.json",
      // The Makefile its steps' targets come from (ci.all-in-one says why).
      "Makefile",
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
      ".github/workflows/ci.conformance-execution.yaml",
    ],
  },
  "ci.crate.yaml": {
    paths: [
      "crates/stigmer-runner-host/**",
      "backend/services/runner/src/ipc-protocol.ts",
      "backend/services/runner/src/ipc-protocol-fixtures.ts",
      // The Makefile its steps' targets come from (ci.all-in-one says why).
      "Makefile",
      // The Node version the lane sets up (ci.all-in-one says why).
      ".nvmrc",
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
      // The Makefile its steps' targets come from (ci.all-in-one says why).
      "Makefile",
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
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
      // The Temporal CLI the suites run against: its pin, downloader, installer
      // and the errors it exits with (scripts/lane-triggers.test.mjs fails when
      // one is missing).
      "client-apps/cli/src/local/artifact.ts",
      "client-apps/cli/src/local/temporal/download.ts",
      "client-apps/cli/scripts/install-temporal-cli.ts",
      "client-apps/cli/src/errors/cli-exit-error.ts",
      "client-apps/cli/src/errors/exit-codes.ts",
      // The Chromium every job here installs: .github/actions/playwright-chromium
      // runs it (scripts/lane-triggers.test.mjs fails when it is missing).
      "scripts/playwright-chromium.mjs",
      // The Makefile its steps' targets come from (ci.all-in-one says why).
      "Makefile",
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
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
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
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
      // The server's packaging script, which `make smoke-helm` runs
      // (scripts/lane-triggers.test.mjs fails when it is missing).
      "backend/services/stigmer-server/scripts/bundle-slim.mjs",
      // The runner's model path (ci.all-in-one says why these files).
      "backend/services/runner/src/shared/model-client.ts",
      "backend/services/runner/src/shared/llm-backend.ts",
      "backend/services/runner/src/shared/llm-proxy.ts",
      "Makefile",
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
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
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
      ".github/workflows/ci.java-sdk.yaml",
    ],
  },
  "ci.plugins-static.yaml": {
    paths: [
      "plugins/**",
      "backend/libs/ts/plugin-package/**",
      // The Makefile its steps' targets come from (ci.all-in-one says why).
      "Makefile",
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
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
      // The server's sandbox-name derivation: the runner's attach waiter
      // derives the same name, and src/attach/__tests__/push.test.ts loads
      // this file and compares the two, so a server-only change to it must
      // run this lane too.
      "backend/services/stigmer-server/src/sandbox/naming.ts",
      "Makefile",
      // The Node version the lane sets up (ci.all-in-one says why).
      ".nvmrc",
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
      // The Node version the lane sets up (ci.all-in-one says why).
      ".nvmrc",
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
      // The server's packaging script, which the compose, Helm and CLI
      // rehearsals run (scripts/lane-triggers.test.mjs fails when it is missing).
      "backend/services/stigmer-server/scripts/bundle-slim.mjs",
      "Makefile",
      // What the lane sets up and installs from (ci.all-in-one says why).
      ".nvmrc",
      "package.json",
      "package-lock.json",
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

/**
 * Which lanes run. `changedFiles` is null when no base could be read.
 * Returns `{ lanes: { <id>: boolean }, every: <reason> | null, measure:
 * <reason> | null }`, `measure` saying why every coverage lane runs.
 */
export function selectLanes({ event, changedFiles }) {
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
  return { lanes, every, measure };
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
  lines.push("ok   lanes: selection succeeded");
  for (const file of Object.keys(LANES)) {
    const id = laneId(file);
    const selected = selection.outputs?.[id];
    const result = needs[id]?.result;
    if (selected !== "true" && selected !== "false") {
      fail(`${id}: the selection gave no answer (${JSON.stringify(selected)})`);
    } else if (result === undefined) {
      fail(`${id}: not among Gate's needs`);
    } else if (selected === "true" && result !== "success") {
      fail(`${id}: needed, and ${result}`);
    } else if (selected === "false" && result !== "skipped") {
      fail(`${id}: not needed, yet ${result}`);
    } else {
      lines.push(`ok   ${id}: ${selected === "true" ? "needed, passed" : "not needed"}`);
    }
  }
  for (const id of GATE_JOBS) {
    const result = needs[id]?.result;
    if (result === undefined) fail(`${id}: not among Gate's needs`);
    else if (result !== "success") fail(`${id}: ${result}`);
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
export function selectionSummary({ range, changedFiles, lanes, every, measure }) {
  const needed = Object.entries(lanes).filter(([, run]) => run).map(([id]) => `\`${id}\``);
  return [
    "### Lanes this change needs",
    "",
    `Base \`${range.base ?? "(none)"}\` (${range.source}), head \`${range.head}\`, ${changedFiles?.length ?? "?"} changed file(s).`,
    "",
    every ? `**Every lane**: ${every}.` : `${needed.length} lane(s): ${needed.join(", ") || "none"}.`,
    ...(measure && !every ? ["", `**Every coverage lane**: ${measure}.`] : []),
  ].join("\n");
}

function select(flags, env) {
  const range = resolveRange(env, flags);
  const changedFiles =
    range.base === null ? null : changedFilesSince(range.base, range.head);
  if (range.base !== null && changedFiles === null) {
    throw new Error(`ci-lanes: git could not compare ${range.base} with ${range.head}`);
  }
  const { lanes, every, measure } = selectLanes({ event: env.GITHUB_EVENT_NAME, changedFiles });
  const lines = Object.entries(lanes).map(([id, run]) => `${id}=${run}`);
  console.log(lines.join("\n"));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  const summary = selectionSummary({ range, changedFiles, lanes, every, measure });
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
