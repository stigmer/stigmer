import * as os from "node:os";
import * as path from "node:path";

// Opt-in diagnostics for the e2e backend stack, enabled with STIGMER_E2E_DIAG=1.
//
// They exist for one specific, hard-to-reproduce failure: the interactive
// approval suite's post-approval resume occasionally never drives the execution
// to a terminal phase, so the test's terminal-wait fails. The product surface is
// correct on every healthy run, so this is a backend resume question, not a UI
// one. When the flake recurs in CI or locally, re-running (or running) with
// STIGMER_E2E_DIAG=1 tees the runner + server stdout/stderr and every mock-LLM
// call to `${os.tmpdir()}/stigmer-e2e-{runner,server,mock}.log`, which together
// show whether the post-approval turn was requested, served, and acted on. Off
// by default so normal runs stay silent.
export function diagEnabled(): boolean {
  return process.env.STIGMER_E2E_DIAG === "1" || process.env.STIGMER_E2E_DIAG === "true";
}

/**
 * Stable, predictable path for a diagnostic log stream (e.g. "runner", "mock").
 * Lives under the OS temp dir (`$TMPDIR` on macOS, `/tmp` on Linux).
 */
export function diagLogPath(name: string): string {
  return path.join(os.tmpdir(), `stigmer-e2e-${name}.log`);
}
