// Log tailing + following primitives, robust to the daemon's log rotation.
//
// Logs are bounded (rotated at daemon start), so `tailLines` reads the whole
// file and slices — far simpler and less bug-prone than fd seeking, with no
// meaningful cost at these sizes. `followFile` is a poll-based `tail -F`:
// polling `stat` rather than `fs.watch` is deliberate, because `fs.watch`'s
// rename/rotation semantics differ across platforms and silently miss events.
// Rotation and truncation are detected by inode change and size shrink
// respectively, and the reader reopens from the start so no lines are lost.

import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";

/** Return the last `n` non-empty-trailing lines of a file (all lines if n<=0). */
export function tailLines(file: string, n: number): string[] {
  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const lines = content.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return n <= 0 ? lines : lines.slice(-n);
}

export interface FollowHandle {
  /** Stop polling and release resources. */
  stop(): void;
}

export interface FollowOptions {
  /** Poll interval; defaults to 200ms. */
  pollMs?: number;
  /** Start from byte 0 instead of the current end (emit existing content too). */
  fromStart?: boolean;
}

/**
 * Stream lines appended to `file`, invoking `onLine` per complete line. Survives
 * rotation (inode change -> reopen from 0) and truncation (size shrink -> reset
 * to 0). Returns a handle whose `stop()` ends the stream.
 */
export function followFile(file: string, onLine: (line: string) => void, options: FollowOptions = {}): FollowHandle {
  const pollMs = options.pollMs ?? 200;
  let inode = -1;
  let offset = 0;
  let buffer = "";
  let started = false;

  const drain = (): void => {
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      onLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
    }
  };

  const tick = (): void => {
    let stat: ReturnType<typeof statSync>;
    try {
      stat = statSync(file);
    } catch {
      return; // file not created yet, or briefly gone mid-rotation
    }

    if (stat.ino !== inode) {
      // First sight of the file, or it was rotated out from under us.
      inode = stat.ino;
      offset = started || options.fromStart === true ? 0 : stat.size;
      buffer = "";
    } else if (stat.size < offset) {
      offset = 0; // truncated in place
      buffer = "";
    }
    started = true;

    if (stat.size <= offset) return;

    const length = stat.size - offset;
    const chunk = Buffer.alloc(length);
    const fd = openSync(file, "r");
    try {
      readSync(fd, chunk, 0, length, offset);
    } finally {
      closeSync(fd);
    }
    offset = stat.size;
    buffer += chunk.toString("utf8");
    drain();
  };

  tick();
  const timer = setInterval(tick, pollMs);
  timer.unref?.();
  return {
    stop(): void {
      clearInterval(timer);
    },
  };
}
