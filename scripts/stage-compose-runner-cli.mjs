#!/usr/bin/env node

/**
 * Stages the stigmer CLI the compose-runner image bakes
 * (backend/services/runner/Dockerfile.sandbox, the `compose-runner` stage)
 * into the directory that stage COPYs from — from this checkout's sources,
 * at one version, as npm tarballs.
 *
 * The compose-runner spawns `stigmer mcp-server` for the memory and channel
 * attachments, so the CLI must be in the image. It used to be installed from
 * the npm registry at the release version, seconds after the same workflow
 * run published it — and lost the registry's replication race on three
 * consecutive releases (stigmer/stigmer#1158). Now the image installs the
 * packages the run itself built: @stigmer/cli and its @stigmer/* closure,
 * packed by publish-libs.mjs from the same dist/ the registry receives, so
 * the image's CLI is provably this commit's and no build step waits on npm.
 * The all-in-one image (scripts/stage-all-in-one.mjs) has installed its
 * packages this way since it existed; this is the same mechanism narrowed
 * to one package's closure.
 *
 *   stage/cli/pkgs/*.tgz   @stigmer/cli plus every @stigmer/* package it
 *                          depends on, transitively (publish-libs.mjs
 *                          --pack-dir --only @stigmer/cli). One `npm install`
 *                          of all of them resolves our graph among the
 *                          tarballs; third-party deps come from the registry
 *                          as any `npm ci` does.
 *   stage/cli/VERSION      the stamped version; the Dockerfile's
 *                          STIGMER_CLI_VERSION build-arg must equal it (the
 *                          build asserts the installed CLI reports it).
 *
 * "Stage from what you have, build what you don't": by default the libs are
 * built first; --skip-build packs the dist/ already present (the release
 * lane, right after the publish step; the Makefile targets, after build-libs).
 *
 * Usage:
 *   node scripts/stage-compose-runner-cli.mjs [--version=<semver>] [--out=<dir>] [--skip-build]
 *
 *   --version  defaults to 0.0.0-dev.<short sha> (a from-source build).
 *   --out      defaults to backend/services/runner/stage/cli (the Dockerfile's COPY source).
 *
 * Plain node, no dependencies — runnable everywhere CI is.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));

/** The one package the image needs on PATH; its closure follows from the manifests. */
const CLI_PACKAGE = "@stigmer/cli";

function fail(message) {
  console.error(`stage-compose-runner-cli: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`stage-compose-runner-cli: ${step}`);
}

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

function parseArgs() {
  const opts = {
    version: "",
    out: join(repoRoot, "backend", "services", "runner", "stage", "cli"),
    skipBuild: false,
  };
  for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = arg.match(/^--version=(.+)$/)) !== null) opts.version = m[1];
    else if ((m = arg.match(/^--out=(.+)$/)) !== null) opts.out = resolve(m[1]);
    else if (arg === "--skip-build") opts.skipBuild = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (opts.version === "") opts.version = devVersion();
  return opts;
}

// A from-source build's version: npm-valid, unique per commit, and a
// prerelease no acquirer would download — fine, because the image bakes the
// packages and the CLI's version is informational inside a compose runner.
function devVersion() {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  return `0.0.0-dev.${sha}`;
}

function main() {
  const opts = parseArgs();
  log(`version ${opts.version}, out ${opts.out}`);

  rmSync(opts.out, { recursive: true, force: true });
  const pkgsDir = join(opts.out, "pkgs");
  mkdirSync(pkgsDir, { recursive: true });

  const args = [
    "scripts/publish-libs.mjs",
    "--version",
    opts.version,
    "--pack-dir",
    pkgsDir,
    "--only",
    CLI_PACKAGE,
  ];
  if (opts.skipBuild) args.push("--skip-build");
  run("node", args, { cwd: repoRoot });

  writeFileSync(join(opts.out, "VERSION"), `${opts.version}\n`);
  const staged = readdirSync(pkgsDir).sort();
  log(`staged ${staged.length} packages:\n  ${staged.join("\n  ")}`);
  log(
    `done — build with:\n  docker build --target compose-runner --build-arg STIGMER_CLI_VERSION=${opts.version} ` +
      `-f backend/services/runner/Dockerfile.sandbox -t stigmer-runner:local .`,
  );
}

main();
