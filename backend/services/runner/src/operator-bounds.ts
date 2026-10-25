/**
 * The operator's bounds on a turn, as both boot paths in `main.ts` hand them
 * to their root: the stall window, the open-operation backstop, the
 * liveness interval, the native shell's timeout ceiling and whether it may
 * run commands in the background, the workspace lock wait and the Cursor
 * agent resolve, read from the environment by `loadConfig`.
 *
 * Why one function: each boot path builds its root's options field by
 * field, and both once left these four out, so `CURSOR_STREAM_STALL_TIMEOUT_MS`,
 * `WORKSPACE_LOCK_TIMEOUT_MS` and `CURSOR_AGENT_RESOLVE_TIMEOUT_MS` were
 * parsed and never honoured (stigmer#1731). Spreading this into both option
 * lists keeps a bound added later from reaching one mode and not the other;
 * `__tests__/operator-bounds.test.ts` pins both paths.
 */

import type { Config } from "./config.js";

/** The bounds a root's options carry (`StigmerRunnerOptions`, `RunnerManagerOptions`). */
export interface OperatorBounds {
  readonly cursorStreamStallTimeoutMs: number;
  readonly openOperationMaxMs: number;
  readonly livenessIntervalMs: number;
  readonly shellTimeoutMaxSeconds: number;
  readonly shellBackgroundEnabled: boolean;
  readonly workspaceLockTimeoutMs: number;
  readonly agentResolveTimeoutMs: number;
}

export function operatorBounds(config: Config): OperatorBounds {
  return {
    cursorStreamStallTimeoutMs: config.cursorStreamStallTimeoutMs,
    openOperationMaxMs: config.openOperationMaxMs,
    livenessIntervalMs: config.livenessIntervalMs,
    shellTimeoutMaxSeconds: config.shellTimeoutMaxSeconds,
    shellBackgroundEnabled: config.shellBackgroundEnabled,
    workspaceLockTimeoutMs: config.workspaceLockTimeoutMs,
    agentResolveTimeoutMs: config.agentResolveTimeoutMs,
  };
}
