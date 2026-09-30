// A CI lane or a path-filtered deploy that builds a package outside the npm
// workspace runs when anything that package links changes.
// Run via `node --test scripts/lane-triggers.test.mjs` (wired into root `npm test`).
//
// ci.ts-workspace asks turbo which workspace packages a change reaches, so a
// workspace member's edges need no hand-kept list. The standalone packages
// (the server, the runner, the docs site, the extension consumer: their own
// lockfiles, outside the root `workspaces`) link libraries with `file:`
// specifiers turbo never sees, and the lanes that build them decide when to
// run from `paths:` lists kept by hand. A list that misses a link lets a change
// to that library merge without the lane that builds against it (#1055, where
// ci.stigmer-server ran for none of the four backend libs the server links),
// or reach main without the deploy that ships it (#1307, where stigmer.ai
// waited for the next site edit to pick up an SDK change).
//
// A lane watches a package when one of its trigger lists matches the package's
// manifest: the manifest declares the links, so a lane that triggers on it has
// taken on the package's dependency set. Lanes that trigger on packaging files
// alone (ci.compose-stack's Dockerfiles, ci.all-in-one's bundle scripts) leave
// source changes to the package's own lane, by design, and are not held to it.
// The closure follows `file:` links from the standalone package (all three of
// its install fields), then, from each package reached, `file:` links and
// workspace members named in what a consumer compiles or runs from it
// (dependencies, optionalDependencies, peerDependencies); a reached package's
// devDependencies are its own build tools.
//
// Trigger lists are each CI lane's list in scripts/ci-lanes.mjs (the map
// ci.gate.yaml selects lanes by), and `on.pull_request.paths`, `on.push.paths`
// and every dorny/paths-filter filter of every workflow, matched with the glob dialect
// the guidance gate already uses (`matchesGlob` in agents-check.mjs: `**`, `*`,
// `?`). Syntax outside it is refused, not guessed at: on `?` and `+` (GitHub
// quantifiers), `!` and the bracket forms, GitHub's filter, paths-filter's
// picomatch and that matcher disagree, and a guard that misread a list would
// pass green on it. The same goes for `paths-ignore` and non-string entries.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { parse } from "yaml";

import { matchesGlob } from "./agents-check.mjs";
import { LANES } from "./ci-lanes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The install fields a standalone package's own build reads. */
const OWN_FIELDS = ["dependencies", "devDependencies", "optionalDependencies"];
/** The fields of a reached package that its consumer compiles or runs. */
const REACHED_FIELDS = [
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
];
/** Pattern syntax the three readers of a trigger list do not agree on. */
const REFUSED_SYNTAX = /[{}[\]!?+]/;

/** Every tracked manifest below the root, as repo-relative POSIX directory -> manifest. */
export function trackedManifests(rootDir = root) {
  const listed = execFileSync(
    "git",
    ["ls-files", "-z", "--", ":(glob)**/package.json"],
    { cwd: rootDir, encoding: "utf8" },
  );
  const manifests = new Map();
  for (const file of listed.split("\0").filter(Boolean)) {
    const dir = posix.dirname(file);
    if (dir === ".") continue; // the workspace root itself
    manifests.set(dir, JSON.parse(readFileSync(join(rootDir, file), "utf8")));
  }
  return manifests;
}

/** The root `workspaces` members, as package name -> directory. */
export function workspaceDirsByName(rootDir, manifests) {
  const { workspaces } = JSON.parse(
    readFileSync(join(rootDir, "package.json"), "utf8"),
  );
  return new Map(workspaces.map((dir) => [manifests.get(dir).name, dir]));
}

/**
 * The directories a package links through the given fields: `file:` targets,
 * plus workspace members named by version when `byName` is given (a
 * standalone package cannot resolve those, so its own role passes none).
 */
function linksOf(dir, manifest, fields, byName) {
  const links = [];
  for (const field of fields) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (spec.startsWith("file:")) {
        links.push(
          posix.normalize(posix.join(dir, spec.slice("file:".length))),
        );
      } else if (byName?.has(name)) {
        links.push(byName.get(name));
      }
    }
  }
  return links;
}

/** Every package a standalone package's build reads through its links, sorted. */
export function linkClosure(dir, manifests, byName) {
  const reached = new Set();
  const visit = (from, fields, names) => {
    for (const target of linksOf(from, manifests.get(from), fields, names)) {
      if (target === dir || reached.has(target)) continue;
      if (!manifests.has(target)) {
        throw new Error(
          `${from}/package.json links ${target}, which has no tracked package.json`,
        );
      }
      reached.add(target);
      visit(target, REACHED_FIELDS, byName);
    }
  };
  visit(dir, OWN_FIELDS, undefined);
  return [...reached].sort();
}

/** The standalone packages: tracked manifests outside the root `workspaces`. */
export function standalonePackages(manifests, byName) {
  const members = new Set(byName.values());
  return [...manifests.keys()].filter((dir) => !members.has(dir)).sort();
}

/**
 * Every trigger list of one parsed workflow, plus the shapes this guard
 * refuses to interpret. A list is `{ kind, list, patterns }`: `kind` is the
 * event (`pull_request`, `push`), `filter`, or `gate` (the lane's list in
 * scripts/ci-lanes.mjs, passed as `gatePaths`), `list` a label for messages,
 * `patterns` its readable string entries (a refused entry is reported and
 * left out, so the other tests never match against it).
 */
export function triggerLists(workflow, gatePaths) {
  const raw = [];
  const refusals = [];
  if (gatePaths !== undefined) {
    raw.push({ kind: "gate", list: "scripts/ci-lanes.mjs LANES", entries: gatePaths });
  }
  for (const event of ["pull_request", "push"]) {
    const trigger = workflow.on?.[event];
    if (trigger?.["paths-ignore"] !== undefined) {
      refusals.push(`on.${event}.paths-ignore is not read by this guard`);
    }
    if (trigger?.paths !== undefined) {
      raw.push({
        kind: event,
        list: `on.${event}.paths`,
        entries: trigger.paths,
      });
    }
  }
  for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (!String(step.uses ?? "").startsWith("dorny/paths-filter@")) continue;
      const filters = parse(String(step.with?.filters ?? ""));
      if (filters === null || typeof filters !== "object") {
        refusals.push(
          `jobs.${jobId} "${step.name}": filters is not an inline map`,
        );
        continue;
      }
      for (const [key, entries] of Object.entries(filters)) {
        raw.push({
          kind: "filter",
          list: `jobs.${jobId} filter "${key}"`,
          entries,
        });
      }
    }
  }
  const lists = raw.map(({ kind, list, entries }) => {
    const patterns = [];
    for (const entry of Array.isArray(entries) ? entries : [entries]) {
      if (typeof entry !== "string") {
        refusals.push(
          `${list}: ${JSON.stringify(entry)} is not a plain path pattern`,
        );
      } else if (REFUSED_SYNTAX.test(entry)) {
        refusals.push(
          `${list}: "${entry}" uses syntax whose meaning GitHub, paths-filter and ` +
            "matchesGlob do not share; teach this guard that syntax before using it",
        );
      } else {
        patterns.push(entry);
      }
    }
    return { kind, list, patterns };
  });
  return { lists, refusals };
}

/** Whether a trigger list fires for a change to the package in `dir`. */
export function watches(patterns, dir) {
  return patterns.some((pattern) =>
    matchesGlob(pattern, `${dir}/package.json`),
  );
}

function readWorkflows(rootDir = root) {
  const dir = join(rootDir, ".github/workflows");
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => ({
      file,
      ...triggerLists(parse(readFileSync(join(dir, file), "utf8")), LANES[file]?.paths),
    }));
}

const manifests = trackedManifests();
const byName = workspaceDirsByName(root, manifests);
const closures = new Map(
  standalonePackages(manifests, byName).map((dir) => [
    dir,
    linkClosure(dir, manifests, byName),
  ]),
);
const workflows = readWorkflows();

/** Every (lane, list, standalone package) where the list watches the package. */
function watchedPairs() {
  const pairs = [];
  for (const { file, lists } of workflows) {
    for (const { list, patterns } of lists) {
      for (const dir of closures.keys()) {
        if (watches(patterns, dir)) pairs.push({ file, list, patterns, dir });
      }
    }
  }
  return pairs;
}

test("every trigger pattern is one this guard reads the way GitHub does", () => {
  const problems = workflows.flatMap(({ file, refusals }) =>
    refusals.map((refusal) => `${file} ${refusal}`),
  );
  assert.deepEqual(problems, []);
});

test("a lane that watches a standalone package watches every package it links", () => {
  const problems = [];
  for (const { file, list, patterns, dir } of watchedPairs()) {
    for (const link of closures.get(dir)) {
      if (!watches(patterns, link)) {
        problems.push(
          `${file} ${list} watches ${dir}, which links ${link}. ` +
            `Add "${link}/**" to that list.`,
        );
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the guard still finds the packages and lanes it exists for", () => {
  // If discovery, the YAML read or the matching broke, the tests above would
  // pass on nothing. These are the linking packages and lane pairs of today.
  const linking = [...closures].filter(([, links]) => links.length > 0);
  assert.deepEqual(
    linking.map(([dir]) => dir),
    [
      "backend/services/runner",
      "backend/services/stigmer-server",
      "site",
      "test/extension-consumer",
    ],
  );
  const pairs = new Set(watchedPairs().map((p) => `${p.file} ${p.dir}`));
  for (const expected of [
    "ci.stigmer-server.yaml backend/services/stigmer-server",
    "ci.stigmer-server.yaml test/extension-consumer",
    "ci.runner.yaml backend/services/runner",
    "ci.docs.yaml site",
    "release.website.yaml site",
    "release.sandbox-cloud.yaml backend/services/runner",
  ]) {
    assert.ok(pairs.has(expected), `no trigger list pairs ${expected}`);
  }
});

test("linkClosure follows file: and workspace links, and stops at a reached package's devDependencies", () => {
  const fake = new Map([
    ["svc", { devDependencies: { "@stigmer/a": "file:../libs/a" } }],
    [
      "libs/a",
      {
        name: "@stigmer/a",
        dependencies: { "@stigmer/b": "*" },
        devDependencies: { "@stigmer/c": "*" },
      },
    ],
    ["libs/b", { name: "@stigmer/b", peerDependencies: { "@stigmer/d": "*" } }],
    ["libs/c", { name: "@stigmer/c" }],
    ["libs/d", { name: "@stigmer/d" }],
  ]);
  const names = new Map([
    ["@stigmer/a", "libs/a"],
    ["@stigmer/b", "libs/b"],
    ["@stigmer/c", "libs/c"],
    ["@stigmer/d", "libs/d"],
  ]);
  assert.deepEqual(linkClosure("svc", fake, names), [
    "libs/a",
    "libs/b",
    "libs/d",
  ]);
});

test("triggerLists refuses the syntax and shapes it cannot read as GitHub does", () => {
  for (const pattern of [
    "!docs/**",
    "a/{b,c}/**",
    "a/[bc]/**",
    "a?/**",
    "a+/**",
  ]) {
    const { refusals } = triggerLists({ on: { push: { paths: [pattern] } } });
    assert.equal(refusals.length, 1, pattern);
  }
  const ignore = triggerLists({
    on: { pull_request: { "paths-ignore": ["x/**"] } },
  });
  assert.equal(ignore.refusals.length, 1);
  const external = triggerLists({
    jobs: {
      changes: {
        steps: [
          {
            name: "Filter",
            uses: "dorny/paths-filter@v3",
            with: { filters: ".github/filters.yaml" },
          },
        ],
      },
    },
  });
  assert.equal(external.refusals.length, 1);
  const plain = triggerLists({
    on: { push: { paths: ["backend/libs/ts/**", "Makefile"] } },
  });
  assert.deepEqual(plain.refusals, []);
  const gate = triggerLists({ jobs: {} }, ["backend/**", "a/{b,c}/**"]);
  assert.deepEqual(gate.lists[0].patterns, ["backend/**"], "a gate list is read");
  assert.equal(gate.refusals.length, 1, "and held to the same syntax");
});
