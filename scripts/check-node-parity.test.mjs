// `make check` runs every check the TypeScript workspace lane runs.
// Run via `node --test scripts/check-node-parity.test.mjs` (wired into root `npm test`).
//
// Contributors are told to run `make check` before a pull request, so a local
// green must mean what ci.ts-workspace's green means. Before this guard,
// check-node was a hand-written list of per-package calls. The lane runs
// scripts/turbo-set.mjs sets, which pick up a new workspace member by
// themselves, while the Makefile list did not, and the two drifted (#1059).
// This test reads both files and fails, naming the call, when the lane runs
// something `make check` does not reach.
//
// What counts as a check, read from each `run:` line of every lane job:
//   - `node scripts/turbo-set.mjs <set> <task>`. The lane narrows a set to the
//     packages its gate found affected (`--only="$AFFECTED"`) and `make check`
//     runs the whole set, so an `$AFFECTED` narrowing is dropped. A literal
//     `--only=<name>` is part of the check (web's suite is not desktop's).
//   - `make <target>`: that target is reached from `check`.
//   - `node scripts/verify-*.mjs`: the gate scripts that are not turbo tasks.
//     Their flags are dropped, for the same reason as `$AFFECTED`.
//   - `npm run <root script>` and `npm test`, expanded through the root
//     package.json into the calls above. After a `cd` in the same command the
//     script is another package's, and it is not expanded.
// Everything else (installs, turbo-affected.mjs's package decision, the
// clean-room job's lockfile-free install and bare tsc passes) is not a check
// `make check` could share.
//
// The Makefile side starts at `check` and follows every `$(MAKE) <target>` in
// the recipes it reaches, collecting the same calls and every target it
// passes through. A recipe is the tab-indented lines right after its
// `target:` line, which is make's own rule. Backslash continuations are
// joined, and `$(MAKE) -C <dir>` is another Makefile and is not followed.
//
// A lane call `make check` deliberately does not run goes in EXEMPT with its
// reason. An exemption the lane no longer makes fails too, so the list cannot
// outlive its reason.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { parse } from "yaml";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const LANE = ".github/workflows/ci.ts-workspace.yaml";

/** Lane checks `make check` does not run, each with the reason. */
const EXEMPT = new Map([
  [
    "turbo-set workspace test:a11y --only=@stigmer/react",
    "the browser-mode suite needs a real Chromium (playwright install --with-deps), which the local gate does not provision",
  ],
  [
    "turbo-set libs test --only=@stigmer/react",
    "not a separate check: `turbo-set libs test` runs the React suite with the other libs; the lane only gives its coverage run and its vmForks run a job each",
  ],
]);

const TURBO_SET = /^node scripts\/turbo-set\.mjs\s+(\S+)\s+(\S+)(.*)$/;
const VERIFY = /^node scripts\/(verify-[\w-]+\.mjs)(?:\s|$)/;
const MAKE_CALL = /^make\s+(.+)$/;
const NPM_SCRIPT = /^npm run ([\w:.-]+)$/;
const ONLY = /--only=(\S+)/;

/**
 * The checks one shell command names: an array of check strings, empty for a
 * command that is not a check. `scripts` is the root package.json's scripts,
 * for expanding `npm run <script>` and `npm test`.
 */
export function callsOf(command, scripts) {
  const calls = [];
  let atRoot = true;
  for (const part of command.split("&&").map((p) => p.trim())) {
    if (/^cd\s/.test(part)) {
      atRoot = false;
      continue;
    }
    const turbo = TURBO_SET.exec(part);
    if (turbo) {
      const [, set, task, rest] = turbo;
      const only = ONLY.exec(rest)?.[1];
      const literal = only && !only.includes("$") ? ` --only=${only}` : "";
      calls.push(`turbo-set ${set} ${task}${literal}`);
      continue;
    }
    const verify = VERIFY.exec(part);
    if (verify) {
      calls.push(`node scripts/${verify[1]}`);
      continue;
    }
    const make = MAKE_CALL.exec(part);
    if (make) {
      for (const target of makeTargets(make[1])) calls.push(`make ${target}`);
      continue;
    }
    const script = part === "npm test" ? "test" : NPM_SCRIPT.exec(part)?.[1];
    if (script !== undefined && atRoot) {
      const body = scripts[script];
      if (body === undefined) {
        throw new Error(`"${part}" names no root package.json script`);
      }
      calls.push(...callsOf(body, scripts));
    }
  }
  return calls;
}

/**
 * The targets of a make invocation's arguments: flags and variables dropped,
 * nothing for `-C <dir>` (another Makefile).
 */
function makeTargets(args) {
  const words = args.split(/\s+/).filter(Boolean);
  if (words.includes("-C")) return [];
  return words.filter((w) => !w.startsWith("-") && !w.startsWith("$"));
}

/** Every check the lane's jobs run, from their `run:` blocks. */
export function laneCalls(workflow, scripts) {
  const calls = new Set();
  for (const job of Object.values(workflow.jobs)) {
    for (const step of job.steps ?? []) {
      if (typeof step.run !== "string") continue;
      for (const line of joinContinuations(step.run.split("\n"))) {
        for (const call of callsOf(line.trim(), scripts)) calls.add(call);
      }
    }
  }
  return calls;
}

function joinContinuations(lines) {
  const joined = [];
  let pending = "";
  for (const line of lines) {
    if (line.trimEnd().endsWith("\\")) {
      pending += line.trimEnd().slice(0, -1) + " ";
      continue;
    }
    joined.push(pending + line);
    pending = "";
  }
  if (pending) joined.push(pending);
  return joined;
}

/** Target name -> its recipe's commands, continuations joined, comments dropped. */
export function recipes(makefile) {
  const byTarget = new Map();
  const lines = makefile.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const header = /^([A-Za-z0-9_.-]+):(?!=)/.exec(lines[i]);
    if (!header) continue;
    const body = [];
    let j = i + 1;
    while (j < lines.length && lines[j].startsWith("\t")) body.push(lines[j++]);
    const commands = joinContinuations(body)
      .map((line) => line.trim().replace(/^[@-]+/, ""))
      .filter((line) => line && !line.startsWith("#"));
    byTarget.set(header[1], commands);
  }
  return byTarget;
}

/**
 * Every check `make <start>` reaches: the calls in its recipe and in every
 * recipe a `$(MAKE) <target>` leads to, plus `make <target>` for each target
 * passed through.
 */
export function makeCalls(makefile, scripts, start = "check") {
  const byTarget = recipes(makefile);
  const calls = new Set();
  const seen = new Set();
  const visit = (target) => {
    if (seen.has(target)) return;
    seen.add(target);
    calls.add(`make ${target}`);
    const commands = byTarget.get(target);
    if (commands === undefined) {
      throw new Error(`the Makefile has no target "${target}"`);
    }
    for (const command of commands) {
      const sub = /^\$\(MAKE\)\s+(.+)$/.exec(command);
      if (sub) {
        for (const next of makeTargets(sub[1])) visit(next);
        continue;
      }
      for (const call of callsOf(command, scripts)) calls.add(call);
    }
  };
  visit(start);
  return calls;
}

const scripts = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
).scripts;
const lane = laneCalls(parse(readFileSync(join(root, LANE), "utf8")), scripts);
const local = makeCalls(readFileSync(join(root, "Makefile"), "utf8"), scripts);

test("the readers find the lane's checks, so a pass is not vacuous", () => {
  for (const call of [
    "turbo-set workspace typecheck",
    "turbo-set workspace lint",
    "turbo-set libs build",
    "turbo-set libs test",
    "turbo-set root test:root",
    "turbo-set workspace test --only=web",
    "node scripts/verify-esm-node.mjs",
    "make test-desktop-rust",
  ]) {
    assert.ok(lane.has(call), `the lane reader lost ${call}`);
  }
  assert.ok(local.has("make check-node"), "check reaches check-node");
});

test("make check runs every check ci.ts-workspace runs, or the call is exempt with its reason", () => {
  const missing = [...lane].filter((c) => !local.has(c) && !EXEMPT.has(c));
  assert.deepEqual(
    missing,
    [],
    `ci.ts-workspace runs checks \`make check\` does not reach: ${missing.join("; ")}. ` +
      "Add each to check-node (or check-prep), or to EXEMPT in this file with the reason.",
  );
});

test("every exemption is still a lane call and is not also run locally", () => {
  for (const call of EXEMPT.keys()) {
    assert.ok(
      lane.has(call),
      `EXEMPT names ${call}, which the lane no longer runs`,
    );
    assert.ok(
      !local.has(call),
      `EXEMPT names ${call}, which make check now runs`,
    );
  }
});

test("a lane check the Makefile drops is reported by name", () => {
  const workflow = {
    jobs: {
      verify: {
        steps: [
          { run: "npm ci" },
          {
            run: 'node scripts/turbo-set.mjs workspace typecheck --only="$AFFECTED"',
          },
          { run: "node scripts/turbo-set.mjs workspace test --only=web" },
          { run: "make verify-web-routing" },
          { run: 'node scripts/verify-esm-node.mjs --only="$AFFECTED"' },
        ],
      },
    },
  };
  const makefile = [
    "check:",
    "\t$(MAKE) check-prep",
    "\t$(MAKE) -j$(JOBS) check-node",
    "",
    "check-prep:",
    "\tnpm run build:libs",
    "check-node: dep ## a bucket",
    "\t# a comment line is not a command",
    "\tnode scripts/turbo-set.mjs workspace typecheck",
    "\t$(MAKE) -C site lint",
    "\t@node scripts/verify-esm-node.mjs",
    "",
    "verify-web-routing:",
    "\tnode scripts/verify-static-export-routes.mjs",
    "\tcd backend/services/runner && npm run not-a-root-script",
  ].join("\n");
  const fake = { "build:libs": "node scripts/turbo-set.mjs libs build" };
  const fromLane = laneCalls(workflow, fake);
  const fromMake = makeCalls(makefile, fake);
  assert.deepEqual(
    [...fromLane].filter((c) => !fromMake.has(c)),
    ["turbo-set workspace test --only=web", "make verify-web-routing"],
    "the dropped suite and the unreached target are named; the $AFFECTED narrowing and the flagged verify script match",
  );
  assert.ok(
    fromMake.has("turbo-set libs build"),
    "npm run expands through the root scripts",
  );
  assert.ok(
    !fromMake.has("make site"),
    "-C starts another Makefile and is not followed",
  );
});

test("a make target the Makefile does not define is refused, not skipped", () => {
  assert.throws(
    () => makeCalls("check:\n\t$(MAKE) nope\n", {}),
    /no target "nope"/,
  );
});
