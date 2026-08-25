// Resolution and on-demand acquisition of the TypeScript stigmer server —
// the served implementation since the DD-006 cutover (D4 #24) — plus the
// cutover switch itself (ensureServer).
//
// The server is launched exactly like the runner: a compiled `node main.js`,
// never `tsx src/main.ts` (the workers bundle Temporal workflows on boot in
// dev shape, and the slim artifact ships pre-built bundles — either way the
// entry must be compiled; see backend/services/stigmer-server-ts's
// workflow-source.ts).
//
// Resolution order (the D2 §6 switch semantics):
//   1. STIGMER_SERVER_BIN — the Go binary, the no-code-change ROLLBACK lever.
//      Checked before anything else, deliberately before the Node capability
//      probe: rollback must work even on a Node the TS server rejects.
//   2. STIGMER_SERVER_DIR — an explicit TS server package dir (dist/main.js
//      required), the STIGMER_RUNNER_DIR mirror.
//   3. The repo-tree backend/services/stigmer-server-ts (dev; build required).
//   4. The published `@stigmer/server-slim`, installed on demand into
//      ~/.stigmer/runtimes/<version>/ alongside the runner's package — one
//      CJS main.js, pre-built workflow bundles, and the per-platform
//      Temporal native bridge selected by npm via optionalDependencies.
//
// The Go binary ladder (./server.ts) remains intact behind the override —
// re-flipping ensureServer back to it is the whole rollback (D2 §6). The
// Go ladder and its GitHub-release download die with #25 go-server-retirement.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";
import { log } from "../../logger.js";
import { VERSION } from "../../version.js";
import { runtimesDir } from "../paths.js";
import type { ServerLaunch } from "../daemon/env.js";
import { resolveServerNode } from "./node.js";
import {
  ensureRuntimesRoot,
  isAcquirableRelease,
  npmInstallIntoRuntimes,
  type NpmInstall,
} from "./runtimes-install.js";

const SLIM_PACKAGE = "@stigmer/server-slim";

export interface EnsureServerOptions {
  home?: string;
  /** Release version of the slim server to acquire (defaults to the CLI version). */
  version?: string;
  /** Node resolver (injectable for tests). */
  node?: () => string;
  /** npm install implementation (injectable for tests). */
  install?: NpmInstall;
}

/**
 * THE cutover switch (D4 #24): resolve what the daemon launches as
 * `stigmer-server`. Honors the STIGMER_SERVER_BIN rollback override first;
 * otherwise resolves the TS server (explicit dir → repo tree → acquire the
 * published slim package). Throws actionable guidance on a missing build, an
 * invalid override, or a non-release CLI build with nothing local.
 */
export function ensureServer(opts: EnsureServerOptions = {}): ServerLaunch {
  const binOverride = process.env.STIGMER_SERVER_BIN;
  if (binOverride !== undefined && binOverride !== "") {
    if (!existsSync(binOverride)) {
      throw new CliExitError(
        `STIGMER_SERVER_BIN does not exist: ${binOverride}`,
        ExitCode.General,
        [
          "Point STIGMER_SERVER_BIN at a stigmer-server executable (the Go rollback",
          "binary), or unset it to launch the TypeScript server.",
        ],
      );
    }
    return { kind: "binary", bin: binOverride };
  }

  const node = opts.node ?? resolveServerNode;
  const local = resolveServerTs(node);
  if (local !== null) return local;
  return acquireServer({ ...opts, node });
}

/**
 * Resolve a repo-tree TS server (dev) or an explicit STIGMER_SERVER_DIR, or
 * null when neither is present (the caller then acquires the slim package).
 * Throws when an override is set but invalid, or when a found server is not
 * built — both are actionable user-facing conditions, not a reason to
 * silently download. `node` is injectable for tests.
 */
export function resolveServerTs(
  node: () => string = resolveServerNode,
): ServerLaunch | null {
  const override = process.env.STIGMER_SERVER_DIR;
  if (override !== undefined && override !== "") {
    if (!hasPackageJson(override)) {
      throw new CliExitError(
        `STIGMER_SERVER_DIR is not a server package: ${override}`,
        ExitCode.General,
        [
          "Point STIGMER_SERVER_DIR at the @stigmer/server package directory (the one with package.json).",
        ],
      );
    }
    return resolveBuiltServer(override, node);
  }

  const root = repoRoot();
  if (root !== null) {
    const candidate = join(root, "backend", "services", "stigmer-server-ts");
    if (hasPackageJson(candidate)) return resolveBuiltServer(candidate, node);
  }
  return null;
}

/**
 * Acquire the published `@stigmer/server-slim@<version>` into
 * ~/.stigmer/runtimes/<version>/ (idempotent: reuses a prior install; shares
 * the install root with the runner's package) and resolve its `main.js`
 * entry. The version is pinned to the CLI's own version so the server's
 * protos and behavior stay in lockstep with the CLI and the runner.
 */
export function acquireServer(opts: EnsureServerOptions = {}): ServerLaunch {
  const home = opts.home ?? homedir();
  const version = opts.version ?? VERSION;
  if (!isAcquirableRelease(version)) {
    throw new CliExitError(
      `cannot acquire ${SLIM_PACKAGE} for a non-release build (${version})`,
      ExitCode.General,
      [
        "Run from the repo with a built server (make build-server-ts), or set",
        "STIGMER_SERVER_DIR — or STIGMER_SERVER_BIN for the Go rollback binary.",
        "On-demand acquisition is only available for published releases.",
      ],
    );
  }

  // Probe the Node capability BEFORE the download: a user on an FTS5-less
  // Node must not fetch the full slim artifact only to be rejected after.
  const node = opts.node ?? resolveServerNode;
  const nodeBin = node();
  const installDir = join(runtimesDir(home), version);
  const entryPath = join(
    installDir,
    "node_modules",
    "@stigmer",
    "server-slim",
    "main.js",
  );

  if (!existsSync(entryPath)) {
    log.info(`acquiring ${SLIM_PACKAGE}`, { version, dir: installDir });
    ensureRuntimesRoot(installDir);
    const install = opts.install ?? npmInstallIntoRuntimes;
    install(installDir, `${SLIM_PACKAGE}@${version}`);
  }

  if (!existsSync(entryPath)) {
    throw new CliExitError(
      `${SLIM_PACKAGE} install did not produce ${entryPath}`,
      ExitCode.General,
      [
        "The install may have skipped the platform-native package for this OS/arch.",
        `Remove ${installDir} and retry, or set STIGMER_SERVER_DIR to a built server.`,
      ],
    );
  }

  return {
    kind: "node",
    nodeBin,
    entryPath,
    appDir: dirname(entryPath),
  };
}

function resolveBuiltServer(appDir: string, node: () => string): ServerLaunch {
  const entryPath = join(appDir, "dist", "main.js");
  if (!existsSync(entryPath)) {
    throw new CliExitError(
      `TS server not built: ${entryPath} is missing`,
      ExitCode.General,
      [
        "Build it with: make build-server-ts",
        "The server must be compiled — it cannot run from source via tsx (its",
        "Temporal workers bundle workflow code from the compiled dist).",
        "STIGMER_SERVER_DIR expects the source package (dist/main.js); to run an",
        "acquired @stigmer/server-slim install, unset it — the CLI resolves that",
        "shape itself. To launch the Go server instead, set STIGMER_SERVER_BIN.",
      ],
    );
  }
  return { kind: "node", nodeBin: node(), entryPath, appDir };
}

function hasPackageJson(dir: string): boolean {
  return existsSync(join(dir, "package.json"));
}

// Walk up from this module to a repo root containing the TS server package.
function repoRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    if (
      existsSync(
        join(dir, "backend", "services", "stigmer-server-ts", "package.json"),
      )
    )
      return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
