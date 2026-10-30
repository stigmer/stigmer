/**
 * The process exit codes Stigmer's command-line tools share, so a script or
 * CI step branches on `$?` without parsing output: the `stigmer` CLI and the
 * terminal kit's `stigmer-ink` (and any host that runs a turn and exits) read
 * one table.
 *
 * The table itself is exit-code-table.ts, re-exported here; it is also its
 * own entry (`@stigmer/client/exit-codes`) for code that must load it with no
 * import. {@link exitCodeOf} reads a code from what a run ended with: a turn's
 * outcome (completed 0; failed, cancelled or terminated 1; not ended yet,
 * because the person or the host stopped waiting, 130, the shell's code for
 * an interrupt), or an error, by its {@link classifyError} category. A
 * cancelled turn shares 1 with a failed one: the table has no code of its own
 * for it, and a caller that must tell them apart reads the outcome's phase.
 *
 * Proven by __tests__/exit-codes.test.ts.
 */
import { classifyError, type ErrorCategory } from "./errors.js";
import type { TurnPhase } from "@stigmer/session-log";

import { ExitCode } from "./exit-code-table.js";

export { ExitCode } from "./exit-code-table.js";

const CATEGORY_EXIT: Record<ErrorCategory, ExitCode> = {
  auth: ExitCode.Auth,
  permission: ExitCode.Auth,
  "not-found": ExitCode.NotFound,
  validation: ExitCode.Usage,
  server: ExitCode.General,
  unavailable: ExitCode.Connection,
  // A request cancelled on the far side failed (the CLI's rule); a wait the
  // person or host stopped is a turn that has not ended, read by its phase.
  cancelled: ExitCode.General,
  unknown: ExitCode.General,
};

const PHASE_EXIT: Record<TurnPhase, ExitCode> = {
  completed: ExitCode.Success,
  failed: ExitCode.General,
  cancelled: ExitCode.General,
  terminated: ExitCode.General,
  pending: ExitCode.Interrupted,
  running: ExitCode.Interrupted,
  waiting: ExitCode.Interrupted,
  paused: ExitCode.Interrupted,
};

/** What a run ended with: a turn's outcome (anything with its `phase`), or a thrown value. */
export type ExitSource = { readonly phase: TurnPhase } | unknown;

/**
 * The exit code for a turn's outcome or an error. An error that carries its
 * own numeric `exitCode` (as the terminal kit's start failure does) keeps it.
 */
export function exitCodeOf(source: ExitSource): ExitCode {
  if (typeof source === "object" && source !== null) {
    if ("phase" in source && typeof source.phase === "string" && source.phase in PHASE_EXIT) {
      return PHASE_EXIT[source.phase as TurnPhase];
    }
    if ("exitCode" in source && isExitCode(source.exitCode)) {
      return source.exitCode;
    }
  }
  return CATEGORY_EXIT[classifyError(source)];
}

function isExitCode(value: unknown): value is ExitCode {
  return Object.values(ExitCode).includes(value as ExitCode);
}
