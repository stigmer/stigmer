import { useCallback, useEffect, useState } from "react";
import {
  invokeListLocalRunners,
  onRunnerStarted,
  onRunnerStopped,
  type LocalRunnerInfo,
} from "./tauri";

export interface UseLocalRunnersReturn {
  readonly localRunners: ReadonlyMap<string, LocalRunnerInfo>;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly refetch: () => void;
}

/**
 * Fetches local runner state from `~/.stigmer/runners/*.json` via the Rust
 * sidecar layer and keeps it live by subscribing to runner lifecycle events.
 *
 * Returns a name-keyed map so the Settings page can efficiently look up
 * whether a server-side runner has a local process on this machine.
 */
export function useLocalRunners(): UseLocalRunnersReturn {
  const [runners, setRunners] = useState<ReadonlyMap<string, LocalRunnerInfo>>(
    new Map(),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fetchKey, setFetchKey] = useState(0);

  const refetch = useCallback(() => setFetchKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    invokeListLocalRunners()
      .then((list) => {
        if (cancelled) return;
        const map = new Map<string, LocalRunnerInfo>();
        for (const r of list) {
          map.set(r.name, r);
        }
        setRunners(map);
        setIsLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [fetchKey]);

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    onRunnerStarted(() => refetch()).then((u) => unsubs.push(u));
    onRunnerStopped(() => refetch()).then((u) => unsubs.push(u));

    return () => {
      for (const u of unsubs) u();
    };
  }, [refetch]);

  return { localRunners: runners, isLoading, error, refetch };
}
