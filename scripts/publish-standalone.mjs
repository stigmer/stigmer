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
 * workflows. One tested implementation here instead (stigmer-cloud project
 * 20260910.04, when @stigmer/server became the second such package):
 *
 *   1. Stamp the release version into package.json and pin every
 *      @stigmer/* `file:` dependency to that exact version — the published
 *      manifest names the registry versions the libs publish under in the
 *      same release train (the analogue of how release.maven and
 *      release.python-sdk pin protos). The committed manifest is mutated
 *      IN PLACE and left that way: the slim-artifact steps that follow in
 *      the same job read the stamped version. `--dry-run` restores it.
 *   2. Copy the repo-root LICENSE beside the manifest so the tarball
 *      carries it (the libs' publish does the same).
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
 *      wait just confirmed. The exact resolution consumers will get.
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
 * Needs a prior build of the package and of the workspace libs it links.
 */

import { execFileSync } from "node:child_process";
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

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/**
 * How long the pinned libs may take to appear on npm, and how often to ask.
 * Measured on v3.28.0 (run 36264269415, stigmer#1275): npm served
 * @stigmer/plugin-package about 7 minutes after it was published (18:58:35Z
 * published, 19:05:43Z in its packument), and @stigmer/server about 4.5
 * minutes after its own publish. The old fixed 5-minute window failed one
 * second before the lib appeared. 20 minutes is almost three times the
 * worst lag seen. The poll starts at 10 s and doubles to a 60 s cap, so a
 * fast registry is noticed at once and a slow one is not hammered.
 */
export const WAIT_BUDGET_MS = 20 * 60_000;
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

/** The registry the job's npm is configured for (setup-node writes it). */
function configuredRegistry() {
  return execFileSync("npm", ["config", "get", "registry"], {
    encoding: "utf8",
  }).trim();
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
  const rerun = `gh run rerun ${runId ?? "<run-id>"} --failed`;
  return (
    `${describeGaps(gaps, version)} published by the libs job but not ` +
    `installable from npm after ${budgetMs / 60_000} minutes; the registry is lagging. ` +
    `Rerun the failed job once npm serves ${gaps.length === 1 ? "it" : "them"}: ${rerun}`
  );
}

/**
 * Polls until every name at `version` is installable from npm or the
 * budget is spent. `gapOf(name, version)` answers what an install still
 * lacks, or `null` (`installGap` in the release). All names share one
 * deadline and each round asks only about the ones still missing. The
 * interval doubles from `firstIntervalMs` to `maxIntervalMs`, and the last
 * sleep is cut to the deadline. The clock, the sleep and the registry query
 * are parameters, so the schedule is tested without a registry or real
 * time.
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
    firstIntervalMs = WAIT_FIRST_INTERVAL_MS,
    maxIntervalMs = WAIT_MAX_INTERVAL_MS,
    runId = process.env.GITHUB_RUN_ID,
  } = {},
) {
  const deadline = now() + budgetMs;
  let pending = [...names];
  let interval = firstIntervalMs;
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
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(registryLagMessage(gaps, version, budgetMs, runId));
    }
    const wait = Math.min(interval, remaining);
    log(
      `  not yet installable: ${describeGaps(gaps, version)}; ` +
        `next check in ${Math.ceil(wait / 1000)}s (${Math.ceil(remaining / 60_000)} min left)`,
    );
    await sleep(wait);
    interval = Math.min(interval * 2, maxIntervalMs);
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

  const licensePath = join(packageDir, "LICENSE");
  const licenseCopied =
    !existsSync(licensePath) && existsSync(join(repoRoot, "LICENSE"));

  try {
    if (dryRun) {
      console.log(
        "=== Consumer-install smoke (over the committed manifest; dry-run) ===",
      );
      run("npm", ["run", "verify:consumer"], packageDir);
    }

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    if (licenseCopied) copyFileSync(join(repoRoot, "LICENSE"), licensePath);

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
      if (pinned.length > 0) {
        console.log(
          "\n=== Waiting until the pinned libs are installable from npm ===",
        );
        const registry = configuredRegistry();
        await waitForRegistry(pinned, version, {
          gapOf: (name, v) => installGap(name, v, { registry }),
        });
      }
      console.log(
        "\n=== Consumer-install smoke (over the stamped manifest) ===",
      );
      run("npm", ["run", "verify:consumer"], packageDir);
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
      if (licenseCopied) rmSync(licensePath, { force: true });
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
