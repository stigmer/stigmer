#!/usr/bin/env node

/**
 * Decides which workspace packages a CI run must cover, from what changed.
 *
 * The TS workspace lane (.github/workflows/ci.ts-workspace.yaml) runs on every
 * pull request and push with no `paths:` filter, and its first job asks this
 * script what the rest of the lane should touch. The answer is a list of
 * package names the other jobs hand to scripts/turbo-set.mjs as `--only`, so
 * the same task graph that builds the repo also decides how much of it a
 * change exercises. Before this, each lane carried a hand-written `paths:`
 * list that approximated the package graph (and said so in its comments).
 *
 * The question is put to `turbo query affected --tasks ...`, the TASK-level
 * form, not `turbo run --affected`, which is package-level. The difference
 * matters here: two suites read fixtures that live outside any package
 * (turbo.json widens their `inputs`: apis/testdata/hitl/file-review for
 * @stigmer/sdk#test, test/fixtures/tool-view for sdk and react). The
 * package-level view attributes such a change to the root and runs nothing;
 * the task-level view names the suites (measured 2026-09-11, stigmer-cloud
 * project 20260904.04, T01_6).
 *
 * Reading turbo's answer: a task's `reason.__typename` is `TaskFileChanged`
 * (its own inputs moved), `TaskDependencyTaskChanged` (an upstream task did),
 * `TaskGlobalFileChanged` (turbo.json moved: everything), or `TaskAllChanged`,
 * which turbo uses for the UPSTREAM tasks an affected task will pull in
 * (protos#build under sdk#test; embed#build and theme#build under web#build
 * while neither package changed). Those run anyway through `^build` when the
 * jobs run, so they do not make their package "affected" here. Any typename
 * this script does not know is treated as affected, the conservative side.
 *
 * Three cases run everything, each because turbo cannot see the change:
 *
 *   - `workflow_dispatch`: a manual run is "run it" (the ci.docs convention).
 *   - the lane's own workflow file, or the workspace's own tooling
 *     (WORKSPACE_TOOLING: the root manifests and scripts/**), changed. Turbo
 *     attributes these to the root package and no task; but a root
 *     devDependency bump (tsx, @tailwindcss/cli) is what several build scripts
 *     run, and a change to this lane must exercise this lane.
 *   - turbo could not compare (no base ref, an SCM error): its own fallback
 *     is to run everything, made visible here as a `::warning::` so a
 *     misconfigured base is never a quietly-full run forever.
 *
 * The base ref is derived from GitHub's own event, not left to turbo's
 * detection, so the summary can print it: a pull request compares with
 * `origin/<base branch>`, a push with the event's `before`, anything else
 * (a developer at a terminal) with origin/main unless --base says otherwise.
 *
 * Outputs (always on stdout; appended to GITHUB_OUTPUT when set):
 *   packages=<JSON array of names, workspace order>
 *   <set>=true|false          one per set in turbo-set.mjs (libs, ...)
 *   everything=true|false
 * A summary table (base, head, package, reason) goes to GITHUB_STEP_SUMMARY
 * when set.
 *
 * Usage:
 *   node scripts/turbo-affected.mjs                      # in CI, from the event
 *   node scripts/turbo-affected.mjs --base origin/main   # at a terminal
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { SETS, runTurbo, workspaceSet } from "./turbo-set.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The tasks the lane runs; turbo is asked about exactly these. */
export const LANE_TASKS = ["build", "typecheck", "lint", "test", "test:a11y"];

/**
 * Root-level paths whose change means every package must run. Turbo sees
 * these as the root package `//` with no task of its own. Prefix match on
 * the directory entry.
 */
export const WORKSPACE_TOOLING = [
  "package.json",
  "package-lock.json",
  "scripts/",
];

/** Turbo's word for "an upstream task the run pulls in", not a changed task. */
const UPSTREAM_ONLY = new Set(["TaskAllChanged"]);
const KNOWN_REASONS = new Set([
  "TaskFileChanged",
  "TaskDependencyTaskChanged",
  "TaskGlobalFileChanged",
  "TaskAllChanged",
]);

const ZERO_SHA = /^0{40}$/;

/**
 * The comparison range from GitHub's environment (or the caller's flags).
 * Returns `{ base, head, source }`; `base` is null only when a push event
 * carries no usable `before` (a new branch), which the caller treats as an
 * SCM fallback.
 */
export function resolveRange(env, flags = {}, readEvent = readEventPayload) {
  const head = flags.head ?? "HEAD";
  if (flags.base) return { base: flags.base, head, source: "--base" };
  if (env.GITHUB_EVENT_NAME === "pull_request" && env.GITHUB_BASE_REF) {
    return {
      base: `origin/${env.GITHUB_BASE_REF}`,
      head,
      source: "pull_request base branch",
    };
  }
  if (env.GITHUB_EVENT_NAME === "push") {
    const before = readEvent(env)?.before;
    if (typeof before === "string" && before && !ZERO_SHA.test(before)) {
      return { base: before, head, source: "push event `before`" };
    }
    return { base: null, head, source: "push event without a usable `before`" };
  }
  return { base: "origin/main", head, source: "default" };
}

function readEventPayload(env) {
  if (!env.GITHUB_EVENT_PATH) return null;
  return JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, "utf8"));
}

/** `.github/workflows/<file>` from GITHUB_WORKFLOW_REF, or null outside CI. */
export function workflowFileOf(env) {
  const ref = env.GITHUB_WORKFLOW_REF;
  if (!ref) return null;
  const match = /^[^/]+\/[^/]+\/(.+?)@/.exec(ref);
  return match ? match[1] : null;
}

/**
 * Why everything must run, from the event and the changed file list, or
 * null when the package graph's answer stands.
 */
export function everythingBecause(env, changedFiles) {
  if (env.GITHUB_EVENT_NAME === "workflow_dispatch") {
    return "workflow_dispatch: a manual run runs everything";
  }
  const workflow = workflowFileOf(env);
  const hits = changedFiles.filter(
    (file) =>
      (workflow && file === workflow) ||
      WORKSPACE_TOOLING.some(
        (path) =>
          file === path || (path.endsWith("/") && file.startsWith(path)),
      ),
  );
  if (hits.length > 0) {
    return `workspace tooling changed: ${hits.join(", ")}`;
  }
  return null;
}

/**
 * Turbo's task-level answer, reduced. `packages` are the names of tasks whose
 * reason is not upstream-only; `rows` keep every task for the summary;
 * `fallback` is turbo's own error text when it could not compare.
 */
export function readAffected(query) {
  if (query.errors?.length) {
    // One line: a `::warning::` annotation keeps only its first line.
    return {
      packages: [],
      rows: [],
      fallback: query.errors
        .map((e) => e.message.replace(/\s+/g, " ").trim())
        .join("; "),
    };
  }
  const items = query.data?.affectedTasks?.items ?? [];
  const packages = new Set();
  const rows = [];
  for (const item of items) {
    const reason = item.reason?.__typename ?? "unknown";
    const name = item.package?.name;
    if (!name || name === "//") continue;
    const upstreamOnly = UPSTREAM_ONLY.has(reason);
    rows.push({ package: name, task: item.name, reason, upstreamOnly });
    if (!upstreamOnly) packages.add(name);
    if (!KNOWN_REASONS.has(reason)) {
      rows.at(-1).note = "unknown reason type, treated as affected";
    }
  }
  return { packages: [...packages], rows, fallback: null };
}

/**
 * The decision: the package list in workspace order, a reason when it is
 * everything, and the rows behind it.
 */
export function decide({ env, changedFiles, query, workspace }) {
  const because = everythingBecause(env, changedFiles);
  if (because) {
    return {
      packages: workspace,
      everything: because,
      rows: [],
      warning: null,
    };
  }
  const { packages, rows, fallback } = readAffected(query);
  if (fallback !== null) {
    return {
      packages: workspace,
      everything: `turbo could not compare: ${fallback}`,
      rows: [],
      warning: `turbo-affected: falling back to every package (${fallback})`,
    };
  }
  const inWorkspace = new Set(packages);
  return {
    packages: workspace.filter((name) => inWorkspace.has(name)),
    everything: null,
    rows,
    warning: null,
  };
}

/** GITHUB_OUTPUT lines: the list, one boolean per set, the everything flag. */
export function outputLines(decision, setsByName) {
  const selected = new Set(decision.packages);
  const lines = [
    `packages=${JSON.stringify(decision.packages)}`,
    `everything=${decision.everything !== null}`,
  ];
  for (const [set, members] of Object.entries(setsByName)) {
    lines.push(`${set}=${members.some((name) => selected.has(name))}`);
  }
  return lines;
}

/** The step summary, Markdown. */
export function summaryMarkdown(decision, range) {
  const lines = [
    "### Affected packages",
    "",
    `Base \`${range.base ?? "(none)"}\` (${range.source}), head \`${range.head}\`.`,
    "",
  ];
  if (decision.everything) {
    lines.push(
      `**Everything** (${decision.packages.length} packages): ${decision.everything}.`,
    );
    return lines.join("\n") + "\n";
  }
  if (decision.packages.length === 0) {
    lines.push("No package is affected; every job below is skipped.");
    return lines.join("\n") + "\n";
  }
  lines.push(
    `${decision.packages.length} package(s): ${decision.packages.map((p) => `\`${p}\``).join(", ")}`,
    "",
    "| task | reason |",
    "|---|---|",
  );
  for (const row of decision.rows) {
    const tag = row.upstreamOnly
      ? " (upstream of an affected task; runs via ^build)"
      : "";
    const note = row.note ? ` — ${row.note}` : "";
    lines.push(
      `| \`${row.package}#${row.task}\` | ${row.reason}${tag}${note} |`,
    );
  }
  return lines.join("\n") + "\n";
}

function changedFilesSince(base, head) {
  const mergeBase = spawnSync("git", ["merge-base", base, head], {
    cwd: root,
    encoding: "utf8",
  });
  if (mergeBase.status !== 0) return null;
  // No explicit head: compares the merge-base with the working tree, the same
  // view turbo takes (uncommitted edits count), so a terminal run is honest.
  const diff = spawnSync(
    "git",
    ["diff", "--name-only", mergeBase.stdout.trim()],
    {
      cwd: root,
      encoding: "utf8",
    },
  );
  if (diff.status !== 0) return null;
  return diff.stdout.split("\n").filter(Boolean);
}

function queryAffected(range) {
  const args = [
    "query",
    "affected",
    "--tasks",
    ...LANE_TASKS,
    "--base",
    range.base,
  ];
  if (range.head !== "HEAD") args.push("--head", range.head);
  const result = runTurbo(args, { stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) {
    throw new Error(
      `turbo-affected: could not start turbo: ${result.error.message}`,
    );
  }
  const stdout = result.stdout.toString("utf8");
  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error(
      `turbo-affected: turbo query returned no JSON (exit ${result.status}):\n${result.stderr}`,
    );
  }
}

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [key, inline] = arg.split("=", 2);
    if (key !== "--base" && key !== "--head") {
      throw new Error(`turbo-affected: unknown argument "${arg}"`);
    }
    const value = inline ?? argv[++i];
    if (!value) throw new Error(`turbo-affected: ${key} needs a ref`);
    flags[key.slice(2)] = value;
  }
  return flags;
}

function main(argv, env) {
  const flags = parseFlags(argv);
  const range = resolveRange(env, flags);
  const workspace = workspaceSet();

  let changedFiles = [];
  let query = { errors: [{ message: `no base ref (${range.source})` }] };
  if (range.base !== null) {
    changedFiles = changedFilesSince(range.base, range.head) ?? [];
    query = queryAffected(range);
  }

  const decision = decide({ env, changedFiles, query, workspace });
  const setsByName = Object.fromEntries(
    Object.entries(SETS).map(([set, resolver]) => [set, resolver()]),
  );

  if (decision.warning) console.log(`::warning::${decision.warning}`);
  // The outputs always go to the log too: the step summary is a page away,
  // and someone reading a skipped job's cause should find it in the gate's
  // plain log as well.
  const lines = outputLines(decision, setsByName);
  console.log(lines.join("\n"));
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  }
  const summary = summaryMarkdown(decision, range);
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary);
  else console.log("\n" + summary);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exit(main(process.argv.slice(2), process.env));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}
