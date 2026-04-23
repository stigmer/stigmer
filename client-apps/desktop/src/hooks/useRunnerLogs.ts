import { useEffect, useRef, useState } from "react";
import { invokeGetRunnerLogs, onRunnerLog } from "./tauri";

const MAX_LOG_LINES = 2000;

export interface UseRunnerLogsReturn {
  readonly lines: readonly string[];
  readonly isStreaming: boolean;
}

/**
 * Fetches the log buffer for a named runner and subscribes to live log
 * events. Lines are capped at {@link MAX_LOG_LINES} to prevent unbounded
 * memory growth in long-running sessions.
 *
 * Pass `null` to disable (e.g., when no runner is selected).
 */
export function useRunnerLogs(runnerName: string | null): UseRunnerLogsReturn {
  const [lines, setLines] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const nameRef = useRef(runnerName);
  nameRef.current = runnerName;

  useEffect(() => {
    if (!runnerName) {
      setLines([]);
      setIsStreaming(false);
      return;
    }

    let cancelled = false;

    invokeGetRunnerLogs(runnerName, MAX_LOG_LINES)
      .then((initial) => {
        if (cancelled) return;
        setLines(initial);
        setIsStreaming(true);
      })
      .catch(() => {
        if (cancelled) return;
        setLines([]);
        setIsStreaming(true);
      });

    const unlistenPromise = onRunnerLog((payload) => {
      if (cancelled || payload.name !== nameRef.current) return;
      setLines((prev) => {
        const next = [...prev, payload.line];
        return next.length > MAX_LOG_LINES
          ? next.slice(next.length - MAX_LOG_LINES)
          : next;
      });
    });

    return () => {
      cancelled = true;
      setIsStreaming(false);
      unlistenPromise.then((u) => u());
    };
  }, [runnerName]);

  return { lines, isStreaming };
}
