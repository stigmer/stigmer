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
 *   4. Wait until every pinned lib is queryable on npm at that version
 *      (the `publish` job already put them there; this absorbs registry
 *      propagation lag so the install below cannot race it).
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

const WAIT_ATTEMPTS = 30;
const WAIT_INTERVAL_MS = 10_000;

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

function isOnRegistry(name, version) {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

async function waitForRegistry(names, version) {
  for (const name of names) {
    console.log(`  confirming ${name}@${version} is queryable on npm...`);
    let found = false;
    for (let attempt = 1; attempt <= WAIT_ATTEMPTS; attempt++) {
      if (isOnRegistry(name, version)) {
        found = true;
        break;
      }
      console.log(
        `  attempt ${attempt}/${WAIT_ATTEMPTS}: not yet visible, waiting ${WAIT_INTERVAL_MS / 1000}s...`,
      );
      await new Promise((r) => setTimeout(r, WAIT_INTERVAL_MS));
    }
    if (!found) {
      throw new Error(
        `${name}@${version} not visible on npm after ${(WAIT_ATTEMPTS * WAIT_INTERVAL_MS) / 60_000} minutes — ` +
          `did the libs publish job succeed?`,
      );
    }
    console.log(`  found ${name}@${version}`);
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
        await waitForRegistry(pinned, version);
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
