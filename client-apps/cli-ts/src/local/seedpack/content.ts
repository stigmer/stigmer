// Resolution and on-demand acquisition of the seedpack content.
//
// The seedpack (system agents, skills, MCP servers, workflows under the
// "stigmer" org) is the TS equivalent of the Go CLI's `go:embed`-ed bundle.
// A lean `npx @stigmer/cli` must not carry ~300 content files (DD-002), so the
// content ships as `@stigmer/seedpack` and is acquired on demand — the same
// pattern as `@stigmer/runner-slim` and the managed Temporal binary.
//
// Two sources, tried in order (mirrors runtime/runner.ts):
//   1. A repo-tree checkout (dev): `<repo>/seedpack`.
//   2. The published `@stigmer/seedpack@<cli-version>`, installed on demand into
//      ~/.stigmer/runtimes/<version>/ and read from
//      node_modules/@stigmer/seedpack.
//
// The content-hash and extract logic mirror `@stigmer/seedpack` exactly (which
// in turn mirrors the Go `seedpack` package); the CLI reimplements them over a
// resolved directory so it stays decoupled from the package in the lean install
// (where the package is not a dependency, only an on-demand artifact).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";
import { log } from "../../logger.js";
import { VERSION } from "../../version.js";
import { runtimesDir } from "../paths.js";

const SEEDPACK_PACKAGE = "@stigmer/seedpack";

/**
 * The canonical seedpack entries, in apply-safe order. Kept in sync with
 * `SEEDPACK_ENTRIES` in `@stigmer/seedpack` and the `//go:embed` set in
 * `seedpack/embed.go` — `tools/` and `icons/` are deliberately excluded so the
 * content set (and thus the idempotency hash) is identical across delivery paths.
 */
export const SEEDPACK_ENTRIES = [
  "stigmer.yaml",
  "organizations",
  "skills",
  "agents",
  "workflows",
  "mcp-servers",
] as const;

/** Marker file recording the last successfully-applied content hash. */
export const MARKER_FILE = ".seedpack-bootstrapped";

export interface SeedpackContent {
  /** Absolute path to the content root (holds stigmer.yaml). */
  readonly dir: string;
  /** Where the content came from — surfaced in diagnostics. */
  readonly source: "repo" | "package";
}

export interface ResolveSeedpackOptions {
  home?: string;
  /** Release version of @stigmer/seedpack to acquire (defaults to the CLI version). */
  version?: string;
  /** npm install implementation (injectable for tests). */
  install?: (installDir: string, spec: string) => void;
}

/**
 * Resolve the seedpack content directory: a repo-tree checkout in dev, else the
 * on-demand-acquired `@stigmer/seedpack` package. Throws actionable guidance when
 * acquisition is not possible (non-release build, or a failed/incomplete install).
 */
export function resolveSeedpackContent(opts: ResolveSeedpackOptions = {}): SeedpackContent {
  const repo = repoSeedpackDir();
  if (repo !== null) return { dir: repo, source: "repo" };
  return { dir: acquireSeedpack(opts), source: "package" };
}

/**
 * Acquire the published `@stigmer/seedpack@<version>` into
 * ~/.stigmer/runtimes/<version>/ (idempotent) and return its package directory.
 * The version is pinned to the CLI's own version so system content stays in
 * lockstep with the control plane it bootstraps.
 */
export function acquireSeedpack(opts: ResolveSeedpackOptions = {}): string {
  const home = opts.home ?? homedir();
  const version = opts.version ?? VERSION;
  if (!isAcquirableRelease(version)) {
    throw new CliExitError(`cannot acquire ${SEEDPACK_PACKAGE} for a non-release build (${version})`, ExitCode.General, [
      "Run from the repo (the seedpack/ tree is used directly in dev).",
      "On-demand acquisition is only available for published releases.",
    ]);
  }

  const installDir = join(runtimesDir(home), version);
  const pkgDir = join(installDir, "node_modules", "@stigmer", "seedpack");
  const marker = join(pkgDir, "stigmer.yaml");

  if (!existsSync(marker)) {
    log.info(`acquiring ${SEEDPACK_PACKAGE}`, { version, dir: installDir });
    mkdirSync(installDir, { recursive: true });
    // A stable package.json root keeps the install deterministic. npm install is
    // additive and non-pruning, so this prefix is safely shared with the runner.
    const rootPkg = join(installDir, "package.json");
    if (!existsSync(rootPkg)) {
      writeFileSync(rootPkg, `${JSON.stringify({ name: "stigmer-runtime", private: true, version: "0.0.0" }, null, 2)}\n`);
    }
    const install = opts.install ?? installSeedpack;
    install(installDir, `${SEEDPACK_PACKAGE}@${version}`);
  }

  if (!existsSync(marker)) {
    throw new CliExitError(`${SEEDPACK_PACKAGE} install did not produce ${marker}`, ExitCode.General, [
      `Remove ${installDir} and retry.`,
    ]);
  }
  return pkgDir;
}

// Install the seedpack package into an isolated prefix. Output is inherited so
// the user sees the one-time download progress.
function installSeedpack(installDir: string, spec: string): void {
  try {
    execFileSync("npm", ["install", spec, "--prefix", installDir, "--omit=dev", "--no-audit", "--no-fund"], {
      stdio: "inherit",
    });
  } catch (err) {
    throw new CliExitError(`failed to install ${spec}`, ExitCode.General, [
      `Command: npm install ${spec} --prefix ${installDir}`,
      "Ensure npm is on PATH and the network is reachable.",
      String(err),
    ]);
  }
}

/**
 * Deterministic SHA-256 over the canonical content, identical to
 * `@stigmer/seedpack`'s `contentHash` (and the Go algorithm): files walked in
 * lexical order, each contributing its forward-slash relative path, a NUL, and
 * its bytes. Used as the idempotency marker.
 */
export function hashSeedpackContent(dir: string): string {
  const hash = createHash("sha256");
  for (const rel of listContentFiles(dir)) {
    hash.update(rel);
    hash.update(NUL);
    hash.update(readFileSync(join(dir, rel)));
  }
  return `sha256:${hash.digest("hex").slice(0, 16)}`;
}

/**
 * Copy the canonical entries from `srcDir` into `destDir`, producing a clean
 * Stigmer project the declarative-apply path can process directly (never
 * carrying build tooling or assets that happen to sit beside the content).
 */
export function extractSeedpack(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of SEEDPACK_ENTRIES) {
    const src = join(srcDir, entry);
    if (!existsSync(src)) continue;
    cpSync(src, join(destDir, entry), { recursive: true });
  }
}

const NUL = Uint8Array.of(0);

/** Lexically-sorted, forward-slash relative paths of every file under the canonical entries. */
export function listContentFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (abs: string): void => {
    for (const dirent of readdirSync(abs, { withFileTypes: true })) {
      const full = join(abs, dirent.name);
      if (dirent.isDirectory()) walk(full);
      else if (dirent.isFile()) files.push(toPosix(relative(root, full)));
    }
  };
  for (const entry of SEEDPACK_ENTRIES) {
    const abs = join(root, entry);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) walk(abs);
    else files.push(entry);
  }
  return files.sort();
}

/** The stored marker hash for `markerDir`, or null when never applied. */
export function readMarker(markerDir: string): string | null {
  try {
    return readFileSync(join(markerDir, MARKER_FILE), "utf8").trim() || null;
  } catch {
    return null;
  }
}

/** Persist the applied content hash so a future run can skip unchanged content. */
export function writeMarker(markerDir: string, hash: string): void {
  mkdirSync(markerDir, { recursive: true });
  writeFileSync(join(markerDir, MARKER_FILE), `${hash}\n`);
}

function toPosix(p: string): string {
  return sep === posix.sep ? p : p.split(sep).join(posix.sep);
}

// A source build reports "0.0.0-dev" and the dev channel stamps "<v>-dev.<stamp>";
// neither publishes a matching @stigmer/seedpack, so they are not acquirable.
function isAcquirableRelease(version: string): boolean {
  return !version.includes("-dev");
}

// Walk up from this module to a repo root containing seedpack/stigmer.yaml.
function repoSeedpackDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = join(dir, "seedpack");
    if (existsSync(join(candidate, "stigmer.yaml"))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
