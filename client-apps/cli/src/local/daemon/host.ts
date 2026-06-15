// The production ProcessHost and Clock.
//
// Children are spawned detached (their own process group) so the whole tree can
// be signaled, with stdout+stderr piped through the daemon. The daemon tees each
// chunk to the component's log file and scans stdout for an optional readiness
// marker — the same pipe-and-watch shape the conformance/e2e harnesses use,
// which is what lets `status` report "runner actually polling" instead of mere
// liveness. Logs survive normally because the daemon outlives its children; an
// abnormal daemon death is handled by orphan cleanup on the next `up`.

import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { killProcessGroup } from "../state/proc.js";
import type { ChildHandle, Clock, ExitInfo, ProcessHost, SpawnRequest } from "./types.js";

export class NodeProcessHost implements ProcessHost {
  spawn(request: SpawnRequest): ChildHandle {
    const out = createWriteStream(request.logFile, { flags: "a" });
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      env: request.env,
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let exited = false;
    let exitCb: ((info: ExitInfo) => void) | null = null;
    let readyCb: (() => void) | null = null;
    let ready = false;

    // Keep a small rolling tail so a marker split across chunks is still found.
    let tail = "";
    const marker = request.readinessMarker;
    child.stdout?.on("data", (chunk: Buffer) => {
      out.write(chunk);
      if (marker !== undefined && !ready) {
        tail = (tail + chunk.toString("utf8")).slice(-Math.max(marker.length * 2, 256));
        if (tail.includes(marker)) {
          ready = true;
          readyCb?.();
        }
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => out.write(chunk));

    child.on("exit", (code, signal) => {
      exited = true;
      out.end();
      exitCb?.({ code, signal });
    });
    child.on("error", (err) => {
      out.write(`failed to spawn ${request.command}: ${String(err)}\n`);
      exited = true;
      exitCb?.({ code: null, signal: null });
    });

    const pid = child.pid ?? -1;
    return {
      pid,
      hasExited: () => exited,
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
}

/** Real wall-clock implementation of Clock. */
export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};
