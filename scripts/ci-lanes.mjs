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
 * is in its own list, so editing one lane runs that lane.
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
 * where the decision is made.
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
import { changedFilesSince, resolveRange } from "./turbo-affected.mjs";

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
      "scripts/smoke-all-in-one.mjs",
      "scripts/lib/**",
      "scripts/publish-libs.mjs",
      "client-apps/cli/src/local/**",
      "client-apps/cli/src/commands/up.ts",
      "backend/services/runner/scripts/bundle-slim.mjs",
      "backend/services/stigmer-server/scripts/bundle-slim.mjs",
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
      "scripts/smoke-compose.mjs",
      // The whole lib, not one file: the smoke imports stigmer-smoke.mjs and
      // the build-from-source path runs bundle-slim.mjs, which imports
      // source-map-pragma.mjs (#1087).
      "scripts/lib/**",
      // The compose-runner image installs the CLI tarballs these two stage
      // (the stage script packs through publish-libs.mjs --only); a change
      // to either is a change to what the runner image contains.
      "scripts/stage-compose-runner-cli.mjs",
      "scripts/publish-libs.mjs",
      "backend/services/runner/Dockerfile.sandbox",
      "backend/services/stigmer-server/Dockerfile",
      "Makefile",
      ".github/workflows/ci.compose-stack.yaml",
    ],
  },
  "ci.conformance.yaml": {
    paths: [
      "backend/**",
      "test/conformance/**",
      "apis/**",
      ".github/workflows/ci.conformance.yaml",
    ],
  },
  "ci.conformance-execution.yaml": {
    paths: [
      "backend/**",
      "test/conformance/**",
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
      // The console-login stack shape runs the conformance harness's OIDC
      // issuer as a process.
      "test/conformance/src/harness/local-oidc-issuer*.ts",
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
      "scripts/smoke-helm.mjs",
      // The whole lib: the smoke imports stigmer-smoke.mjs (#1087).
      "scripts/lib/**",
      // The kind gate builds the compose-runner image, which installs the
      // CLI tarballs these two stage (ci.compose-stack lists them too).
      "scripts/stage-compose-runner-cli.mjs",
      "scripts/publish-libs.mjs",
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
      // scripts/lib/ is imported by this package's own scripts: bundle-slim.mjs
      // (source-map-pragma.mjs) and verify-slim-artifact.mjs / smoke-docker-
      // image.mjs (stigmer-smoke.mjs, the shared console-lane probe). A change
      // there must run this gate in its own PR (#1087: the probe's contract
      // moved and this lane went red on main).
      "scripts/lib/**",
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
};

/** A change to any of these could change the gate itself, so every lane runs. */
export const EVERY_LANE = [
  ".github/workflows/ci.gate.yaml",
  "scripts/ci-lanes.mjs",
  ".github/actions/**",
];

/** `ci.runner.yaml` -> `runner`: the lane's job id in ci.gate.yaml and its output name. */
export function laneId(file) {
  return file.replace(/^ci\./, "").replace(/\.ya?ml$/, "");
}

/**
 * Which lanes run. `changedFiles` is null when no base could be read.
 * Returns `{ lanes: { <id>: boolean }, every: <reason> | null }`.
 */
export function selectLanes({ event, changedFiles }) {
  let every = null;
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
      changedFiles.some((changed) =>
        lane.paths.some((glob) => matchesGlob(glob, changed)),
      );
  }
  return { lanes, every };
}

/**
 * The gate's verdict from its `needs` context: `{ ok, lines }`, one line per
 * lane plus the selection's own.
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

function select(flags, env) {
  const range = resolveRange(env, flags);
  const changedFiles =
    range.base === null ? null : changedFilesSince(range.base, range.head);
  if (range.base !== null && changedFiles === null) {
    throw new Error(`ci-lanes: git could not compare ${range.base} with ${range.head}`);
  }
  const { lanes, every } = selectLanes({ event: env.GITHUB_EVENT_NAME, changedFiles });
  const lines = Object.entries(lanes).map(([id, run]) => `${id}=${run}`);
  console.log(lines.join("\n"));
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  const needed = Object.entries(lanes).filter(([, run]) => run).map(([id]) => `\`${id}\``);
  const summary = [
    "### Lanes this change needs",
    "",
    `Base \`${range.base ?? "(none)"}\` (${range.source}), head \`${range.head}\`, ${changedFiles?.length ?? "?"} changed file(s).`,
    "",
    every ? `**Every lane**: ${every}.` : `${needed.length} lane(s): ${needed.join(", ") || "none"}.`,
  ].join("\n");
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
