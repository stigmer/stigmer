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
 *   4. Wait until npm serves every pinned lib at that version to an
 *      install. The `publish` job already put them there (it is this job's
 *      hard `needs:`), so the wait only absorbs the registry's propagation
 *      lag, and the install below cannot race it. "Served" is read from the
 *      document `npm install` itself resolves against, the abbreviated
 *      install metadata (`installDocumentServes`), because npm caches it
 *      apart from the full document `npm view` reads, so the two can
 *      disagree while a version propagates. The libs publish together, so
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
 * Usage:
 *   node scripts/publish-standalone.mjs --package backend/services/runner --version 3.14.0
 *   node scripts/publish-standalone.mjs --package backend/services/stigmer-server --version 3.14.1-dev.20260910 --tag dev
 *   node scripts/publish-standalone.mjs --package ... --version ... --dry-run
 *
 * Authentication is npm's own (NODE_AUTH_TOKEN with setup-node's
 * registry-url, as the workflows configure). Needs a prior build of the
 * package and of the workspace libs it links.
 */

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
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
      "usage: publish-standalone.mjs --package <dir> --version <semver> [--tag <tag>] [--dry-run]",
    );
  }
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(
      `--version must be a semver or semver pre-release, got '${version}'`,
    );
  }
  return {
    packageDir,
    version,
    tag: value("--tag"),
    dryRun: argv.includes("--dry-run"),
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
 * Whether the registry's install metadata for `name` lists `version`: the
 * document an install resolves the pin against. A scoped name keeps its `@`
 * and encodes its `/`, as npm's own client does. A version the document
 * does not list, a 404 and a fault all answer false: the wait asks again
 * until its deadline, and its refusal names what is still missing.
 */
export async function installDocumentServes(
  name,
  version,
  { registry, fetchImpl = fetch },
) {
  const base = registry.endsWith("/") ? registry : `${registry}/`;
  const url = `${base}${name.replace("/", "%2f")}`;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: INSTALL_METADATA_ACCEPT },
    });
    if (!response.ok) return false;
    const document = await response.json();
    return Object.hasOwn(document?.versions ?? {}, version);
  } catch {
    return false;
  }
}

/** The registry the job's npm is configured for (setup-node writes it). */
function configuredRegistry() {
  return execFileSync("npm", ["config", "get", "registry"], {
    encoding: "utf8",
  }).trim();
}

/**
 * The wait's refusal: the libs are published (the libs job is this job's
 * hard dependency) and npm has not served them yet. It names the recovery,
 * rerunning only the failed job, which resumes here with the libs in place.
 */
export function registryLagMessage(names, version, budgetMs, runId) {
  const libs = names.map((name) => `${name}@${version}`).join(", ");
  const rerun = `gh run rerun ${runId ?? "<run-id>"} --failed`;
  return (
    `${libs} published by the libs job but not served by npm after ` +
    `${budgetMs / 60_000} minutes; the registry is lagging. ` +
    `Rerun the failed job once npm serves ${names.length === 1 ? "it" : "them"}: ${rerun}`
  );
}

/**
 * Polls until npm serves every name at `version` or the budget is spent.
 * All names share one deadline and each round asks only about the ones
 * still missing. The interval doubles from `firstIntervalMs` to
 * `maxIntervalMs`, and the last sleep is cut to the deadline. The clock,
 * the sleep and the registry query are parameters, so the schedule is
 * tested without a registry or real time.
 */
export async function waitForRegistry(
  names,
  version,
  {
    isVisible,
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
    const served = await Promise.all(
      pending.map((name) => isVisible(name, version)),
    );
    pending = pending.filter((name, i) => {
      if (!served[i]) return true;
      log(`  served: ${name}@${version}`);
      return false;
    });
    if (pending.length === 0) return;
    const remaining = deadline - now();
    if (remaining <= 0) {
      throw new Error(registryLagMessage(pending, version, budgetMs, runId));
    }
    const wait = Math.min(interval, remaining);
    log(
      `  not yet served: ${pending.map((name) => `${name}@${version}`).join(", ")}; ` +
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
  console.log(`  tag:     ${tag}`);
  console.log(
    `  pinned:  ${pinned.length > 0 ? pinned.map((n) => `${n}@${version}`).join(", ") : "(none)"}`,
  );
  console.log(`  dry-run: ${dryRun}\n`);

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

    console.log("\n=== Published file list ===");
    run("npm", ["pack", "--dry-run"], packageDir);

    if (!dryRun) {
      if (pinned.length > 0) {
        console.log("\n=== Waiting for the pinned libs on npm ===");
        const registry = configuredRegistry();
        await waitForRegistry(pinned, version, {
          isVisible: (name, v) => installDocumentServes(name, v, { registry }),
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
    if (dryRun) {
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
