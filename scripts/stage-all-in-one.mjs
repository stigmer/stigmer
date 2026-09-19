#!/usr/bin/env node

/**
 * Stages everything the all-in-one image bakes (deploy/all-in-one/Dockerfile)
 * into one directory the Dockerfile COPYs from — for THIS host's arch, from
 * this checkout's sources, at one version.
 *
 * The image is a pre-warmed `stigmer up`: every package the CLI would acquire
 * on a fresh laptop, pre-installed into the CLI's own runtimes layout, plus
 * the CLI itself and the Temporal binary. So what is staged is exactly the
 * npm packages a release publishes, packed from source instead of fetched:
 *
 *   stage/pkgs/*.tgz     every workspace package (the CLI, its @stigmer/*
 *                        deps, the plugin catalogue) via publish-libs.mjs --pack-dir,
 *                        plus @stigmer/server-slim and @stigmer/runner-slim
 *                        with THIS arch's native-bridge platform package,
 *                        via each service's bundle-slim.mjs --emit-packages.
 *                        The Dockerfile installs them all into one prefix;
 *                        our @stigmer/* graph resolves among the tarballs,
 *                        third-party deps come from the registry as any
 *                        `npm ci` does. The npm shape (not the self-contained
 *                        tree) is deliberate: it stages from any host, where
 *                        the self-contained runner tree needs the target
 *                        platform's node_modules (bundle-slim.mjs).
 *   stage/temporal       the Temporal CLI for linux/<arch>, downloaded and
 *                        checksum-verified by the CLI's own downloader — one
 *                        pin, one verification, for `stigmer up` and the image.
 *   stage/VERSION        the stamped version; the Dockerfile's STIGMER_VERSION
 *                        build-arg must equal it (the build asserts).
 *
 * "Stage from what you have, build what you don't": a pre-packed workspace
 * tarball set (the release lane's artifact) is accepted with --pkgs-dir;
 * otherwise the packages are built and packed here. The server and runner
 * must already be built (make build-server build-web build-runner); the
 * script says so when they are not.
 *
 * Usage:
 *   node scripts/stage-all-in-one.mjs [--version=<semver>] [--arch=amd64|arm64]
 *       [--out=<dir>] [--pkgs-dir=<dir>] [--skip-build]
 *
 *   --version  defaults to 0.0.0-dev.<short sha> (a from-source build).
 *   --arch     defaults to this host's; the image is built natively per arch.
 *   --out      defaults to deploy/all-in-one/stage (the Dockerfile's context).
 *
 * Plain node, no dependencies — runnable everywhere CI is.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const serverRoot = join(repoRoot, "backend", "services", "stigmer-server");
const runnerRoot = join(repoRoot, "backend", "services", "runner");
const cliRoot = join(repoRoot, "client-apps", "cli");

function fail(message) {
  console.error(`stage-all-in-one: ${message}`);
  process.exit(1);
}

function log(step) {
  console.log(`stage-all-in-one: ${step}`);
}

function run(command, args, options = {}) {
  log(`$ ${command} ${args.join(" ")}`);
  execFileSync(command, args, { stdio: "inherit", ...options });
}

/** node's arch names map straight onto docker's TARGETARCH for our two. */
function hostArch() {
  if (process.arch === "x64") return "amd64";
  if (process.arch === "arm64") return "arm64";
  fail(`unsupported host arch "${process.arch}" — the image ships amd64 + arm64 only`);
}

function parseArgs() {
  const opts = { version: "", arch: hostArch(), out: join(repoRoot, "deploy", "all-in-one", "stage"), pkgsDir: "", skipBuild: false };
  for (const arg of process.argv.slice(2)) {
    let m;
    if ((m = arg.match(/^--version=(.+)$/)) !== null) opts.version = m[1];
    else if ((m = arg.match(/^--arch=(amd64|arm64)$/)) !== null) opts.arch = m[1];
    else if ((m = arg.match(/^--out=(.+)$/)) !== null) opts.out = resolve(m[1]);
    else if ((m = arg.match(/^--pkgs-dir=(.+)$/)) !== null) opts.pkgsDir = resolve(m[1]);
    else if (arg === "--skip-build") opts.skipBuild = true;
    else fail(`unknown argument: ${arg}`);
  }
  if (opts.version === "") opts.version = devVersion();
  return opts;
}

// A from-source build's version: npm-valid, unique per commit, and a
// prerelease the CLI's acquirers would refuse to DOWNLOAD — which is fine,
// because the image bakes everything and presence beats acquirability.
function devVersion() {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  return `0.0.0-dev.${sha}`;
}

/** The bundle-slim platform token for linux on a docker arch. */
function slimPlatform(arch) {
  return arch === "amd64" ? "linux-x64" : "linux-arm64";
}

function requireBuilt(path, hint) {
  if (!existsSync(path)) fail(`${path} not found — build it first:\n  ${hint}`);
}

function packDir(dir, pkgsDir) {
  execFileSync("npm", ["pack", dir, "--pack-destination", pkgsDir, "--silent"], { stdio: ["ignore", "ignore", "inherit"] });
}

/** Workspace packages: the CLI, its @stigmer/* deps, the plugin catalogue — every non-private member. */
function stageWorkspacePackages(opts, pkgsDir) {
  if (opts.pkgsDir !== "") {
    const tarballs = readdirSync(opts.pkgsDir).filter((f) => f.endsWith(".tgz"));
    if (tarballs.length === 0) fail(`--pkgs-dir ${opts.pkgsDir} holds no .tgz files`);
    log(`copying ${tarballs.length} pre-packed workspace tarballs from ${opts.pkgsDir}`);
    for (const f of tarballs) cpSync(join(opts.pkgsDir, f), join(pkgsDir, f));
    return;
  }
  const args = ["scripts/publish-libs.mjs", "--version", opts.version, "--pack-dir", pkgsDir];
  if (opts.skipBuild) args.push("--skip-build");
  run("node", args, { cwd: repoRoot });
}

/** @stigmer/server-slim + this arch's platform package, from the built server and console. */
function stageServerPackages(opts, pkgsDir) {
  requireBuilt(join(serverRoot, "dist", "main.js"), "make build-server");
  requireBuilt(join(repoRoot, "client-apps", "web", "out", "index.html"), "make build-web");
  run("node", ["scripts/bundle-slim.mjs", "--emit-packages", `--version=${opts.version}`], {
    cwd: serverRoot,
    // The define the release lane sets (getServerInfo reports the version).
    env: { ...process.env, STIGMER_SERVER_VERSION: opts.version },
  });
  packDir(join(serverRoot, "dist-slim-pkgs", "server-slim"), pkgsDir);
  packDir(join(serverRoot, "dist-slim-pkgs", `server-slim-${slimPlatform(opts.arch)}`), pkgsDir);
}

/** @stigmer/runner-slim + this arch's platform package, from the built runner. */
function stageRunnerPackages(opts, pkgsDir) {
  requireBuilt(join(runnerRoot, "dist", "main.js"), "make build-runner");
  run("node", ["scripts/bundle-slim.mjs", "--emit-packages", `--version=${opts.version}`], { cwd: runnerRoot });
  packDir(join(runnerRoot, "dist-slim-pkgs", "runner-slim"), pkgsDir);
  packDir(join(runnerRoot, "dist-slim-pkgs", `runner-slim-${slimPlatform(opts.arch)}`), pkgsDir);
}

/**
 * The Temporal CLI for linux/<arch>, through the CLI's own downloader (built
 * by the workspace build above): the version pin and the checksums.txt
 * verification are the ones `stigmer up` uses, so the image and the laptop
 * run the same bytes, proven the same way.
 */
async function stageTemporal(opts, outDir) {
  const downloader = join(cliRoot, "dist", "local", "temporal", "download.js");
  requireBuilt(downloader, "npm run build -w @stigmer/cli (or drop --skip-build)");
  const { DEFAULT_TEMPORAL_VERSION, downloadTemporalCli } = await import(pathToFileURL(downloader).href);
  const binPath = join(outDir, "temporal");
  log(`downloading Temporal CLI ${DEFAULT_TEMPORAL_VERSION} for linux/${opts.arch} (checksum-verified)`);
  await downloadTemporalCli({
    version: DEFAULT_TEMPORAL_VERSION,
    binPath,
    platform: "linux",
    arch: opts.arch === "amd64" ? "x64" : "arm64",
  });
}

async function main() {
  const opts = parseArgs();
  log(`version ${opts.version}, arch ${opts.arch}, out ${opts.out}`);

  rmSync(opts.out, { recursive: true, force: true });
  const pkgsDir = join(opts.out, "pkgs");
  mkdirSync(pkgsDir, { recursive: true });

  stageWorkspacePackages(opts, pkgsDir);
  stageServerPackages(opts, pkgsDir);
  stageRunnerPackages(opts, pkgsDir);
  await stageTemporal(opts, opts.out);

  writeFileSync(join(opts.out, "VERSION"), `${opts.version}\n`);
  const staged = readdirSync(pkgsDir).sort();
  log(`staged ${staged.length} packages:\n  ${staged.join("\n  ")}`);
  log(`done — build with:\n  docker build --build-arg STIGMER_VERSION=${opts.version} -t stigmer-all-in-one:local deploy/all-in-one`);
}

await main();
