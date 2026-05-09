import { useCallback, useEffect, useRef, useState } from "react";
import {
  invokeQueryRunnerSocket,
  onRunnerStarted,
  onRunnerStopped,
  type LocalRunnerStatus,
} from "./tauri";

const ACTIVE_POLL_MS = 5_000;
const INACTIVE_POLL_MS = 10_000;

export interface UseLocalRunnerStatusReturn {
  readonly status: LocalRunnerStatus;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

const INITIAL_STATUS: LocalRunnerStatus = {
  source: "unavailable",
  running: false,
  name: null,
  runner_id: null,
  machine_id: null,
  org: null,
  backend_endpoint: null,
  pid: null,
  started_at: null,
  uptime: null,
  runtime: null,
  version: null,
};

/**
 * Polls the local runner's control socket for live status.
 *
 * Uses `query_runner_socket` which tries the Unix socket first
 * (source: "socket"), falls back to on-disk state (source: "disk"),
 * or reports unavailable. Subscribes to Tauri lifecycle events for
 * immediate refetch on start/stop.
 */
export function useLocalRunnerStatus(): UseLocalRunnerStatusReturn {
  const [status, setStatus] = useState<LocalRunnerStatus>(INITIAL_STATUS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);
  const mountedRef = useRef(true);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function poll() {
      try {
        const result = await invokeQueryRunnerSocket();
        if (!mountedRef.current) return;
        setStatus(result);
        setError(null);
        setIsLoading(false);

        const interval = result.running ? ACTIVE_POLL_MS : INACTIVE_POLL_MS;
        timer = setTimeout(poll, interval);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(String(err));
        setIsLoading(false);
        timer = setTimeout(poll, INACTIVE_POLL_MS);
      }
    }

    poll();

    return () => {
      mountedRef.current = false;
      if (timer !== null) clearTimeout(timer);
    };
  }, [fetchKey]);

  useEffect(() => {
    const unsubs: Array<Promise<() => void>> = [];
    unsubs.push(onRunnerStarted(() => refetch()));
    unsubs.push(onRunnerStopped(() => refetch()));
    return () => {
      for (const p of unsubs) p.then((u) => u());
    };
  }, [refetch]);

  return { status, isLoading, error, refetch };
}
