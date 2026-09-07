// One discipline for the two things every harness child process needs at the
// end of its life: being stopped, and having its output kept for diagnosis.
// Domain: conformance harness (process lifecycle).
//
// The harness spawns four kinds of child — the TS server (server-process.ts),
// the runner (runner-process.ts), the Temporal dev server (temporal.ts) and
// the cloud launcher (cloud-env.ts) — and until entry 20260908.01 each stopped
// its child its own way. Two of the four were wrong in ways that only showed
// under CI's STIGMER_CONFORMANCE_LOG_DIR tee: the runner's stop() ended the
// log sink and deleted the workspace the instant it sent SIGTERM, while the
// runner was still writing its shutdown lines — `ERR_STREAM_WRITE_AFTER_END`
// from the `data` handler, an uncaught exception that failed a Class B run
// whose 160 arms had all passed (stigmer runs 33248911981, 34127147561,
// 34160368541). The server's stop() SIGKILLed without awaiting exit and never
// ended its tee. The launcher's stop had the right shape. This module IS that
// shape, once, with the two non-negotiables stated:
//
// - A stop is not done until the child has EXITED. Deleting its state dir or
//   ending its log sink before then races the child's own last acts.
// - The log sink ends only after the child's stdio has CLOSED — Node's `close`
//   event, which fires after `exit` once every pipe has drained. Until then a
//   chunk can still arrive, and a chunk written to an ended stream throws.
//
// The signal each child receives is the caller's decision and is preserved
// here as an argument, not normalized: SIGTERM where the child has a graceful
// shutdown worth waiting for (the runner drains its worker; the launcher tears
// down containers and the JVM), SIGKILL where it does not (the TS server
// against throwaway state).
import type { ChildProcess } from "node:child_process";
import type { EventEmitter } from "node:events";
import { once } from "node:events";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";

// The slice of ChildProcess these helpers touch. Narrow on purpose: the unit
// arms drive a fake child that implements exactly this, and a caller cannot
// reach anything else through it.
export type ChildHandle = EventEmitter &
  Pick<ChildProcess, "exitCode" | "signalCode" | "kill" | "stdout" | "stderr">;

export interface StopChildOptions {
  // The signal that asks the child to leave. See the header for which one.
  signal: "SIGTERM" | "SIGKILL";
  // How long the child gets to exit after `signal` before the SIGKILL
  // fallback. Ignored when `signal` is already SIGKILL.
  graceMs: number;
  // Fires once if the grace expires and SIGKILL is sent. The caller says what
  // may have leaked, in its own words — a forced kill is always worth a loud
  // line, and only the caller knows what its child owned.
  onForceKill?: () => void;
}

// Signals the child and resolves once it has exited. Idempotent on a child
// that has already exited (no signal is sent).
export async function stopChild(child: ChildHandle, opts: StopChildOptions): Promise<void> {
  if (hasExited(child)) return;

  const exited = once(child, "exit");
  child.kill(opts.signal);

  let fallback: NodeJS.Timeout | undefined;
  if (opts.signal !== "SIGKILL") {
    fallback = setTimeout(() => {
      opts.onForceKill?.();
      child.kill("SIGKILL");
    }, opts.graceMs);
    fallback.unref();
  }
  try {
    await exited;
  } finally {
    if (fallback !== undefined) clearTimeout(fallback);
  }
}

export interface TeeChildOutputOptions {
  // Bytes of combined stdout/stderr kept in memory for `tail()`.
  tailBytes: number;
  // When set, every byte is also appended to this file (its directory is
  // created). The tee that survives teardown: the in-memory tail is only ever
  // surfaced on spawn failure, which leaves a mid-run failure undiagnosable.
  file?: string;
  // Sees each chunk's text as it arrives — readiness markers live here.
  onChunk?: (text: string) => void;
}

export interface ChildOutputTee {
  // The last `tailBytes` of combined output.
  tail(): string;
  // Ends the file sink once the child's stdio has closed, so nothing can be
  // written after the end. Call it after `stopChild` has resolved. Bounded:
  // if `close` has not fired within `closeGraceMs` (a grandchild holding the
  // pipes open, say) the sink is ended anyway and any later chunk is dropped
  // rather than thrown. Idempotent; a no-op without a file.
  close(closeGraceMs?: number): Promise<void>;
}

// How long close() waits for the child's stdio to close before ending the
// sink regardless. A process that has exited normally closes its pipes within
// milliseconds; the bound exists for the inherited-pipe case.
const DEFAULT_CLOSE_GRACE_MS = 5_000;

export function teeChildOutput(child: ChildHandle, opts: TeeChildOutputOptions): ChildOutputTee {
  let tail = "";
  let sink: WriteStream | undefined;
  if (opts.file !== undefined) {
    mkdirSync(dirname(opts.file), { recursive: true });
    sink = createWriteStream(opts.file, { flags: "a" });
  }

  const append = (chunk: Buffer): void => {
    const text = chunk.toString("utf8");
    tail = (tail + text).slice(-opts.tailBytes);
    // The guard is the belt to close()'s braces: after a bounded close() has
    // ended the sink, a straggling chunk is dropped, never thrown.
    if (sink !== undefined && !sink.writableEnded) sink.write(chunk);
    opts.onChunk?.(text);
  };
  child.stdout?.on("data", append);
  child.stderr?.on("data", append);

  let stdioClosed = false;
  child.once("close", () => {
    stdioClosed = true;
  });

  let closing: Promise<void> | undefined;
  const close = async (closeGraceMs = DEFAULT_CLOSE_GRACE_MS): Promise<void> => {
    if (sink === undefined) return;
    if (!stdioClosed) await waitForStdioClose(child, closeGraceMs);
    // Nothing else ends the sink, and the `closing ??=` below makes this the
    // only end() call, so the callback form is the whole finish handshake.
    const ending = sink;
    await new Promise<void>((resolveEnded) => ending.end(() => resolveEnded()));
  };

  return {
    tail: () => tail,
    close: (closeGraceMs) => {
      closing ??= close(closeGraceMs);
      return closing;
    },
  };
}

function hasExited(child: ChildHandle): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

// Resolves on the child's `close` or after `ms`, whichever is first, leaving no
// listener and no timer behind either way.
function waitForStdioClose(child: ChildHandle, ms: number): Promise<void> {
  return new Promise((resolveClosed) => {
    const finish = (): void => {
      clearTimeout(timer);
      child.off("close", finish);
      resolveClosed();
    };
    const timer = setTimeout(finish, ms);
    timer.unref();
    child.once("close", finish);
  });
}
