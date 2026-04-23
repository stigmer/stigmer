import { useCallback, useState } from "react";
import { invokeStartRunner, type StartRunnerOptions } from "./tauri";

export interface UseStartRunnerReturn {
  readonly startRunner: (opts?: StartRunnerOptions) => Promise<string>;
  readonly isStarting: boolean;
  readonly error: string | null;
  readonly clearError: () => void;
}

const AUTH_ERROR_PATTERNS = [
  "backend not configured",
  "not authenticated",
  "api key",
  "auth login",
];

function isAuthError(message: string): boolean {
  const lower = message.toLowerCase();
  return AUTH_ERROR_PATTERNS.some((p) => lower.includes(p));
}

/**
 * Returns a callback that starts a local runner via the Tauri sidecar.
 *
 * When the CLI fails due to missing credentials, the error message is
 * preserved so the UI can show an auth-specific onboarding guide.
 */
export function useStartRunner(): UseStartRunnerReturn {
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const startRunner = useCallback(
    async (opts: StartRunnerOptions = {}): Promise<string> => {
      setIsStarting(true);
      setError(null);
      try {
        const name = await invokeStartRunner(opts);
        return name;
      } catch (err) {
        const message = String(err);
        if (isAuthError(message)) {
          setError(
            "The Stigmer CLI needs authentication to start a runner.\n\n" +
              "Run `stigmer auth login` in a terminal, or set the STIGMER_API_KEY " +
              "environment variable before launching the desktop app.",
          );
        } else {
          setError(message);
        }
        throw err;
      } finally {
        setIsStarting(false);
      }
    },
    [],
  );

  return { startRunner, isStarting, error, clearError };
}
