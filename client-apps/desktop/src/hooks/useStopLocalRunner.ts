import { useCallback, useState } from "react";
import { invokeStopRunner } from "./tauri";

export interface UseStopLocalRunnerReturn {
  readonly stopRunner: (name: string) => Promise<void>;
  readonly isStopping: boolean;
  readonly error: string | null;
}

/**
 * Returns a callback that stops a local runner by name.
 *
 * If the runner was spawned by this desktop instance, the Rust layer sends
 * SIGTERM to the child process directly. Otherwise it delegates to
 * `stigmer down runner --name <name>` via the sidecar.
 */
export function useStopLocalRunner(): UseStopLocalRunnerReturn {
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopRunner = useCallback(async (name: string): Promise<void> => {
    setIsStopping(true);
    setError(null);
    try {
      await invokeStopRunner(name);
    } catch (err) {
      setError(String(err));
      throw err;
    } finally {
      setIsStopping(false);
    }
  }, []);

  return { stopRunner, isStopping, error };
}
