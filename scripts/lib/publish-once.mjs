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
 * version's `dist.integrity` and `gitHead` (the commit npm recorded it was
 * published from) and compares the integrity with the tarball `npm publish`
 * would upload:
 *
 *   - the registry has no such version: publish;
 *   - it has the version with the same integrity: skip, and say so;
 *   - it has the version with other contents: refuse, naming both hashes,
 *     because the version would then mean two different packages, unless
 *     the run accepts what that one commit published (below).
 *
 * Some packages never rebuild byte for byte: `@stigmer/server-slim` carries
 * the web console's static export, whose Next build ID is random. A resumed
 * release can then only go on by keeping what is already on npm. The
 * dispatcher says so explicitly by naming the release's commit
 * (`PUBLISH_ONCE_ACCEPT_FROM`, the `accept_published_from` input of
 * `release.npm-libs.yaml`): a version on the registry with other contents is
 * skipped only when the registry's `gitHead` is exactly that commit, and the
 * log names both hashes. A tagged run never sets it.
 *
 * `--dry-run` rehearses `npm publish --dry-run` and never reads the registry.
 *
 * Every registry publish of the release and dev lanes goes through here:
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

const COMMIT = /^[0-9a-f]{40}$/;

/**
 * What to do with a package. `registry` is what the registry holds for its
 * exact version (`undefined` when it has none): `{ integrity, gitHead }`.
 * `local` is the integrity of the tarball this run would publish.
 * `acceptFrom` is the commit whose published bytes the run keeps when they
 * differ, or `undefined`.
 */
export function publishDecision(registry, local, acceptFrom) {
  if (!registry) return { act: "publish" };
  if (registry.integrity === local) return { act: "skip" };
  const differs = `the registry holds this version as ${registry.integrity} (published from ${registry.gitHead ?? "an unrecorded commit"}), and this run built ${local}`;
  if (acceptFrom && registry.gitHead === acceptFrom) {
    return {
      act: "skip",
      reason: `${differs}; kept, as published from the accepted commit`,
    };
  }
  return { act: "refuse", reason: differs };
}

/** The accepted commit from the environment: a full commit id, or `undefined`. */
export function acceptFromEnv(env = process.env) {
  const value = (env.PUBLISH_ONCE_ACCEPT_FROM ?? "").trim();
  if (value === "") return undefined;
  if (!COMMIT.test(value)) {
    throw new Error(
      `PUBLISH_ONCE_ACCEPT_FROM must be a full 40-character commit id, not "${value}"`,
    );
  }
  return value;
}

/** Whether a failed npm call's stderr means the package or version does not exist. */
export function isNotFound(stderr) {
  return /\bE404\b/.test(String(stderr));
}

/** Runs npm with `args` in `cwd`; returns stdout, or inherits the terminal when `inherit`. */
function runNpm(args, { cwd, inherit = false }) {
  if (inherit) {
    execFileSync("npm", args, { cwd, stdio: "inherit" });
    return "";
  }
  return execFileSync("npm", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** What the registry holds for name@version, or `undefined` when it has no such version. */
export function readRegistry(name, version, { cwd, npm = runNpm }) {
  let out;
  try {
    out = npm(
      ["view", `${name}@${version}`, "dist.integrity", "gitHead", "--json"],
      { cwd },
    ).trim();
  } catch (err) {
    if (isNotFound(err.stderr)) return undefined;
    throw err;
  }
  if (out === "") return undefined;
  const fields = JSON.parse(out);
  if (!fields["dist.integrity"]) return undefined;
  return { integrity: fields["dist.integrity"], gitHead: fields.gitHead };
}

/**
 * Publish `dir` (a directory holding the package.json to publish) under
 * `tag`, unless the registry already holds its version. npm runs in `cwd`
 * (where a caller's project `.npmrc` is read). Returns the act taken.
 */
export function publishOnce(
  dir,
  {
    tag,
    dryRun = false,
    cwd = process.cwd(),
    acceptFrom = acceptFromEnv(),
    npm = runNpm,
  },
) {
  const { name, version } = JSON.parse(
    readFileSync(resolve(dir, "package.json"), "utf8"),
  );
  if (!dryRun) {
    const registry = readRegistry(name, version, { cwd, npm });
    const local = registry
      ? JSON.parse(npm(["pack", dir, "--dry-run", "--json"], { cwd }))[0]
          .integrity
      : undefined;
    const decision = publishDecision(registry, local, acceptFrom);
    if (decision.act === "skip") {
      console.log(
        `  ${name}@${version} is already on the registry; skipped${decision.reason ? `: ${decision.reason}` : " (same contents)"}`,
      );
      return "skip";
    }
    if (decision.act === "refuse") {
      throw new Error(`${name}@${version}: ${decision.reason}`);
    }
  }
  const args = ["publish", dir, "--access", "public", "--tag", tag];
  if (dryRun) args.push("--dry-run");
  console.log(`  $ npm ${args.join(" ")}`);
  npm(args, { cwd, inherit: true });
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
