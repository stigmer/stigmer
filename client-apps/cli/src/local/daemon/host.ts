// The production ProcessHost and Clock.
//
// Children are spawned detached (their own process group) so the whole tree can
// be signaled, with stdout+stderr piped through the daemon. The daemon tees each
// chunk to the component's log file and scans stdout for an optional readiness
// marker — the same pipe-and-watch shape the conformance/e2e harnesses use,
// which is what lets `status` report "runner actually polling" instead of mere
// liveness. Logs survive normally because the daemon outlives its children; an
// abnormal daemon death is handled by orphan cleanup on the next `up`.
//
// An optional mirror receives every complete line a child writes, tagged with
// the component's name. The foreground launcher (`stigmer up --foreground`)
// uses it to show the stack's output in the terminal — or in `docker logs` —
// while the log files keep receiving the same bytes. The detached daemon
// installs no mirror: its own stdout is already redirected to daemon.log.
//
// A child counts as exited only once its output is in: on the stdio `close`,
// or a short grace after `exit` when a grandchild keeps the pipe open. Node
// fires `exit` before the last chunks arrive, so observing it there would end
// the log stream under a late write and drop the child's final words. Those
// words are what a failed start is explained by: the host keeps the last few
// stderr lines, which the supervisor records beside the failure (stigmer#1845).

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { killProcessGroup } from "../state/proc.js";
import type { ChildHandle, Clock, ExitInfo, ProcessHost, SpawnRequest } from "./types.js";

/** How long after `exit` the host waits for the child's stdio to close. */
export const EXIT_OUTPUT_GRACE_MS = 500;
/** How many trailing stderr lines a handle keeps, and how long each may be. */
export const STDERR_TAIL_LINES = 10;
export const STDERR_TAIL_LINE_MAX = 1024;

/** Receives one complete output line from a child, with the component that wrote it. */
export type OutputMirror = (component: string, line: string) => void;

export interface NodeProcessHostOptions {
  mirror?: OutputMirror;
}

export class NodeProcessHost implements ProcessHost {
  private readonly mirror: OutputMirror | undefined;

  constructor(options: NodeProcessHostOptions = {}) {
    this.mirror = options.mirror;
  }

  spawn(request: SpawnRequest): ChildHandle {
    const out = createWriteStream(request.logFile, { flags: "a" });
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let exitInfo: ExitInfo | null = null;
    let exitCb: ((info: ExitInfo) => void) | null = null;
    let readyCb: (() => void) | null = null;
    let ready = false;

    // Keep a small rolling tail so a marker split across chunks is still found.
    let tail = "";
    const marker = request.readinessMarker;
    // One line assembler per stream: a chunk can end mid-line, and the two
    // streams interleave, so each keeps its own partial line.
    const mirrorStdout = this.lineMirror(request.name);
    const mirrorStderr = this.lineMirror(request.name);
    const stderrTail: string[] = [];
    const keepStderr = lineAssembler((line) => {
      stderrTail.push(line.length > STDERR_TAIL_LINE_MAX ? `${line.slice(0, STDERR_TAIL_LINE_MAX)}…` : line);
      if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
    });

    child.stdout?.on("data", (chunk: Buffer) => {
      if (exitInfo !== null) return;
      out.write(chunk);
      mirrorStdout(chunk);
      if (marker !== undefined && !ready) {
        tail = (tail + chunk.toString("utf8")).slice(-Math.max(marker.length * 2, 256));
        if (tail.includes(marker)) {
          ready = true;
          readyCb?.();
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (exitInfo !== null) return;
      out.write(chunk);
      mirrorStderr(chunk);
      keepStderr(chunk);
    });

    // The one place a child becomes exited, whichever of `error`, `exit` and
    // `close` arrives, and in whatever order: once only.
    let grace: NodeJS.Timeout | null = null;
    const observeExit = (info: ExitInfo): void => {
      if (exitInfo !== null) return;
      if (grace !== null) clearTimeout(grace);
      mirrorStdout(null);
      mirrorStderr(null);
      keepStderr(null);
      out.end();
      exitInfo = info;
      exitCb?.(info);
    };

    let exitEvent: ExitInfo | null = null;
    child.on("exit", (code, signal) => {
      exitEvent = { code, signal };
      const info = exitEvent;
      grace = setTimeout(() => observeExit(info), EXIT_OUTPUT_GRACE_MS);
      grace.unref();
    });
    child.on("close", (code, signal) => observeExit(exitEvent ?? { code, signal }));
    child.on("error", (err) => {
      const line = `failed to spawn ${request.command}: ${String(err)}`;
      out.write(`${line}\n`);
      keepStderr(Buffer.from(`${line}\n`));
      observeExit({ code: null, signal: null });
    });

    const pid = child.pid ?? -1;
    return {
      pid,
      hasExited: () => exitInfo !== null,
      exitInfo: () => exitInfo,
      stderrTail: () => [...stderrTail],
      onExit: (cb) => {
        exitCb = cb;
      },
      onReady: (cb) => {
        readyCb = cb;
        if (ready) cb();
      },
      kill: (signal) => {
        if (pid > 0) killProcessGroup(pid, signal);
      },
    };
  }

  // Assemble complete lines from a byte stream and hand each to the mirror. A
  // `null` chunk flushes the trailing partial line at exit. Without a mirror
  // this is a no-op closure, so the hot path pays nothing in the detached daemon.
  private lineMirror(component: string): (chunk: Buffer | null) => void {
    const mirror = this.mirror;
    if (mirror === undefined) return () => {};
    return lineAssembler((line) => mirror(component, line));
  }
}

// Assemble complete lines from a byte stream and hand each to `onLine`. A
// `null` chunk flushes the trailing partial line.
function lineAssembler(onLine: (line: string) => void): (chunk: Buffer | null) => void {
  let partial = "";
  return (chunk) => {
    if (chunk === null) {
      if (partial !== "") onLine(partial);
      partial = "";
      return;
    }
    const lines = (partial + chunk.toString("utf8")).split("\n");
    partial = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  };
}

/** Real wall-clock implementation of Clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
