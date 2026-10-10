// The real world behind `plugin eval`'s injected effects: the process's
// streams, the file system for `--json <path>`, a timer that a Ctrl+C cuts
// short (the pace of the reads and each call's deadline alike), and SIGINT. Kept apart from the dispatch so the dispatch is tested
// with fakes; nothing here holds a rule of its own.

import { writeFile } from "node:fs/promises";
import type { PluginEvalIo } from "./run.js";

/** The process's own effects. */
export function nodePluginEvalIo(): PluginEvalIo {
  return {
    stdout: process.stdout,
    stderr: process.stderr,
    writeFile: (path, content) => writeFile(path, content, "utf8"),
    sleep: wait,
    timeout: wait,
    now: () => Date.now(),
    onInterrupt: (handler) => {
      process.on("SIGINT", handler);
      return () => void process.removeListener("SIGINT", handler);
    },
    exit: (code) => process.exit(code),
  };
}

/** Resolves after `ms`, or as soon as `signal` aborts, its timer then cleared. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
