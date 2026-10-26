/**
 * The Claude engine probe every image smoke shares: a runner built from this
 * checkout's images finds the engine its image carries at boot, and logs
 * `[claude] engine ready <version> (<engines>/claude/<version>)`
 * (backend/services/runner/src/activities/execute-claude/adapter.ts). The
 * compose and Helm runners carry it in the runner layer at /runner/engines;
 * the all-in-one image at /opt/stigmer/engines. The version is the pin the
 * runner's lockfile records, read the way the bundler writes it
 * (backend/services/runner/scripts/claude-engine-pin.mjs), so a smoke proves
 * the image runs exactly the engine this checkout pins.
 *
 * Plain node, no dependencies beyond that sibling script.
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { claudeEnginePinFromLockfile } from "../../../backend/services/runner/scripts/claude-engine-pin.mjs";

/** Where the runner layer carries the engine (its start script's STIGMER_ENGINES_DIR). */
export const LAYER_ENGINES = "/runner/engines";

/** Where the all-in-one image carries it (its Dockerfile's STIGMER_ENGINES_DIR). */
export const ALL_IN_ONE_ENGINES = "/opt/stigmer/engines";

const RUNNER_LOCKFILE = fileURLToPath(new URL("../../../backend/services/runner/package-lock.json", import.meta.url));

/** The ready line a runner logs for the engine under `engines`, at the version `lockfile` pins. */
export function claudeReadyLine(engines, lockfile = RUNNER_LOCKFILE) {
  const { version } = claudeEnginePinFromLockfile(lockfile);
  return `[claude] engine ready ${version} (${join(engines, "claude", version)})`;
}

/** Throws unless `logs` hold the ready line for `engines`; returns the line. */
export function assertClaudeReady(logs, engines, lockfile = RUNNER_LOCKFILE) {
  const line = claudeReadyLine(engines, lockfile);
  if (!logs.includes(line)) {
    const seen = logs.split("\n").filter((l) => l.includes("[claude]"));
    throw new Error(`the runner did not log the Claude engine ready ("${line}"); its Claude lines: ${seen.length > 0 ? seen.join(" | ") : "none"}`);
  }
  return line;
}
