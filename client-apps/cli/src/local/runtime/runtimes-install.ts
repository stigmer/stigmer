// Shared npm-install mechanics for on-demand-acquired runtime packages
// (~/.stigmer/runtimes/<version>/). Extracted when the TS server became the
// second consumer (D4 #24) — the runner and the server acquire different
// packages into the SAME per-version install root, so the root bootstrap and
// the install invocation must not drift between them.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CliExitError } from "../../errors/cli-exit-error.js";
import { ExitCode } from "../../errors/exit-codes.js";

/** The install implementation, injectable for tests. */
export type NpmInstall = (installDir: string, spec: string) => void;

/**
 * Ensure the per-version install root exists with a stable package.json.
 * A stable root makes installs deterministic and records the pinned
 * dependencies rather than letting npm synthesize an ad-hoc root; both the
 * runner and the server packages install into this one root, so the file is
 * written once and shared.
 */
export function ensureRuntimesRoot(installDir: string): void {
  mkdirSync(installDir, { recursive: true });
  const rootManifest = join(installDir, "package.json");
  if (!existsSync(rootManifest)) {
    writeFileSync(
      rootManifest,
      `${JSON.stringify({ name: "stigmer-runtime", private: true, version: "0.0.0" }, null, 2)}\n`,
    );
  }
}

// Install a package (plus its platform-native optional dependency) into an
// isolated prefix. `--omit=dev` drops devDependencies while keeping the
// optional native package npm selects by os/cpu; output is inherited so the
// user sees the one-time download progress.
export function npmInstallIntoRuntimes(installDir: string, spec: string): void {
  try {
    execFileSync(
      "npm",
      [
        "install",
        spec,
        "--prefix",
        installDir,
        "--omit=dev",
        "--no-audit",
        "--no-fund",
      ],
      {
        stdio: "inherit",
      },
    );
  } catch (err) {
    throw new CliExitError(`failed to install ${spec}`, ExitCode.General, [
      `Command: npm install ${spec} --prefix ${installDir}`,
      "Ensure npm is on PATH and the network is reachable.",
      "If npm reported EBADENGINE, this Node line is outside the package's",
      "supported range. If a previous install was interrupted, remove",
      `${installDir} and retry.`,
      String(err),
    ]);
  }
}

// A source build reports "0.0.0-dev" and the dev npm channel stamps
// "<v>-dev.<stamp>" versions; neither publishes matching runtime packages,
// so they are not acquirable. Release and rc/next versions are.
export function isAcquirableRelease(version: string): boolean {
  return !version.includes("-dev");
}
