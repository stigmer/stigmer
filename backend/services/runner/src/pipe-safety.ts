/**
 * Makes the runner's stdout/stderr writes fail-safe so a dead host pipe degrades
 * logging instead of killing execution.
 *
 * Background (issue #177): the runner is embedded as a subprocess whose stdout is
 * the JSON IPC channel and whose stderr is the host's log channel. When the host
 * drops a pipe's read end, the runner's next write raises an async `EPIPE` error
 * event. With no `error` listener that event escalates to `uncaughtException` —
 * and the uncaught handler logs to the very stream that just failed, raising EPIPE
 * again. That re-entrant loop pegs the event loop at ~125% CPU, starves Temporal
 * heartbeats, and the in-flight execution dies as "Activity task timed out" while
 * the runner process still looks alive.
 *
 * The fix is one Node idiom: attach an `error` listener to each stream. Once a
 * listener exists, EPIPE is delivered to it and can never escalate, which both
 * breaks the loop and makes every raw `console.*` call in the codebase safe. The
 * guarded writers below add the intent-revealing layer on top: once a pipe breaks
 * we detach (writes become silent no-ops) rather than keep trying.
 *
 * See <https://github.com/stigmer/stigmer/issues/177>.
 */

import type { Writable } from "node:stream";

/** Error codes that mean the downstream reader is gone — logging must degrade, not crash. */
const BROKEN_PIPE_CODES = new Set(["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"]);

export function isBrokenPipeError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null | undefined)?.code;
  return typeof code === "string" && BROKEN_PIPE_CODES.has(code);
}

/**
 * Guards a single writable stream and returns a writer that can never crash the
 * process. The returned writer no-ops once the stream's reader is gone; callers
 * include their own trailing newline so the byte stream is unchanged on the happy
 * path. `onUnexpectedError` reports a non-broken-pipe failure through a channel
 * the caller knows is still safe (see {@link installProcessPipeGuards}).
 *
 * Pure with respect to the injected stream (no `process` coupling) so the
 * detach-on-EPIPE behavior is unit-testable with a fake writable.
 */
export function guardStream(
  stream: Writable,
  onUnexpectedError?: (err: Error) => void,
): (chunk: string) => boolean {
  let detached = false;

  stream.on("error", (err: Error) => {
    // Any error means the stream is no longer usable; stop writing to it. The
    // listener's existence is what prevents EPIPE from escalating to
    // uncaughtException — that is the actual fix for issue #177.
    const wasAttached = !detached;
    detached = true;
    // Report an unexpected (non-broken-pipe) failure at most once, on the first
    // error — later errors are just noise from the same dead stream.
    if (wasAttached && !isBrokenPipeError(err)) {
      onUnexpectedError?.(err);
    }
  });

  return (chunk: string): boolean => {
    if (detached) return false;
    try {
      return stream.write(chunk);
    } catch {
      // A synchronous throw (e.g. write-after-end) means the stream is unusable;
      // detach so we never retry into the same failure.
      detached = true;
      return false;
    }
  };
}

let installed: { writeStdout: (chunk: string) => boolean; writeStderr: (chunk: string) => boolean } | null =
  null;

/**
 * Installs broken-pipe guards on `process.stdout` and `process.stderr` and returns
 * the safe writers for each. Idempotent — the first call wins so repeated imports
 * never stack duplicate `error` listeners.
 *
 * Channel asymmetry is deliberate: stdout is the JSON IPC channel, so an
 * unexpected stdout error is reported on stderr (the log channel); an unexpected
 * stderr error has no safe place to go, so it detaches silently rather than
 * corrupting the IPC stream with diagnostics.
 */
export function installProcessPipeGuards(): {
  writeStdout: (chunk: string) => boolean;
  writeStderr: (chunk: string) => boolean;
} {
  if (installed) return installed;

  const writeStderr = guardStream(process.stderr);
  const writeStdout = guardStream(process.stdout, (err) => {
    writeStderr(`[pipe-safety] stdout (IPC) channel error, detaching: ${err.stack ?? err}\n`);
  });

  installed = { writeStdout, writeStderr };
  return installed;
}

/**
 * Reports a fatal/uncaught error through a guarded writer, guaranteeing the report
 * itself can never throw. A fatal handler that throws while reporting is the exact
 * re-entrancy trap behind issue #177, so the write is wrapped defensively even
 * though the writer is already broken-pipe safe.
 */
export function reportFatal(write: (chunk: string) => boolean, label: string, err: unknown): void {
  try {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    write(`${label} ${detail}\n`);
  } catch {
    // Intentionally empty: the reporter is the last line of defense and must
    // never propagate.
  }
}
