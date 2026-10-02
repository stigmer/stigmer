// A CI lane runs when anything it builds against, runs through a composite
// action, or sets up and installs from, changes: a lane or a path-filtered
// deploy that builds a package outside the npm workspace runs when anything
// that package links changes, a gate lane runs when any file an action it
// calls runs changes, and a gate lane runs when the toolchain version file,
// manifest or lockfile its steps set up and install from changes.
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
//
// The action rule. A composite action's own folder under .github/actions is
// in every lane's trigger list (EVERY_LANE in scripts/ci-lanes.mjs), but a
// file it runs from elsewhere in the tree is not (#1710: the Playwright
// installer's body, scripts/playwright-chromium.mjs, ran none of the seven
// interactive e2e jobs that call it). So for every lane in that map, every
// action it calls and every file of that action (its own folder, each file a
// `run:` step names as "$GITHUB_WORKSPACE/<path>", each .mjs or .ts body in
// its folder it names as "$GITHUB_ACTION_PATH/<path>", and what those import
// by relative path), a change to the file must select the lane. `selectLanes` is
// asked, so the gate's own answer is the one checked. The always-on lane
// decides job by job inside, so there the file must also run every package
// (`everythingBecause` in scripts/turbo-affected.mjs), or the job that calls
// the action can skip. What the guard sees but cannot place is refused, as
// trigger syntax is above: a script word under neither $GITHUB_WORKSPACE/ nor
// $GITHUB_ACTION_PATH/ (a composite step runs in the caller's working
// directory, so `node scripts/x.mjs` would work unseen), a body that is not
// .mjs or .ts (the forms whose imports extractRelativeSpecifiers follows),
// except a shell script in the action's own folder, which is one of its
// files; an untracked path, a $GITHUB_ACTION_PATH/ path that leaves the
// action's folder, an action inside an action, a lane calling a local
// workflow. It sees a script by its extension: a step that runs repository
// code without naming such a file (a `make` target, an `npm run` script, a
// script with no extension) is not traced, nor what a shell script in the
// action's folder sources, nor a relative `require()` in a body (only
// import, export and `import()` are read), and none of today's actions or
// bodies does any of these. Packages are not traced:
// what an action runs from node_modules/ and what a body imports by name,
// whether a dependency (which moves with the lockfile, the setup rule's
// ground: every lane that calls these actions runs the root `npm ci` first)
// or a workspace package (whose source a lane would have to list itself).
// Today's bodies import no workspace package.
//
// The setup rule. A lane's steps set up a toolchain and install packages
// from files outside any list a source change touches: a setup action's
// version file (`node-version-file: .nvmrc`, `go-version-file: go.work`),
// and for each `npm ci` the manifest and lockfile in its directory (with an
// `.npmrc` there when one is tracked), which decide everything it puts on
// disk. A lane that does not watch them lets a dependency bump or a Node
// upgrade merge without the lanes that run on it (#1719, #1734). So for
// every lane in the map, each such file must select the lane, and on the
// always-on lane run every package, the same two questions as the action
// rule. It reads npm's `ci` and `install` commands in each of their
// spellings: `npm ci` as a step's first command is placed, and a top-level
// `npm install --no-package-lock` counts its manifest. Any other `ci` or
// `install` it sees (after another command, quoted, moved by a directory
// change, `--prefix` or `-C`), an expression for a directory or version
// file, an untracked file, and a setup or install inside a composite action
// are refused. Like the action rule's script words, this reads the
// spellings the lanes use, not everything npm can do. Not traced: other
// commands that change node_modules (`npm update`, `dedupe`, `audit fix`,
// `link`), an install redirected by `npm_config_*` in a step's env (the
// lanes set only the fetch-retry ones), an install run through another
// program (`npx npm@10 ci`; yarn, whose one project, site/, is in its
// lane's list), and what a `make` target installs or runs (#1733). No gate
// lane does any of these.
//
// Workflows outside the map (the cache writers, the post-deploy smoke) are
// not the gate and are not held to it.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { parse } from "yaml";

import { matchesGlob } from "./agents-check.mjs";
import { LANES, laneId, selectLanes } from "./ci-lanes.mjs";
import { everythingBecause } from "./turbo-affected.mjs";
import { extractRelativeSpecifiers } from "./verify-esm-node.mjs";

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
/** A file a `run:` step names under the checkout's root or the action's own folder: the variable, then the path. */
const PLACED_PATH = /\$(GITHUB_WORKSPACE|GITHUB_ACTION_PATH)\/([^\s"'`()=;|&<>]+)/g;
/** A word in a `run:` step that names a script, however it is spelled. */
const SCRIPT_WORD = /[^\s"'`()=;|&<>]+\.(?:mjs|cjs|js|jsx|mts|cts|ts|tsx|sh|bash|py)\b/g;
/** The prefixes under which a script word is placed: the checkout, or the action's own folder. */
const PLACED = ["$GITHUB_WORKSPACE/", "$GITHUB_ACTION_PATH/"];
/** The bodies whose imports extractRelativeSpecifiers can follow. */
const BODY_EXTENSIONS = [".mjs", ".ts"];
/** A step's `uses:` naming one of this repository's composite actions. */
const LOCAL_ACTION = /^\.\/\.github\/actions\/([^/]+)$/;
/** A setup action's input naming the file it reads a toolchain version from (`node-version-file`, `go-version-file`). */
const VERSION_FILE = /-version-file$/;
/** One npm command in a `run:` step, bare, quoted or in a subshell: its first word (the verb, unless a flag comes first), then its arguments up to the next command. */
const NPM_COMMAND = /(^|[\s;&|(`'"])npm\s+([^\s;&|)`'"]+)([^\n;&|)`'"]*)/g;
/** A directory change anywhere in a `run:` step, quoted or not, which can move an install out of the step's working-directory. */
const CHANGES_DIRECTORY = /\b(cd|pushd|popd)\b/;
/** npm's flags that install somewhere else: `--prefix <dir>`, `--prefix=<dir>`, and its short form `-C <dir>`. */
const MOVES_INSTALL = /(^|\s)(--prefix\b|-C\b)/;
/**
 * The spellings npm accepts for `ci` and for `install-ci-test`, its `ci`
 * then `test` (`npm ci --help`, `npm install-ci-test --help`); the lanes use
 * the first.
 */
const NPM_CI = new Set(["ci", "clean-install", "ic", "install-clean", "isntall-clean", "install-ci-test", "cit", "clean-install-test", "sit"]);
/**
 * The spellings npm accepts for `install` and for `install-test` (`npm
 * install --help`, `npm install-test --help`), which also read the lockfile
 * and may rewrite it.
 */
const NPM_INSTALL = new Set([
  "install",
  "add",
  "i",
  "in",
  "ins",
  "inst",
  "insta",
  "instal",
  "isnt",
  "isnta",
  "isntal",
  "isntall",
  "install-test",
  "it",
]);

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

/**
 * The bodies one parsed composite action runs: `{ files, refusals }`. `files`
 * are the paths its `run:` steps name as "$GITHUB_WORKSPACE/<path>", less
 * node_modules/ (installed packages, whose versions the lockfile holds; this
 * rule traces repository files, not dependencies: #1719), and the .mjs and
 * .ts files they name as "$GITHUB_ACTION_PATH/<path>" in `folder`, the
 * action's own, whose imports can reach outside it. A shell script in the
 * action's folder is already one of its files and is not read; any other
 * body the guard cannot follow is refused, wherever it lives. `tracked` is the set of tracked paths, passed in as
 * `triggerLists` takes `gatePaths`, so a fixture needs no git.
 */
export function actionRuns(action, tracked, folder) {
  const files = [];
  const refusals = [];
  const using = action?.runs?.using;
  if (using !== "composite") {
    refusals.push(
      `runs.using is ${JSON.stringify(using)}; this guard reads the run steps of composite actions only`,
    );
    return { files, refusals };
  }
  for (const [index, step] of (action.runs.steps ?? []).entries()) {
    const label = `step ${index + 1}${step.name ? ` "${step.name}"` : ""}`;
    if (String(step.uses ?? "").startsWith("./")) {
      refusals.push(
        `${label}: uses ${step.uses}, an action inside an action, which this guard does not follow`,
      );
    }
    if (typeof step.run !== "string") continue;
    for (const [word] of step.run.matchAll(SCRIPT_WORD)) {
      if (!PLACED.some((prefix) => word.startsWith(prefix))) {
        refusals.push(
          `${label}: "${word}" names a script under neither ${PLACED.join(" nor ")}; ` +
            "spell it with one, or teach this guard where it lives",
        );
      }
    }
    for (const [, variable, named] of step.run.matchAll(PLACED_PATH)) {
      const own = variable === "GITHUB_ACTION_PATH";
      const path = posix.normalize(own ? posix.join(folder, named) : named);
      if (own && !path.startsWith(`${folder}/`)) {
        refusals.push(
          `${label}: "$${variable}/${named}" leaves ${folder}; name a file outside it as $GITHUB_WORKSPACE/<path>`,
        );
        continue;
      }
      if ((!own && path.startsWith("node_modules/")) || files.includes(path)) continue;
      const followed = BODY_EXTENSIONS.some((extension) => path.endsWith(extension));
      if (!tracked.has(path)) {
        refusals.push(`${label}: runs ${path}, which git does not track`);
      } else if (followed) {
        files.push(path);
      } else if (!(own && path.endsWith(".sh"))) {
        refusals.push(
          `${label}: runs ${path}; this guard follows the imports of ` +
            `${BODY_EXTENSIONS.join(" and ")} bodies only, so teach it this kind first`,
        );
      }
    }
  }
  return { files, refusals };
}

/**
 * The bodies and every tracked file they reach by relative import, sorted:
 * `{ files, refusals }`. A `.js` specifier whose file is not tracked is the
 * `.ts` source beside it (TypeScript's NodeNext spelling). Package and
 * `node:` specifiers are left out; type-only imports are kept, which can only
 * ask a lane to watch one more file. `read` returns a tracked file's text.
 */
export function bodyClosure(bodies, tracked, read) {
  const reached = new Set();
  const refusals = [];
  const visit = (file) => {
    if (reached.has(file)) return;
    reached.add(file);
    for (const specifier of extractRelativeSpecifiers(read(file), file)) {
      const target = posix.normalize(posix.join(posix.dirname(file), specifier));
      const source = target.endsWith(".js") ? `${target.slice(0, -".js".length)}.ts` : null;
      if (tracked.has(target)) visit(target);
      else if (source !== null && tracked.has(source)) visit(source);
      else refusals.push(`${file} imports "${specifier}", which resolves to no tracked file`);
    }
  };
  for (const body of bodies) visit(body);
  return { files: [...reached].sort(), refusals };
}

/**
 * The composite actions of this repository one parsed workflow's jobs call,
 * by folder name, sorted: `{ actions, refusals }`. A local reusable workflow
 * or any other local `uses:` is refused: its steps are not read here.
 */
export function laneActions(workflow) {
  const actions = new Set();
  const refusals = [];
  for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
    if (String(job.uses ?? "").startsWith("./")) {
      refusals.push(`jobs.${jobId}: uses ${job.uses}, a workflow whose steps this guard does not read`);
    }
    for (const step of job.steps ?? []) {
      const uses = String(step.uses ?? "");
      if (!uses.startsWith("./")) continue;
      const name = LOCAL_ACTION.exec(uses)?.[1];
      if (name === undefined) {
        refusals.push(`jobs.${jobId} "${step.name}": uses ${uses}, which is not ./.github/actions/<name>`);
      } else {
        actions.add(name);
      }
    }
  }
  return { actions: [...actions].sort(), refusals };
}

/**
 * What one parsed workflow's steps set up and install from, sorted:
 * `{ files, refusals }`. `files` are each `with.<tool>-version-file` a step
 * passes to a setup action, and for each `npm ci` the manifest and lockfile
 * in its directory, with an `.npmrc` there when one is tracked: everything
 * `npm ci` reads. The directory is the step's `working-directory`, else the
 * job's or the workflow's `defaults.run.working-directory`, else the root.
 * Only `npm ci` as a step's first command is placed, and an install that
 * says `--no-package-lock`, as a top-level command, counts its directory's
 * manifest alone. Any other `ci` or `install` the guard sees is refused, so
 * a moved install cannot hide: an `npm ci` after another command, in a quote
 * or a subshell; any install in a step that changes directory or passes
 * `--prefix` or `-C`; every other spelling of `ci` or `install`; a flag
 * before an install's verb. So are a directory or version file holding an
 * expression, and a file git does not track. Only `ci` and `install` are
 * read; the file header lists what is not traced.
 * `tracked` is passed in, as `actionRuns` takes it, so a fixture needs no git.
 */
export function laneInputs(workflow, tracked) {
  const files = new Set();
  const refusals = [];
  for (const [jobId, job] of Object.entries(workflow.jobs ?? {})) {
    for (const [index, step] of (job.steps ?? []).entries()) {
      const label = `jobs.${jobId} ${step.name ? `"${step.name}"` : `step ${index + 1}`}`;
      const read = (file, how) => {
        if (tracked.has(file)) files.add(file);
        else refusals.push(`${label}: ${how} ${file}, which git does not track`);
      };
      for (const [key, value] of Object.entries(step.with ?? {})) {
        if (!VERSION_FILE.test(key)) continue;
        if (String(value).includes("${{")) {
          refusals.push(`${label}: ${key} is an expression; name the file, so this guard can hold the lane to it`);
        } else {
          read(posix.normalize(String(value)), "sets up from");
        }
      }
      if (typeof step.run !== "string") continue;
      const dir = String(
        step["working-directory"] ??
          job.defaults?.run?.["working-directory"] ??
          workflow.defaults?.run?.["working-directory"] ??
          ".",
      );
      const installsFrom = (names) => {
        if (dir.includes("${{")) {
          refusals.push(`${label}: working-directory is an expression; name the directory, so this guard can hold the lane to it`);
          return;
        }
        for (const name of names) read(posix.join(dir, name), "installs from");
        const npmrc = posix.join(dir, ".npmrc");
        if (tracked.has(npmrc)) files.add(npmrc);
      };
      // A trailing backslash continues the command on the next line.
      const run = step.run.replace(/\\\r?\n/g, " ");
      const start = run.length - run.trimStart().length;
      for (const match of run.matchAll(NPM_COMMAND)) {
        const [, before, verb, args] = match;
        const command = `npm ${verb}${args.trimEnd()}`;
        const words = [verb, ...args.trim().split(/\s+/)];
        if (!words.some((word) => NPM_CI.has(word) || NPM_INSTALL.has(word))) continue;
        if (verb.startsWith("-")) {
          refusals.push(
            `${label}: "${command}" puts a flag before an install, which this guard cannot read; ` +
              "name the command first, and install in a working-directory rather than with --prefix",
          );
          continue;
        }
        if (!NPM_CI.has(verb) && !NPM_INSTALL.has(verb)) continue;
        const moved = MOVES_INSTALL.test(args) || CHANGES_DIRECTORY.test(run);
        if (NPM_INSTALL.has(verb) && /(^|\s)--no-package-lock\b/.test(args)) {
          // It reads no lockfile, but still the manifest in its directory,
          // so it must run there: a top-level command, with nothing moving it.
          if (moved || /[`'"(]/.test(before)) {
            refusals.push(
              `${label}: "${command}" is not a top-level command in the step's working-directory, which this guard cannot place`,
            );
          } else {
            installsFrom(["package.json"]);
          }
        } else if (verb !== "ci" || match.index + before.length !== start || moved) {
          refusals.push(
            `${label}: "${command}" installs from a lockfile this guard cannot place; ` +
              "make `npm ci` the step's first command, in its working-directory, or teach this guard the spelling",
          );
        } else {
          installsFrom(["package.json", "package-lock.json"]);
        }
      }
    }
  }
  return { files: [...files].sort(), refusals };
}

/**
 * The setup rule's refusals for one parsed composite action: a step that sets
 * up or installs from a file, or that the rule cannot place, is refused,
 * since its callers would depend on that file through the action and the
 * guard does not yet read it as theirs.
 */
export function actionSetups(action, tracked) {
  const { files, refusals } = laneInputs({ jobs: { action: { steps: action?.runs?.steps ?? [] } } }, tracked);
  return [
    ...refusals,
    ...files.map(
      (file) =>
        `sets up or installs from ${file}, which this guard does not read as its callers' input; ` +
        "do it in the lane, or teach this guard to follow it",
    ),
  ];
}

function readWorkflows(rootDir = root) {
  const dir = join(rootDir, ".github/workflows");
  return readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .map((file) => {
      const workflow = parse(readFileSync(join(dir, file), "utf8"));
      return { file, workflow, ...triggerLists(workflow, LANES[file]?.paths) };
    });
}

/** Every tracked path, for the action and setup rules. */
function trackedFiles(rootDir = root) {
  const listed = execFileSync("git", ["ls-files", "-z"], { cwd: rootDir, encoding: "utf8" });
  return new Set(listed.split("\0").filter(Boolean));
}

/**
 * Each composite action by folder name: `{ files, bodies, refusals }`, where
 * `files` is everything a change to which changes the action (its own tracked
 * folder and `bodies`, the files it runs with what they import).
 */
function readActions(tracked, rootDir = root) {
  const dir = join(rootDir, ".github/actions");
  const actions = new Map();
  for (const entry of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const name = entry.name;
    const own = [...tracked].filter((file) => file.startsWith(`.github/actions/${name}/`)).sort();
    const manifest = join(dir, name, "action.yml");
    if (!existsSync(manifest)) {
      actions.set(name, { files: own, bodies: [], refusals: ["has no action.yml, the one name this guard reads"] });
      continue;
    }
    const action = parse(readFileSync(manifest, "utf8"));
    const runs = actionRuns(action, tracked, `.github/actions/${name}`);
    const closure = bodyClosure(runs.files, tracked, (file) => readFileSync(join(rootDir, file), "utf8"));
    actions.set(name, {
      files: [...new Set([...own, ...closure.files])].sort(),
      bodies: closure.files,
      refusals: [...runs.refusals, ...closure.refusals, ...actionSetups(action, tracked)],
    });
  }
  return actions;
}

/**
 * What the action rule could not read: each action's refusals, each gate
 * lane's, and each call to an action with no folder, one line apiece.
 */
export function readProblems(actions, laneCalls) {
  return [
    ...[...actions].flatMap(([name, { refusals }]) =>
      refusals.map((refusal) => `.github/actions/${name} ${refusal}`),
    ),
    ...[...laneCalls].flatMap(([file, { actions: called, refusals }]) => [
      ...refusals.map((refusal) => `${file} ${refusal}`),
      ...called
        .filter((name) => !actions.has(name))
        .map((name) => `${file} calls ./.github/actions/${name}, which has no folder`),
    ]),
  ];
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
const tracked = trackedFiles();
const actions = readActions(tracked);
const gateLanes = workflows.filter(({ file }) => LANES[file] !== undefined);
/** Each gate lane's workflow file -> the actions its jobs call, and what it refused. */
const laneCalls = new Map(gateLanes.map(({ file, workflow }) => [file, laneActions(workflow)]));
/** Each gate lane's workflow file -> what its steps set up and install from, and what it refused. */
const laneSetups = new Map(gateLanes.map(({ file, workflow }) => [file, laneInputs(workflow, tracked)]));

/**
 * Why a change to `changed` would leave the lane in `file` short, or null:
 * "lane" when the gate does not select it, "jobs" when the lane decides job
 * by job (`always`) and the change does not run every package there, so a
 * job that uses the file can skip.
 */
function missedBy(file, changed) {
  if (!selectLanes({ event: "pull_request", changedFiles: [changed] }).lanes[laneId(file)]) return "lane";
  if (
    LANES[file].always === true &&
    everythingBecause({ GITHUB_EVENT_NAME: "pull_request" }, [changed], `.github/workflows/${file}`) === null
  ) {
    return "jobs";
  }
  return null;
}

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

test("every composite action, and every action call in a gate lane, is one this guard reads", () => {
  assert.deepEqual(readProblems(actions, laneCalls), []);
});

test("a gate lane runs when any file an action it calls runs changes, and on the always-on lane so does every job", () => {
  const problems = [];
  for (const [file, { actions: called }] of laneCalls) {
    for (const name of called) {
      for (const changed of actions.get(name)?.files ?? []) {
        const missed = missedBy(file, changed);
        if (missed === "lane") {
          problems.push(
            `${file} calls ${name}, which runs ${changed}, yet a change to it does not select the lane. ` +
              `Add "${changed}" to the lane's list in scripts/ci-lanes.mjs.`,
          );
        } else if (missed === "jobs") {
          problems.push(
            `${file} decides job by job and calls ${name}, which runs ${changed}, yet a change to it does not ` +
              "run every package there, so a job that calls the action can skip. " +
              "Make it workspace tooling (WORKSPACE_TOOLING in scripts/turbo-affected.mjs).",
          );
        }
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the action rule still finds the bodies and lanes it exists for", () => {
  // If the action read, the closure or the lane read broke, the rule above
  // would pass on nothing. These are today's bodies and their gate callers.
  const bodies = Object.fromEntries(
    [...actions].filter(([, action]) => action.bodies.length > 0).map(([name, action]) => [name, action.bodies]),
  );
  assert.deepEqual(bodies, {
    "playwright-chromium": ["scripts/playwright-chromium.mjs"],
    "temporal-cli": [
      "client-apps/cli/scripts/install-temporal-cli.ts",
      "client-apps/cli/src/errors/cli-exit-error.ts",
      "client-apps/cli/src/errors/exit-codes.ts",
      "client-apps/cli/src/local/artifact.ts",
      "client-apps/cli/src/local/temporal/download.ts",
    ],
  });
  const callers = (name) =>
    [...laneCalls].filter(([, { actions: called }]) => called.includes(name)).map(([file]) => laneId(file));
  assert.deepEqual(callers("playwright-chromium"), ["e2e-interactive", "ts-workspace"]);
  assert.deepEqual(callers("temporal-cli"), ["conformance-execution", "e2e-interactive"]);
});

test("every setup and install step in a gate lane is one this guard reads", () => {
  const problems = [...laneSetups].flatMap(([file, { refusals }]) => refusals.map((refusal) => `${file} ${refusal}`));
  assert.deepEqual(problems, []);
});

test("a gate lane runs when what its steps set up and install from changes, and on the always-on lane so does every job", () => {
  const problems = [];
  for (const [file, { files }] of laneSetups) {
    for (const changed of files) {
      const missed = missedBy(file, changed);
      if (missed === "lane") {
        problems.push(
          `${file} sets up or installs from ${changed}, yet a change to it does not select the lane. ` +
            `Add "${changed}" to the lane's list in scripts/ci-lanes.mjs.`,
        );
      } else if (missed === "jobs") {
        problems.push(
          `${file} decides job by job and sets up or installs from ${changed}, yet a change to it does not ` +
            "run every package there, so a job can skip. " +
            "Make it workspace tooling (WORKSPACE_TOOLING in scripts/turbo-affected.mjs).",
        );
      }
    }
  }
  assert.deepEqual(problems, []);
});

test("the setup rule still finds the setups and installs it exists for", () => {
  // If the step read broke, the rule above would pass on nothing. These are
  // today's lanes for each file their steps set up or install from.
  const readers = (changed) =>
    [...laneSetups].filter(([, { files }]) => files.includes(changed)).map(([file]) => laneId(file)).sort();
  const rootInstalls = [
    "all-in-one",
    "authorization-model",
    "cli-up",
    "codegen",
    "compose-stack",
    "conformance",
    "conformance-execution",
    "docs",
    "e2e-interactive",
    "go-sdk",
    "helm-chart",
    "java-sdk",
    "plugins-static",
    "runner",
    "stigmer-server",
    "ts-workspace",
    "upgrade-rehearsal",
  ];
  assert.deepEqual(readers(".nvmrc"), [...rootInstalls, "crate"].sort());
  assert.deepEqual(readers("go.work"), ["go-sdk"]);
  assert.deepEqual(readers("package.json"), rootInstalls);
  assert.deepEqual(readers("package-lock.json"), rootInstalls);
  assert.deepEqual(readers("backend/services/stigmer-server/package-lock.json"), [
    "conformance",
    "conformance-execution",
    "stigmer-server",
  ]);
  assert.deepEqual(readers("backend/services/runner/package-lock.json"), ["runner"]);
  assert.deepEqual(readers("test/extension-consumer/package-lock.json"), ["stigmer-server"]);
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

/** A composite action whose steps run the given scripts. */
const composite = (...runs) => ({
  runs: { using: "composite", steps: runs.map((run, i) => ({ name: `s${i}`, shell: "bash", run })) },
});

/** The folder of the fixture action, as readActions passes it. */
const FOLDER = ".github/actions/x";

test("actionRuns reads the bodies a composite action runs, from the checkout and its own folder, once each, without the toolchain", () => {
  const tracked = new Set(["scripts/a.mjs", "cli/scripts/b.ts", `${FOLDER}/own.sh`, `${FOLDER}/lib/run.mjs`]);
  const { files, refusals } = actionRuns(
    composite(
      'node "$GITHUB_WORKSPACE/scripts/a.mjs"',
      'out=$("$GITHUB_WORKSPACE/node_modules/.bin/tsx" "$GITHUB_WORKSPACE/cli/scripts/b.ts" --flag)\n' +
        'echo "$out" >> "$GITHUB_OUTPUT"',
      'node "$GITHUB_WORKSPACE/scripts/a.mjs" again',
      '"$GITHUB_ACTION_PATH/own.sh" resolve',
      'node "$GITHUB_ACTION_PATH/lib/run.mjs"',
    ),
    tracked,
    FOLDER,
  );
  assert.deepEqual(
    files,
    ["scripts/a.mjs", "cli/scripts/b.ts", `${FOLDER}/lib/run.mjs`],
    "an .mjs in the action's folder is read for its imports; a shell script there is one of the folder's files",
  );
  assert.deepEqual(refusals, []);
  assert.deepEqual(
    actionRuns({ runs: { using: "composite", steps: [{ uses: "actions/cache/restore@abc" }] } }, tracked, FOLDER),
    { files: [], refusals: [] },
    "a remote action is not this repository's to read",
  );
});

test("actionRuns refuses what it cannot place: another runtime, a nested action, an unprefixed script, an escape from its folder, an untracked or unfollowable body", () => {
  const tracked = new Set(["scripts/a.mjs", "scripts/b.sh", "scripts/c.cjs", `${FOLDER}/tool.cjs`]);
  const refused = (action) => actionRuns(action, tracked, FOLDER).refusals;
  assert.match(
    refused(composite('node "$GITHUB_ACTION_PATH/tool.cjs"'))[0],
    /\.github\/actions\/x\/tool\.cjs; this guard follows the imports of \.mjs and \.ts bodies only/,
    "a body in the action's folder it cannot follow is refused as one in the checkout is",
  );
  assert.match(
    refused(composite('node "$GITHUB_ACTION_PATH/../../../scripts/a.mjs"'))[0],
    /leaves \.github\/actions\/x; name a file outside it as \$GITHUB_WORKSPACE\/<path>/,
  );
  assert.match(refused(composite('"$GITHUB_ACTION_PATH/gone.sh"'))[0], /\.github\/actions\/x\/gone\.sh, which git does not track/);
  assert.match(refused({ runs: { using: "node20", main: "index.js" } })[0], /composite actions only/);
  assert.match(
    refused({ runs: { using: "composite", steps: [{ uses: "./.github/actions/other" }] } })[0],
    /an action inside an action/,
  );
  for (const run of [
    "node scripts/a.mjs",
    "node ./scripts/a.mjs",
    "node ${{ github.workspace }}/scripts/a.mjs",
    "bash build.sh",
    "python3 tools/x.py",
    "tsx scripts/x.mts",
    "bash tools/run.bash",
  ]) {
    assert.match(refused(composite(run)).join("\n"), /names a script under neither/, run);
  }
  assert.match(refused(composite('node "$GITHUB_WORKSPACE/scripts/gone.mjs"'))[0], /git does not track/);
  for (const body of ["scripts/b.sh", "scripts/c.cjs"]) {
    assert.match(
      refused(composite(`"$GITHUB_WORKSPACE/${body}"`))[0],
      /follows the imports of \.mjs and \.ts bodies only/,
      body,
    );
  }
  assert.deepEqual(
    refused(composite('echo "checksums.txt" "$HOME/bin/temporal" a.json b.tsv')),
    [],
    "words that only look like scripts are not refused",
  );
});

test("bodyClosure follows relative imports to their tracked files, .js to .ts, through a cycle, and refuses one that resolves nowhere", () => {
  const sources = {
    "cli/scripts/install.ts": 'import { x } from "../src/a.js";\nimport fs from "node:fs";\nimport y from "fflate";',
    "cli/src/a.ts": 'export { b } from "./deep/b.js";\nexport type { T } from "./types.js";',
    "cli/src/deep/b.ts": "export const b = 1;",
    "cli/src/types.ts": "export type T = number;",
    "scripts/run.mjs": 'import { h } from "./lib/h.mjs";\nconst later = () => import("./lib/late.mjs");',
    "scripts/lib/h.mjs": 'import "../run.mjs";\nexport const h = 1;',
    "scripts/lib/late.mjs": "export default 1;",
  };
  const tracked = new Set(Object.keys(sources));
  const read = (file) => sources[file];
  assert.deepEqual(bodyClosure(["cli/scripts/install.ts", "scripts/run.mjs"], tracked, read), {
    files: [
      "cli/scripts/install.ts",
      "cli/src/a.ts",
      "cli/src/deep/b.ts",
      "cli/src/types.ts",
      "scripts/lib/h.mjs",
      "scripts/lib/late.mjs",
      "scripts/run.mjs",
    ],
    refusals: [],
  });
  const broken = bodyClosure(["scripts/x.mjs"], new Set(["scripts/x.mjs"]), () => 'import "./missing.mjs";');
  assert.deepEqual(broken.refusals, ['scripts/x.mjs imports "./missing.mjs", which resolves to no tracked file']);
});

test("an action folder without action.yml, and a call to an action with no folder, are each reported", () => {
  const scratch = mkdtempSync(join(tmpdir(), "lane-triggers-"));
  try {
    mkdirSync(join(scratch, ".github/actions/bare"), { recursive: true });
    const read = readActions(new Set([".github/actions/bare/README.md"]), scratch);
    assert.deepEqual(read.get("bare"), {
      files: [".github/actions/bare/README.md"],
      bodies: [],
      refusals: ["has no action.yml, the one name this guard reads"],
    });
    assert.deepEqual(
      readProblems(read, new Map([["ci.x.yaml", { actions: ["bare", "gone"], refusals: ["jobs.a: nested"] }]])),
      [
        ".github/actions/bare has no action.yml, the one name this guard reads",
        "ci.x.yaml jobs.a: nested",
        "ci.x.yaml calls ./.github/actions/gone, which has no folder",
      ],
    );
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

test("laneActions names the repository's actions a workflow calls, and refuses a local call it does not read", () => {
  const workflow = {
    jobs: {
      a: { steps: [{ uses: "./.github/actions/one" }, { uses: "actions/checkout@abc" }, { run: "true" }] },
      b: { steps: [{ uses: "./.github/actions/two" }, { uses: "./.github/actions/one" }] },
    },
  };
  assert.deepEqual(laneActions(workflow), { actions: ["one", "two"], refusals: [] });
  const nested = laneActions({
    jobs: {
      call: { uses: "./.github/workflows/ci.other.yaml" },
      odd: { steps: [{ name: "Elsewhere", uses: "./tools/action" }] },
    },
  });
  assert.equal(nested.refusals.length, 2);
  assert.match(nested.refusals[0], /a workflow whose steps this guard does not read/);
  assert.match(nested.refusals[1], /not \.\/\.github\/actions\/<name>/);
});

/** A workflow of one job whose steps are given, with optional job and workflow defaults. */
const lane = (steps, { jobDir, workflowDir } = {}) => ({
  ...(workflowDir ? { defaults: { run: { "working-directory": workflowDir } } } : {}),
  jobs: { j: { ...(jobDir ? { defaults: { run: { "working-directory": jobDir } } } : {}), steps } },
});

test("laneInputs reads each version file and each npm ci's manifest and lockfile, from the step's, job's or workflow's directory", () => {
  const tracked = new Set([
    ".nvmrc",
    "go.work",
    "package.json",
    "package-lock.json",
    "svc/package.json",
    "svc/package-lock.json",
    "svc/.npmrc",
    "job/package.json",
    "job/package-lock.json",
    "wf/package.json",
    "wf/package-lock.json",
  ]);
  assert.deepEqual(
    laneInputs(
      lane([
        { uses: "actions/setup-node@abc", with: { "node-version-file": ".nvmrc", cache: "npm" } },
        { uses: "actions/setup-go@abc", with: { "go-version-file": "./go.work" } },
        { run: "npm ci" },
        { run: "npm ci --no-audit --no-fund && npm run typecheck", "working-directory": "svc" },
        { run: "npm run build:libs" },
        { run: "rm package-lock.json\nnpm install --no-package-lock --no-audit --no-fund" },
      ]),
      tracked,
    ),
    {
      files: [".nvmrc", "go.work", "package-lock.json", "package.json", "svc/.npmrc", "svc/package-lock.json", "svc/package.json"],
      refusals: [],
    },
    "flags and a following command are accepted, a tracked .npmrc is counted, and an install that reads no lockfile adds nothing beyond its manifest",
  );
  assert.deepEqual(laneInputs(lane([{ run: "npm ci" }], { jobDir: "job", workflowDir: "wf" }), tracked).files, [
    "job/package-lock.json",
    "job/package.json",
  ]);
  assert.deepEqual(laneInputs(lane([{ run: "  npm ci\n" }], { workflowDir: "wf" }), tracked).files, [
    "wf/package-lock.json",
    "wf/package.json",
  ]);
  assert.deepEqual(
    laneInputs(lane([{ run: "npm ci \\\n  --no-audit --no-fund" }]), tracked),
    { files: ["package-lock.json", "package.json"], refusals: [] },
    "a line continuation is one command",
  );
  assert.deepEqual(
    laneInputs(lane([{ run: "npm install --no-package-lock", "working-directory": "svc" }]), tracked),
    { files: ["svc/.npmrc", "svc/package.json"], refusals: [] },
    "an install that reads no lockfile still reads its directory's manifest",
  );
});

test("laneInputs refuses an install or setup it cannot place: a moved or prefixed npm ci, another install spelling, an expression, an untracked file", () => {
  const tracked = new Set(["package.json", "package-lock.json", ".nvmrc"]);
  const refused = (step) => laneInputs(lane([step]), tracked).refusals;
  for (const run of [
    "cd svc && npm ci",
    "echo start\nnpm ci",
    "npm ci --prefix svc",
    "npm install",
    "npm i -D left-pad",
    "npm clean-install",
    "npm isntall",
    "out=$(npm ci)",
    "x=`npm ci`",
    "bash -c 'npm ci'",
    'bash -c "npm ci"',
    "npm ci \\\n  --prefix svc",
    "cd svc\nnpm ci",
    "npm cit",
    "npm it",
    "npm ci -C svc",
    "npm ci --prefix=svc",
    "npm ci\necho 'cd svc'",
  ]) {
    assert.match(refused({ run }).join("\n"), /installs from a lockfile this guard cannot place/, run);
  }
  for (const run of [
    "cd svc && npm install --no-package-lock",
    "pushd svc && npm install --no-package-lock",
    "bash -c 'cd svc; npm install --no-package-lock'",
    "(npm install --no-package-lock)",
    "npm install --no-package-lock -C svc",
  ]) {
    assert.match(refused({ run })[0], /is not a top-level command in the step's working-directory/, run);
  }
  for (const run of ["npm --prefix svc ci", "npm -w @stigmer/sdk install left-pad"]) {
    assert.match(refused({ run }).join("\n"), /puts a flag before an install/, run);
  }
  assert.match(refused({ run: "npm ci", "working-directory": "${{ inputs.dir }}" })[0], /working-directory is an expression/);
  assert.match(
    refused({ uses: "actions/setup-node@abc", with: { "node-version-file": "${{ matrix.file }}" } })[0],
    /node-version-file is an expression/,
  );
  assert.match(refused({ run: "npm ci", "working-directory": "gone" })[0], /installs from gone\/package\.json, which git does not track/);
  assert.match(
    refused({ uses: "actions/setup-python@abc", with: { "python-version-file": ".python-version" } })[0],
    /sets up from \.python-version, which git does not track/,
  );
  assert.deepEqual(
    refused({ run: "npm run test:scripts && npm test && npm exec tsc && echo npmci" }),
    [],
    "npm commands that install nothing are not refused",
  );
  assert.deepEqual(
    refused({ run: "npm --version && npm -v && npm -w @stigmer/sdk run build" }),
    [],
    "a leading flag on a command that installs nothing is not refused",
  );
});

test("actionSetups refuses a setup or install inside a composite action, which its callers would depend on unseen", () => {
  const tracked = new Set(["package.json", "package-lock.json", ".nvmrc"]);
  assert.deepEqual(actionSetups({ runs: { using: "composite", steps: [{ run: 'node "$GITHUB_WORKSPACE/x.mjs"' }] } }, tracked), []);
  const refused = actionSetups(
    {
      runs: {
        using: "composite",
        steps: [{ uses: "actions/setup-node@abc", with: { "node-version-file": ".nvmrc" } }, { run: "npm ci" }, { run: "npm install" }],
      },
    },
    tracked,
  );
  assert.equal(refused.length, 4);
  assert.match(refused[0], /installs from a lockfile this guard cannot place/);
  assert.match(refused[1], /sets up or installs from \.nvmrc, which this guard does not read as its callers' input/);
});
