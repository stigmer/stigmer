#!/usr/bin/env node
/**
 * publish-once.mjs — publish one package directory to npm so that a release
 * run that stopped part-way can be run again.
 *
 * A version on npm can never be published twice. A release's npm run that
 * stopped after some packages were out (a cancel, a lost runner, a registry
 * hiccup) used to fail its rerun at the first package already there, so
 * every package and job after it never ran for that version
 * (stigmer/stigmer#3168). Before publishing, this asks the registry for the
 * version's `dist.integrity` and compares it with the tarball `npm publish`
 * would upload:
 *
 *   - the registry has no such version: publish;
 *   - it has the version with the same integrity: skip, and say so;
 *   - it has the version with other contents: refuse, naming both hashes,
 *     because the version would then mean two different packages.
 *
 * `--dry-run` skips the registry read and rehearses `npm publish --dry-run`.
 *
 * Every registry publish in the release lane goes through here:
 * `scripts/publish-libs.mjs`, `scripts/publish-standalone.mjs`, and the slim
 * packages' loops in `.github/workflows/release.npm-libs.yaml`. The registry
 * and credentials are npm's own configuration, as for a bare `npm publish`.
 *
 * Usage:
 *   node scripts/lib/publish-once.mjs <package dir> --tag <dist-tag> [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * What to do with a package, from the integrity the registry holds for its
 * exact version (`undefined` when it has none) and the integrity of the
 * tarball this run would publish.
 */
export function publishDecision(registryIntegrity, localIntegrity) {
  if (!registryIntegrity) return { act: "publish" };
  if (registryIntegrity === localIntegrity) return { act: "skip" };
  return {
    act: "refuse",
    reason: `the registry already holds this version as ${registryIntegrity}, and this run built ${localIntegrity}`,
  };
}

/** Whether an `npm view` failure means the package or version does not exist. */
export function isNotFound(stderr) {
  return /\bE404\b/.test(String(stderr));
}

function registryIntegrity(name, version, cwd) {
  try {
    const out = execFileSync(
      "npm",
      ["view", `${name}@${version}`, "dist.integrity"],
      {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ).trim();
    return out || undefined;
  } catch (err) {
    if (isNotFound(err.stderr)) return undefined;
    throw err;
  }
}

function localIntegrity(dir, cwd) {
  const out = execFileSync("npm", ["pack", dir, "--dry-run", "--json"], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return JSON.parse(out)[0].integrity;
}

/**
 * Publish `dir` (a directory holding the package.json to publish) under
 * `tag`, unless the registry already holds its version. npm runs in `cwd`
 * (where a caller's project `.npmrc` is read). Returns the act taken.
 */
export function publishOnce(dir, { tag, dryRun = false, cwd = process.cwd() }) {
  const { name, version } = JSON.parse(
    readFileSync(resolve(dir, "package.json"), "utf8"),
  );
  // A rehearsal sends nothing, so it never asks the registry: it behaves
  // the same whatever the registry already holds.
  const decision = dryRun
    ? { act: "publish" }
    : publishDecision(
        registryIntegrity(name, version, cwd),
        localIntegrity(dir, cwd),
      );
  if (decision.act === "skip") {
    console.log(
      `  ${name}@${version} is already on the registry with the same contents; skipped`,
    );
    return "skip";
  }
  if (decision.act === "refuse") {
    throw new Error(`${name}@${version}: ${decision.reason}`);
  }
  const args = ["publish", dir, "--access", "public", "--tag", tag];
  if (dryRun) args.push("--dry-run");
  console.log(`  $ npm ${args.join(" ")}`);
  execFileSync("npm", args, { cwd, stdio: "inherit" });
  return "publish";
}

/** The command line: `<dir> --tag <tag> [--dry-run]`. */
export function parseArgs(argv) {
  const tagAt = argv.indexOf("--tag");
  const tag = tagAt >= 0 ? argv[tagAt + 1] : undefined;
  const dir = argv.find((arg, i) => !arg.startsWith("--") && i !== tagAt + 1);
  if (!dir || !tag) {
    throw new Error(
      "usage: publish-once.mjs <package dir> --tag <dist-tag> [--dry-run]",
    );
  }
  return { dir: resolve(dir), tag, dryRun: argv.includes("--dry-run") };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const { dir, tag, dryRun } = parseArgs(process.argv.slice(2));
    publishOnce(dir, { tag, dryRun });
  } catch (err) {
    console.error(`publish-once: ${err.message}`);
    process.exit(1);
  }
}
