import { useEffect, useRef, useState } from "react";
import {
  invokeGetRunnerLogs,
  invokeTailRunnerLogFile,
  invokeWatchRunnerLogFile,
  onRunnerLog,
  onRunnerLogFile,
} from "./tauri";

const MAX_LOG_LINES = 2000;

/**
 * Describes how the hook is sourcing log data. Used by the log viewer
 * to render context-appropriate status messages and indicators.
 *
 * - `"idle"` -- no runner selected, hook is dormant.
 * - `"connecting"` -- initial fetch in progress (first render).
 * - `"process"` -- streaming from the desktop ProcessManager (fast path).
 * - `"file"` -- tailing a log file on disk (fallback for CLI-started runners).
 * - `"unavailable"` -- no log source exists for this runner.
 */
export type LogSource = "idle" | "connecting" | "process" | "file" | "unavailable";

export interface UseRunnerLogsReturn {
  readonly lines: readonly string[];
  /** Which log source is active — drives UX messaging and the Live indicator. */
  readonly source: LogSource;
}

/**
 * Fetches runner logs with a two-tier strategy:
 *
 * 1. **ProcessManager (fast path)** -- For runners spawned by this desktop
 *    session. Uses in-memory buffer + real-time `runner:log` events.
 *
 * 2. **File tail (fallback)** -- For CLI-started or daemon-managed runners.
 *    Reads from `~/.stigmer/runners/<name>.log` and subscribes to
 *    `runner:log-file` events emitted by a Rust file watcher.
 *
 * 3. **Unavailable** -- If neither source exists, the hook signals this
 *    so the UI can show an actionable message instead of a misleading
 *    "Waiting for output...".
 *
 * Pass `null` to disable (e.g., when no runner is selected).
 */
export function useRunnerLogs(runnerName: string | null): UseRunnerLogsReturn {
  const [lines, setLines] = useState<string[]>([]);
  const [source, setSource] = useState<LogSource>("idle");
  const nameRef = useRef(runnerName);
  nameRef.current = runnerName;

  useEffect(() => {
    if (!runnerName) {
      setLines([]);
      setSource("idle");
      return;
    }

    let cancelled = false;
    setSource("connecting");

    const unlisteners: Array<Promise<() => void>> = [];

    // Helper to append lines from any source.
    function appendLine(name: string, line: string) {
      if (cancelled || name !== nameRef.current) return;
      setLines((prev) => {
        const next = [...prev, line];
        return next.length > MAX_LOG_LINES
          ? next.slice(next.length - MAX_LOG_LINES)
          : next;
      });
    }

    // Always subscribe to both event channels up front so we don't
    // miss lines emitted between the initial fetch and subscription.
    unlisteners.push(
      onRunnerLog((payload) => appendLine(payload.name, payload.line)),
    );
    unlisteners.push(
      onRunnerLogFile((payload) => appendLine(payload.name, payload.line)),
    );

    // Tier 1: Try the in-memory ProcessManager buffer.
    invokeGetRunnerLogs(runnerName, MAX_LOG_LINES)
      .then((initial) => {
        if (cancelled) return;
        setLines(initial);
        setSource("process");
      })
      .catch(() => {
        if (cancelled) return;

        // Tier 2: Fall back to the on-disk log file.
        invokeTailRunnerLogFile(runnerName, MAX_LOG_LINES)
          .then((initial) => {
            if (cancelled) return;
            setLines(initial);
            setSource("file");
            // Start the file watcher for live updates.
            invokeWatchRunnerLogFile(runnerName).catch(() => {
              // Non-fatal: we still have the snapshot.
            });
          })
          .catch(() => {
            if (cancelled) return;
            // Neither source available.
            setLines([]);
            setSource("unavailable");
          });
      });

    return () => {
      cancelled = true;
      for (const p of unlisteners) {
        p.then((u) => u());
      }
    };
  }, [runnerName]);

  return { lines, source };
}
