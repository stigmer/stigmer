import { useCallback, useState } from "react";
import { invokeStopRunner } from "./tauri";

export interface StopRunnerCredential {
  readonly token?: string;
  readonly endpoint?: string;
  readonly org?: string;
}

export interface UseStopLocalRunnerReturn {
  readonly stopRunner: (name: string, cred?: StopRunnerCredential) => Promise<void>;
  readonly isStopping: boolean;
  readonly error: string | null;
}

/**
 * Returns a callback that stops a local runner by name.
 *
 * If the runner was spawned by this desktop instance, the Rust layer sends
 * SIGTERM to the child process directly. Otherwise it delegates to
 * `stigmer down runner --name <name>` via the sidecar, forwarding the
 * desktop session's credentials so the CLI never falls back to its own
 * stored auth.
 */
export function useStopLocalRunner(): UseStopLocalRunnerReturn {
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopRunner = useCallback(
    async (name: string, cred?: StopRunnerCredential): Promise<void> => {
      setIsStopping(true);
      setError(null);
      try {
        await invokeStopRunner({
          runnerName: name,
          token: cred?.token,
          endpoint: cred?.endpoint,
          org: cred?.org,
        });
      } catch (err) {
        setError(String(err));
        throw err;
      } finally {
        setIsStopping(false);
      }
    },
    [],
  );

  return { stopRunner, isStopping, error };
}
