#!/usr/bin/env node

/**
 * Stages @stigmer/server the way a consumer installs it: the server tarball
 * and every @stigmer/* package it depends on, packed from THIS checkout at
 * one version. A consumer that pins the library at an exact release (the
 * cloud composition) installs the set to run its own suite against an
 * unreleased server change (committed or not, pushed or not) with nothing
 * published and nothing written to its manifest.
 *
 * Why tarballs and not `npm link`: a linked package resolves its own
 * dependencies from this checkout's node_modules, so the consumer's tree
 * gets a second copy of every package the server declares must exist once
 * (`stigmerPublish.consumerCheck.singleCopy`: a split @temporalio/proto
 * breaks the payload codec, the #786 class; a split @bufbuild/protobuf or
 * @opentelemetry/api goes silently inert). A tarball carries no
 * node_modules: the consumer's install resolves its dependencies against
 * the consumer's own tree, exactly as a release would.
 *
 *   <out>/pkgs/*.tgz   the server (publish-standalone.mjs --pack-dir) and
 *                      the @stigmer/* closure of its `file:` links
 *                      (publish-libs.mjs --pack-dir, one --only per link),
 *                      every @stigmer/* edge pinned to the one version. One
 *                      `npm install` of all of them resolves our graph among
 *                      the tarballs; third-party deps come from the registry
 *                      as any install does.
 *   <out>/VERSION      the stamped version.
 *
 * The version defaults to 0.0.0-local.<UTC stamp>, not the stage
 * precedent's 0.0.0-dev.<sha> (scripts/stage-compose-runner-cli.mjs): what
 * is staged is usually a working tree with uncommitted edits, so a sha does
 * not identify it, and two stages of different contents must not look like
 * one version to npm. "local" says that no registry holds it.
 *
 * "Stage from what you have, build what you don't": by default the TS
 * stubs (`make -C apis ts-stubs`, which regenerates only when the protos
 * changed), the server's libs and the server (`make build-server`) are
 * built first; --skip-build packs the dist/ already present.
 *
 * Usage:
 *   node scripts/stage-server-library.mjs [--version=<semver>] [--out=<dir>] [--skip-build]
 *
 *   --version  defaults to 0.0.0-local.<UTC stamp>.
 *   --out      defaults to backend/services/stigmer-server/stage/library.
 *
 * Plain node, no dependencies — runnable everywhere CI is.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const serverRoot = join(repoRoot, "backend", "services", "stigmer-server");

function fail(message) {
  console.error(`stage-server-library: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`stage-server-library: ${step}`);
}

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

/** Parses `--version=`, `--out=` and `--skip-build`; throws on anything else. */
export function parseArgs(
  argv,
  { now = new Date(), cwd = process.cwd() } = {},
) {
  const opts = {
    version: "",
    out: join(serverRoot, "stage", "library"),
    skipBuild: false,
  };
  for (const arg of argv) {
    let m;
    if ((m = arg.match(/^--version=(.+)$/)) !== null) opts.version = m[1];
    else if ((m = arg.match(/^--out=(.+)$/)) !== null)
      opts.out = resolve(cwd, m[1]);
    else if (arg === "--skip-build") opts.skipBuild = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (opts.version === "") opts.version = localVersion(now);
  return opts;
}

/** 0.0.0-local.<YYYYMMDDHHMMSS UTC>: npm-valid, unique per stage, never a registry version. */
export function localVersion(date) {
  const stamp = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return `0.0.0-local.${stamp}`;
}

/**
 * The @stigmer/* packages a standalone manifest links from this checkout
 * (`file:` specs), sorted. These are the roots of the lib closure the
 * server's tarball needs beside it; a dependency already pinned to a
 * version is the registry's to serve and is not staged.
 */
export function linkedLibs(manifest) {
  return Object.entries(manifest.dependencies ?? {})
    .filter(
      ([name, spec]) =>
        name.startsWith("@stigmer/") && spec.startsWith("file:"),
    )
    .map(([name]) => name)
    .sort();
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  log(`version ${opts.version}, out ${opts.out}`);

  if (!opts.skipBuild) {
    run("make", ["-C", "apis", "ts-stubs"], { cwd: repoRoot });
    run("make", ["build-server"], { cwd: repoRoot });
  } else if (!existsSync(join(serverRoot, "dist", "main.js"))) {
    fail(
      "backend/services/stigmer-server/dist/main.js not found — run without --skip-build, or `make build-server` first",
    );
  }

  // Only what this script writes is cleared, so an --out that holds other
  // files keeps them.
  const pkgsDir = join(opts.out, "pkgs");
  rmSync(pkgsDir, { recursive: true, force: true });
  rmSync(join(opts.out, "VERSION"), { force: true });
  mkdirSync(pkgsDir, { recursive: true });

  const manifest = JSON.parse(
    readFileSync(join(serverRoot, "package.json"), "utf8"),
  );
  const libs = linkedLibs(manifest);
  if (libs.length > 0) {
    run(
      "node",
      [
        "scripts/publish-libs.mjs",
        "--version",
        opts.version,
        "--pack-dir",
        pkgsDir,
        ...libs.flatMap((name) => ["--only", name]),
        "--skip-build",
      ],
      { cwd: repoRoot },
    );
  }
  run(
    "node",
    [
      "scripts/publish-standalone.mjs",
      "--package",
      "backend/services/stigmer-server",
      "--version",
      opts.version,
      "--pack-dir",
      pkgsDir,
    ],
    { cwd: repoRoot },
  );

  writeFileSync(join(opts.out, "VERSION"), `${opts.version}\n`);
  const staged = readdirSync(pkgsDir).sort();
  log(`staged ${staged.length} packages:\n  ${staged.join("\n  ")}`);
  log(
    `done — a consumer installs them in one command:\n  npm install --no-save ${join(pkgsDir, "*.tgz")}`,
  );
}

// Only run when invoked directly (not when imported by tests).
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main();
}
