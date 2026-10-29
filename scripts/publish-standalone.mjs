#!/usr/bin/env node

/**
 * Publishes a STANDALONE @stigmer/* package — the runner and the server,
 * the two packages that live outside the root npm workspaces with their
 * own lockfiles and `file:` links to the workspace libs.
 *
 * publish-libs.mjs owns the workspace libs (it publishes a generated
 * dist/package.json from each lib's dist/). A standalone package publishes
 * from its own directory with its `files` list, so it needs a different
 * sequence, which used to live as inline `node -e` blocks in two release
 * workflows. One tested implementation here instead (since @stigmer/server
 * became the second such package):
 *
 *   1. Stamp the release version into package.json and pin every
 *      @stigmer/* `file:` dependency to that exact version — the published
 *      manifest names the registry versions the libs publish under in the
 *      same release train (the analogue of how release.maven and
 *      release.python-sdk pin protos). The committed manifest is mutated
 *      IN PLACE and left that way: the slim-artifact steps that follow in
 *      the same job read the stamped version. `--dry-run` restores it.
 *   2. Copy the repo-root LICENSE beside the manifest so the tarball
 *      carries it (the libs' publish does the same), unless the package
 *      carries a LICENSE of its own: a package under another license
 *      publishes with its own text, which this script never overwrites and
 *      never removes (`rootLicenseCopy`).
 *   3. `npm pack --dry-run` — the published file list, in the log.
 *   4. Wait until every pinned lib at that version is installable from
 *      npm. The `publish` job already put them there (it is this job's
 *      hard `needs:`), so the wait only absorbs the registry's propagation
 *      lag, and the install below cannot race it. "Installable" is what an
 *      install needs, in the order it needs it (`installGap`): the
 *      abbreviated install metadata lists the version (the document
 *      `npm install` resolves against, which npm caches apart from the full
 *      document `npm view` reads, so the two can disagree while a version
 *      propagates), and the tarball that metadata names answers. npm serves
 *      the tarball separately, so a version the metadata already lists can
 *      still 404 on download (stigmer#1325). The libs publish together, so
 *      they share one deadline and every lib still missing is polled each
 *      round (`waitForRegistry`).
 *   5. `npm run verify:consumer` — the package's consumer-install smoke
 *      (scripts/verify-consumer-install.mjs) over the REAL published
 *      manifest: version stamped, libs pinned to the registry versions the
 *      wait just confirmed. The exact resolution consumers will get. One
 *      good read is not proof that the next agrees: npm has answered the
 *      install "no such version" seconds after the wait saw a lib
 *      (stigmer#1367). The smoke exits 75 when that is why it failed
 *      (scripts/lib/registry-lag.mjs), and the smoke runs again on the
 *      wait's schedule until the wait's own deadline (`retryConsumerSmoke`).
 *      Any other failure stops the publish at once.
 *   6. `npm publish --access public --tag <tag>`.
 *
 * The dist-tag follows publish-libs.mjs: an explicit `--tag` wins (the dev
 * pipeline routes every package to `dev`); otherwise a pre-release version
 * publishes under `next`, a stable one under `latest`.
 *
 * `--dry-run` rehearses the sequence without registry side effects: the
 * consumer smoke runs over the COMMITTED manifest (its file: links pack
 * locally, exactly as the PR lanes run it — a manifest pinned to a version
 * nobody has published cannot install), then stamp, pack list and
 * `npm publish --dry-run`, and the manifest and LICENSE are restored.
 *
 * `--pack-dir <dir>` "publishes" to a directory instead of the registry,
 * as publish-libs.mjs's flag of the same name does for the workspace libs:
 * steps 1 and 2, then `npm pack` into <dir>, and the manifest and LICENSE
 * are restored. The tarball is the one step 6 would upload, pinned to libs
 * at the same version, so a consumer installs it together with the libs
 * packed by `publish-libs.mjs --pack-dir` at that version and our graph
 * resolves among the tarballs (scripts/stage-server-library.mjs). There is
 * no registry wait and no consumer smoke: the smoke installs the pinned
 * libs from npm, where a pack-only version never exists, and the PR lanes
 * already run it over the committed manifest; the consumer that installs
 * the tarballs runs its own suite over its own tree. Mutually exclusive
 * with --dry-run and --tag (no dist-tag exists for a directory).
 *
 * Usage:
 *   node scripts/publish-standalone.mjs --package backend/services/runner --version 3.14.0
 *   node scripts/publish-standalone.mjs --package backend/services/stigmer-server --version 3.14.1-dev.20260910 --tag dev
 *   node scripts/publish-standalone.mjs --package ... --version ... --dry-run
 *   node scripts/publish-standalone.mjs --package backend/services/stigmer-server --version 0.0.0-local.20260929120000 --pack-dir out/pkgs
 *
 * Authentication is npm's own (NODE_AUTH_TOKEN with setup-node's
 * registry-url, as the workflows configure); a --pack-dir run needs none.
 * The registry is npm's too: `npm publish` sends an @stigmer/* package to
 * the scope's registry when one is configured, and the wait reads the same
 * one (`configuredRegistry`), so the workflow's npm configuration alone
 * decides where a lane publishes.
 * Needs a prior build of the package and of the workspace libs it links.
 */

import { execFileSync, spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { REGISTRY_LAG_EXIT } from "./lib/registry-lag.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * The standalone packages, each published by this script from its own
 * directory: the runner, the server and Enterprise. With publish-libs.mjs's
 * PACKAGES they are a release's npm packages, the set release.npm-mirror.yaml
 * copies into Stigmer's npm repository (scripts/mirror-npm-release.mjs).
 */
export const STANDALONE_PACKAGES = [
  "backend/services/runner",
  "backend/services/stigmer-server",
  "ee/server",
];

/**
 * How long the pinned libs may take to appear on npm, and how often to ask.
 * Measured on v3.28.0 (run 36264269415, stigmer#1275): npm served
 * @stigmer/plugin-package about 7 minutes after it was published (18:58:35Z
 * published, 19:05:43Z in its packument), and @stigmer/server about 4.5
 * minutes after its own publish. The old fixed 5-minute window failed one
 * second before the lib appeared. Then v3.41.0 (run 36717678532,
 * stigmer#1367): npm answered the libs' publish at 12:55Z with "being
 * processed" and served them from about 13:17Z, 22 minutes later, and the
 * 20-minute budget set from v3.28.0 ran out first. 35 minutes is the worst
 * lag seen with half as much again to spare; no job running the wait caps
 * it lower. The poll starts at 10 s and doubles to a 60 s cap, so a fast
 * registry is noticed at once and a slow one is not hammered.
 */
export const WAIT_BUDGET_MS = 35 * 60_000;
export const WAIT_FIRST_INTERVAL_MS = 10_000;
export const WAIT_MAX_INTERVAL_MS = 60_000;

/**
 * How long one registry request may take before it counts as "not yet".
 * The deadline is checked between rounds, so without a bound one stalled
 * connection would hold the job past it. A round probes the libs in
 * parallel and each lib's two requests (install document, then tarball) in
 * sequence, so a refusal lands at most two timeouts, 60 s, after the
 * deadline.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * The repo-root LICENSE copy step 2 makes, or `undefined` when the package
 * carries its own LICENSE. A package's own text is its license, so the
 * publish leaves it exactly as committed: never replaced by the root's,
 * and never removed by the rehearsal's restore, which removes only a copy
 * this step made. `copy` places the root's text; `remove` undoes it.
 */
export function rootLicenseCopy(packageDir, root) {
  const licensePath = join(packageDir, "LICENSE");
  const rootLicensePath = join(root, "LICENSE");
  if (existsSync(licensePath) || !existsSync(rootLicensePath)) {
    return undefined;
  }
  return {
    copy: () => copyFileSync(rootLicensePath, licensePath),
    remove: () => rmSync(licensePath, { force: true }),
  };
}

/**
 * Returns the manifest with the release version stamped and every
 * @stigmer/* `file:` dependency pinned to that exact version. Pure: the
 * input is not mutated. Dependencies already at a version (a second run,
 * or a lib the package pins deliberately) are left alone, as is anything
 * outside the @stigmer scope.
 */
export function stampManifest(manifest, version) {
  const dependencies = { ...(manifest.dependencies ?? {}) };
  const pinned = [];
  for (const [name, spec] of Object.entries(dependencies)) {
    if (name.startsWith("@stigmer/") && spec.startsWith("file:")) {
      dependencies[name] = version;
      pinned.push(name);
    }
  }
  return { manifest: { ...manifest, version, dependencies }, pinned };
}

/** publish-libs.mjs's tag rule: explicit wins; else pre-release → next, stable → latest. */
export function resolveTag(version, explicitTag) {
  if (explicitTag) return explicitTag;
  return version.includes("-") ? "next" : "latest";
}

export function parseArgs(argv) {
  const value = (flag) =>
    argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined;
  const packageDir = value("--package");
  const version = value("--version");
  if (!packageDir || !version) {
    throw new Error(
      "usage: publish-standalone.mjs --package <dir> --version <semver> [--tag <tag>] [--dry-run | --pack-dir <dir>]",
    );
  }
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `--version must be a semver or semver pre-release, got '${version}'`,
    );
  }
  const tag = value("--tag");
  const dryRun = argv.includes("--dry-run");
  const packDir = value("--pack-dir");
  if (argv.includes("--pack-dir") && (!packDir || packDir.startsWith("--"))) {
    throw new Error("--pack-dir requires a directory");
  }
  if (packDir && (tag || dryRun)) {
    throw new Error("--pack-dir cannot be combined with --tag or --dry-run");
  }
  return {
    packageDir,
    version,
    tag,
    dryRun,
    packDir: packDir ? resolve(packDir) : undefined,
  };
}

function run(cmd, args, cwd) {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

/** `run`, returning the exit code instead of throwing on a failure. */
function runForExitCode(cmd, args, cwd) {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/** The Accept header npm's installer sends for a package's metadata. */
export const INSTALL_METADATA_ACCEPT =
  "application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*";

/**
 * What an install of `name@version` still lacks from the registry, or
 * `null` when an install would get it. The checks run in the order an
 * install needs them, and the first one that fails is named:
 *
 *   registry unreachable: <fault>           the install document request failed
 *   install document answers HTTP <status>  it answered, not with a success
 *   install document unreadable: <fault>    its body is not JSON
 *   not listed in its install document      it does not list the version
 *   no tarball in its install document      the version names no tarball
 *   tarball unreachable: <fault>            the HEAD on the tarball failed
 *   tarball answers HTTP <status>           it answered, not with a success
 *
 * The install document is the abbreviated metadata an install resolves the
 * pin against; a scoped name keeps its `@` and encodes its `/`, as npm's own
 * client does. The tarball is probed at the URL that document names,
 * because that is the URL the install downloads, and npm can still answer
 * it 404 after the document lists the version (stigmer#1325). Every gap
 * means "not yet": the wait asks again until its deadline, and its refusal
 * names the gap. Each request gives up after `REQUEST_TIMEOUT_MS`.
 */
export async function installGap(
  name,
  version,
  { registry, fetchImpl = fetch },
) {
  const base = registry.endsWith("/") ? registry : `${registry}/`;
  const url = `${base}${name.replace("/", "%2f")}`;
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: INSTALL_METADATA_ACCEPT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    return `registry unreachable: ${faultOf(error)}`;
  }
  if (!response.ok) return `install document answers HTTP ${response.status}`;
  let document;
  try {
    document = await response.json();
  } catch (error) {
    return `install document unreadable: ${faultOf(error)}`;
  }
  const versions = document?.versions ?? {};
  if (!Object.hasOwn(versions, version)) {
    return "not listed in its install document";
  }
  const tarball = versions[version]?.dist?.tarball;
  if (typeof tarball !== "string" || tarball === "") {
    return "no tarball in its install document";
  }
  try {
    const head = await fetchImpl(tarball, {
      method: "HEAD",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return head.ok ? null : `tarball answers HTTP ${head.status}`;
  } catch (error) {
    return `tarball unreachable: ${faultOf(error)}`;
  }
}

/**
 * A fetch fault as one line. Node's fetch rejects a network failure with
 * a bare "fetch failed" and puts the reason (ENOTFOUND, ECONNRESET) in
 * `cause`, so the cause is appended when there is one.
 */
function faultOf(error) {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error
    ? `${error.message}: ${error.cause.message}`
    : error.message;
}

/** One npm config value as npm resolves it for this job. */
function npmConfigGet(key) {
  return execFileSync("npm", ["config", "get", key], {
    encoding: "utf8",
  }).trim();
}

/**
 * The registry the job's npm sends @stigmer/* packages to, which is where
 * the wait and the consumer smoke must look. npm routes a scoped package
 * to `@stigmer:registry` when it is set and to `registry` otherwise, and
 * setup-node writes the scope line when a workflow names `scope:`: the dev
 * lane points the scope at Stigmer's own registry while the release lane
 * leaves npm's default. Reading only `registry` would wait on npmjs.com for
 * a dev build that never goes there. npm prints `undefined` for an unset
 * key.
 */
export function configuredRegistry(configGet = npmConfigGet) {
  const scoped = configGet("@stigmer:registry");
  if (scoped !== "" && scoped !== "undefined") return scoped;
  return configGet("registry");
}

/** Each lib the wait still misses, with what it misses: `name@v (gap), ...`. */
function describeGaps(gaps, version) {
  return gaps.map(({ name, gap }) => `${name}@${version} (${gap})`).join(", ");
}

/**
 * The wait's refusal: the libs are published (the libs job is this job's
 * hard dependency) and npm does not yet serve an install of them. It names
 * each lib with what npm still lacks for it (`installGap`), and the
 * recovery, rerunning only the failed job, which resumes here with the libs
 * in place.
 */
export function registryLagMessage(gaps, version, budgetMs, runId) {
  return (
    `${describeGaps(gaps, version)} published by the libs job but not ` +
    `installable from npm after ${budgetMs / 60_000} minutes; ` +
    lagRecovery(gaps.length === 1 ? "it" : "them", runId)
  );
}

/**
 * The smoke retry's refusal: every attempt until the deadline failed on a
 * pinned lib npm does not serve yet. The last attempt's output, just above
 * in the log, names the lib.
 */
export function smokeLagMessage(budgetMs, runId) {
  return (
    `the consumer install still finds a pinned lib missing from npm after ${budgetMs / 60_000} minutes ` +
    `(the last attempt above names it); ${lagRecovery("it", runId)}`
  );
}

/** What both refusals end with: the cause, and rerunning only the failed job. */
function lagRecovery(pronoun, runId) {
  return (
    `the registry is lagging. Rerun the failed job once npm serves ${pronoun}: ` +
    `gh run rerun ${runId ?? "<run-id>"} --failed`
  );
}

/**
 * The registry wait's sleeps: each call returns the next sleep and the time
 * left before `deadline`, or `null` once the deadline has passed. The sleep
 * doubles from `firstIntervalMs` to `maxIntervalMs`, and the last one is
 * cut to the deadline. The wait and the smoke's retry each draw from one,
 * so both keep the same schedule under the same deadline.
 */
export function pollSchedule({
  deadline,
  now = () => Date.now(),
  firstIntervalMs = WAIT_FIRST_INTERVAL_MS,
  maxIntervalMs = WAIT_MAX_INTERVAL_MS,
}) {
  let interval = firstIntervalMs;
  return () => {
    const remaining = deadline - now();
    if (remaining <= 0) return null;
    const wait = Math.min(interval, remaining);
    interval = Math.min(interval * 2, maxIntervalMs);
    return { wait, remaining };
  };
}

/** A schedule step as the log line's tail: `next check in 10s (35 min left)`. */
function describeStep({ wait, remaining }, what) {
  return `next ${what} in ${Math.ceil(wait / 1000)}s (${Math.ceil(remaining / 60_000)} min left)`;
}

/**
 * Polls until every name at `version` is installable from npm or the
 * deadline passes. `gapOf(name, version)` answers what an install still
 * lacks, or `null` (`installGap` in the release). All names share one
 * deadline and each round asks only about the ones still missing, on
 * `pollSchedule`'s sleeps. The deadline defaults to `budgetMs` from now; the
 * release passes its own, which the smoke's retry then shares. The clock,
 * the sleep and the registry query are parameters, so the schedule is
 * tested without a registry or real time.
 */
export async function waitForRegistry(
  names,
  version,
  {
    gapOf,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    log = (line) => console.log(line),
    budgetMs = WAIT_BUDGET_MS,
    deadline = now() + budgetMs,
    firstIntervalMs = WAIT_FIRST_INTERVAL_MS,
    maxIntervalMs = WAIT_MAX_INTERVAL_MS,
    runId = process.env.GITHUB_RUN_ID,
  } = {},
) {
  const next = pollSchedule({ deadline, now, firstIntervalMs, maxIntervalMs });
  let pending = [...names];
  for (;;) {
    const answers = await Promise.all(
      pending.map((name) => gapOf(name, version)),
    );
    const gaps = [];
    pending.forEach((name, i) => {
      if (answers[i] === null) log(`  installable: ${name}@${version}`);
      else gaps.push({ name, gap: answers[i] });
    });
    if (gaps.length === 0) return;
    pending = gaps.map(({ name }) => name);
    const step = next();
    if (step === null) {
      throw new Error(registryLagMessage(gaps, version, budgetMs, runId));
    }
    log(
      `  not yet installable: ${describeGaps(gaps, version)}; ${describeStep(step, "check")}`,
    );
    await sleep(step.wait);
  }
}

/**
 * Runs the consumer-install smoke until it passes, again on
 * `pollSchedule`'s sleeps while it exits REGISTRY_LAG_EXIT (npm does not
 * serve a pinned lib yet), up to the deadline the registry wait used.
 * `runSmoke()` runs it once and returns its exit code. Any other failure
 * throws at once, and a lag still there at the deadline throws the wait's
 * kind of refusal: the registry is lagging, rerun the failed job.
 */
export async function retryConsumerSmoke(
  runSmoke,
  {
    deadline,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    log = (line) => console.log(line),
    budgetMs = WAIT_BUDGET_MS,
    firstIntervalMs = WAIT_FIRST_INTERVAL_MS,
    maxIntervalMs = WAIT_MAX_INTERVAL_MS,
    runId = process.env.GITHUB_RUN_ID,
  },
) {
  const next = pollSchedule({ deadline, now, firstIntervalMs, maxIntervalMs });
  for (;;) {
    const code = runSmoke();
    if (code === 0) return;
    if (code !== REGISTRY_LAG_EXIT) {
      throw new Error(`the consumer-install smoke failed (exit ${code})`);
    }
    const step = next();
    if (step === null) {
      throw new Error(smokeLagMessage(budgetMs, runId));
    }
    log(
      `  npm does not serve a pinned lib to the install yet; ${describeStep(step, "attempt")}`,
    );
    await sleep(step.wait);
  }
}

async function main() {
  const {
    packageDir: packageArg,
    version,
    tag: explicitTag,
    dryRun,
    packDir,
  } = parseArgs(process.argv.slice(2));
  const packageDir = isAbsolute(packageArg)
    ? packageArg
    : resolve(repoRoot, packageArg);
  const manifestPath = join(packageDir, "package.json");
  const original = readFileSync(manifestPath, "utf8");
  const { manifest, pinned } = stampManifest(JSON.parse(original), version);
  const tag = resolveTag(version, explicitTag);

  console.log(`\n  package: ${manifest.name} (${packageDir})`);
  console.log(`  version: ${version}`);
  if (packDir) {
    console.log(`  pack to: ${packDir} (no registry)`);
  } else {
    console.log(`  tag:     ${tag}`);
  }
  console.log(
    `  pinned:  ${pinned.length > 0 ? pinned.map((n) => `${n}@${version}`).join(", ") : "(none)"}`,
  );
  if (!packDir) console.log(`  dry-run: ${dryRun}`);
  console.log("");

  const license = rootLicenseCopy(packageDir, repoRoot);

  try {
    if (dryRun) {
      console.log(
        "=== Consumer-install smoke (over the committed manifest; dry-run) ===",
      );
      run("npm", ["run", "verify:consumer"], packageDir);
    }

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    license?.copy();

    if (packDir) {
      console.log("\n=== Pack ===");
      mkdirSync(packDir, { recursive: true });
      run("npm", ["pack", "--pack-destination", packDir], packageDir);
      console.log(
        `\n=== Done: ${manifest.name}@${version} (packed to ${packDir}) ===\n`,
      );
      return;
    }

    console.log("\n=== Published file list ===");
    run("npm", ["pack", "--dry-run"], packageDir);

    if (!dryRun) {
      // The wait and the smoke's retry share one deadline (step 5).
      const deadline = Date.now() + WAIT_BUDGET_MS;
      if (pinned.length > 0) {
        console.log(
          "\n=== Waiting until the pinned libs are installable from npm ===",
        );
        const registry = configuredRegistry();
        await waitForRegistry(pinned, version, {
          gapOf: (name, v) => installGap(name, v, { registry }),
          deadline,
        });
      }
      console.log(
        "\n=== Consumer-install smoke (over the stamped manifest) ===",
      );
      await retryConsumerSmoke(
        () => runForExitCode("npm", ["run", "verify:consumer"], packageDir),
        { deadline },
      );
    }

    console.log("\n=== Publish ===");
    const publishArgs = ["publish", "--access", "public", "--tag", tag];
    if (dryRun) publishArgs.push("--dry-run");
    run("npm", publishArgs, packageDir);
    console.log(
      `\n=== Done: ${manifest.name}@${version} (${tag}${dryRun ? ", dry-run" : ""}) ===\n`,
    );
  } finally {
    // A real publish leaves the manifest stamped for the slim steps that
    // follow in the same job (step 1); a rehearsal or a pack leaves the
    // checkout as it found it.
    if (dryRun || packDir) {
      writeFileSync(manifestPath, original);
      license?.remove();
    }
  }
}

// Only run when invoked directly (not when imported by tests).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((err) => {
    console.error(
      `publish-standalone: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  });
}
