// Resolution and on-demand acquisition of the official marketplace.
//
// The official catalogue (`plugins/` in the OSS repository, published as
// `@stigmer/plugins`) is what `stigmer install <name>` reads when no other
// marketplace is named, so it follows the server's and the runner's rule:
// acquired at the CLI's OWN version, so the plugins it installs match the
// control plane that serves them. A lean `npx @stigmer/cli` does not carry the
// content; it is fetched once, the first time an install needs it, into
// ~/.stigmer/runtimes/<version>/ like the server and the runner.
//
// Two sources, tried in order (mirrors runtime/server.ts and runtime/runner.ts):
//   1. A repo-tree checkout (dev): `<repo>/plugins`, the tree itself.
//   2. The published `@stigmer/plugins@<cli-version>`, whose package root IS
//      the marketplace tree (`publish-libs.mjs` publishes from `dist/`, where
//      `stage-content.mjs` placed `marketplace.json` and every listed plugin).
//
// Presence beats acquirability (the server acquirer's rule): installed content
// is used whatever its version string; only an install we would have to
// perform is refused for a non-release build. The all-in-one image relies on
// this: it bakes the package at a dev-stamped version npm never published.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MARKETPLACE_LOCATIONS } from "@stigmer/plugin-package";
import { CliExitError } from "../errors/cli-exit-error.js";
import { ExitCode } from "../errors/exit-codes.js";
import { log } from "../logger.js";
import { runtimesDir } from "../local/paths.js";
import {
  ensureRuntimesRoot,
  isAcquirableRelease,
  npmInstallIntoRuntimes,
  type NpmInstall,
} from "../local/runtime/runtimes-install.js";
import { VERSION } from "../version.js";

const PLUGINS_PACKAGE = "@stigmer/plugins";

/** The file that makes a directory the official tree: Stigmer's own marketplace dialect at the root. */
const OFFICIAL_MARKER = MARKETPLACE_LOCATIONS.stigmer;

export interface OfficialMarketplaceDir {
  /** Absolute path to the tree root (holds `marketplace.json`). */
  readonly dir: string;
  /** Where the tree came from, for diagnostics. */
  readonly source: "repo" | "package";
}

export interface ResolveOfficialOptions {
  home?: string;
  /** Release version of `@stigmer/plugins` to acquire (defaults to the CLI version). */
  version?: string;
  /** npm install implementation (injectable for tests). */
  install?: NpmInstall;
  /** The repo-tree probe (injectable for tests; the default walks up from this module). */
  repoDir?: () => string | null;
}

/**
 * The official marketplace's directory: a repo-tree checkout in dev, else the
 * on-demand-acquired package. Throws actionable guidance when acquisition is
 * not possible (a non-release build with no checkout, a failed install).
 */
export function resolveOfficialMarketplace(
  opts: ResolveOfficialOptions = {},
): OfficialMarketplaceDir {
  const repo = (opts.repoDir ?? repoPluginsDir)();
  if (repo !== null) return { dir: repo, source: "repo" };
  return { dir: acquireOfficialMarketplace(opts), source: "package" };
}

/**
 * Acquire `@stigmer/plugins@<version>` into ~/.stigmer/runtimes/<version>/
 * (idempotent) and return the package directory, which is the tree root.
 */
export function acquireOfficialMarketplace(
  opts: ResolveOfficialOptions = {},
): string {
  const home = opts.home ?? homedir();
  const version = opts.version ?? VERSION;

  const installDir = join(runtimesDir(home), version);
  const pkgDir = join(installDir, "node_modules", "@stigmer", "plugins");
  const marker = join(pkgDir, OFFICIAL_MARKER);

  if (!existsSync(marker)) {
    if (!isAcquirableRelease(version)) {
      throw new CliExitError(
        `cannot acquire ${PLUGINS_PACKAGE} for a non-release build (${version})`,
        ExitCode.General,
        [
          "Run from the repo (the plugins/ tree is used directly in dev).",
          "On-demand acquisition is only available for published releases.",
        ],
      );
    }
    log.info(`acquiring ${PLUGINS_PACKAGE}`, { version, dir: installDir });
    ensureRuntimesRoot(installDir);
    const install = opts.install ?? npmInstallIntoRuntimes;
    install(installDir, `${PLUGINS_PACKAGE}@${version}`);
  }

  if (!existsSync(marker)) {
    throw new CliExitError(
      `${PLUGINS_PACKAGE} install did not produce ${marker}`,
      ExitCode.General,
      [`Remove ${installDir} and retry.`],
    );
  }
  return pkgDir;
}

// Walk up from this module to a repo root whose plugins/ holds the marker.
function repoPluginsDir(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i += 1) {
    const candidate = join(dir, "plugins");
    if (existsSync(join(candidate, OFFICIAL_MARKER))) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
