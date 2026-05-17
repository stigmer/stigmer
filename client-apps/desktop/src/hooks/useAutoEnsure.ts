import { useCallback, useEffect, useRef, useState } from "react";
import {
  invokeGetRunnerPreference,
  invokeSetRunnerPreference,
  invokeStopRunnerViaSocket,
  onRunnerStopped,
  type LocalRunnerStatus,
} from "./tauri";

/**
 * Maximum time (ms) to wait for `localStatus.running` after `onEnsure()`
 * resolves before giving up and transitioning to "error". Covers the
 * window where the CLI is still bootstrapping runtimes (Python, Node.js)
 * before writing its state file and opening the control socket.
 */
const ENSURE_TIMEOUT_MS = 120_000;

export type AutoEnsureState =
  | "loading"
  | "prompt"
  | "disabled"
  | "ensuring"
  | "active"
  | "error";

export interface UseAutoEnsureReturn {
  readonly state: AutoEnsureState;
  readonly error: string | null;
  readonly enable: () => Promise<void>;
  readonly disable: () => Promise<void>;
  readonly retry: () => Promise<void>;
}

/**
 * Orchestrates the auto-ensure lifecycle for the local runner.
 *
 * On mount, reads the persisted preference:
 * - If never prompted: state = "prompt" (first-run card shown).
 * - If enabled: checks local status and calls ensure if not running.
 * - If disabled: state = "disabled".
 *
 * @param localStatus Live socket status from `useLocalRunnerStatus`.
 * @param onEnsure Async callback that starts the runner with full
 *   credentials. The caller (RunnersPage) provides this with token,
 *   endpoint, and org baked in. Returns the runner name on success.
 *   Throws on failure.
 */
export function useAutoEnsure(
  localStatus: LocalRunnerStatus,
  onEnsure: (() => Promise<string>) | null,
): UseAutoEnsureReturn {
  const [state, setState] = useState<AutoEnsureState>("loading");
  const [error, setError] = useState<string | null>(null);
  const enabledRef = useRef(false);
  const ensureInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const ensureTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Load preference on mount
  useEffect(() => {
    let cancelled = false;
    invokeGetRunnerPreference()
      .then((pref) => {
        if (cancelled) return;
        enabledRef.current = pref.enabled;
        if (!pref.prompted) {
          setState("prompt");
        } else if (!pref.enabled) {
          setState("disabled");
        } else {
          setState(localStatus.running ? "active" : "ensuring");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setState("prompt");
      });
    return () => { cancelled = true; };
  }, []);

  // React to local status changes when enabled
  useEffect(() => {
    if (!enabledRef.current) return;
    if (localStatus.running) {
      setState((prev) => {
        if (prev === "disabled" || prev === "prompt" || prev === "loading") return prev;
        return "active";
      });
      setError(null);
    }
  }, [localStatus.running]);

  // Clear the ensure timeout whenever state leaves "ensuring" (success,
  // error, disable, etc.) to prevent stale timer from firing.
  useEffect(() => {
    if (state !== "ensuring" && ensureTimeoutRef.current !== null) {
      clearTimeout(ensureTimeoutRef.current);
      ensureTimeoutRef.current = null;
    }
  }, [state]);

  // Auto-ensure when state transitions to "ensuring"
  useEffect(() => {
    if (state !== "ensuring") return;
    if (localStatus.running) {
      setState("active");
      return;
    }
    if (!onEnsure) {
      setError("No organization selected. Switch to an organization first.");
      setState("error");
      return;
    }
    if (ensureInFlightRef.current) return;

    let cancelled = false;
    ensureInFlightRef.current = true;

    onEnsure()
      .then(() => {
        if (cancelled) return;
        setError(null);

        // Start a timeout: if localStatus.running hasn't become true
        // within ENSURE_TIMEOUT_MS the CLI likely crashed silently or
        // the bootstrap is stuck. Transition to error so the user can
        // retry instead of staring at a spinner forever.
        ensureTimeoutRef.current = setTimeout(() => {
          if (!mountedRef.current) return;
          setState((prev) => {
            if (prev !== "ensuring") return prev;
            setError(
              "Runner startup timed out. The runtime bootstrap may have failed " +
              "or is taking longer than expected. Check the runner logs and retry.",
            );
            return "error";
          });
        }, ENSURE_TIMEOUT_MS);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setState("error");
      })
      .finally(() => {
        ensureInFlightRef.current = false;
      });

    return () => {
      cancelled = true;
      if (ensureTimeoutRef.current !== null) {
        clearTimeout(ensureTimeoutRef.current);
        ensureTimeoutRef.current = null;
      }
    };
  }, [state, onEnsure, localStatus.running]);

  // Detect CLI exit while still in "ensuring" state. The Tauri sidecar
  // emits runner:stopped when the spawned CLI process terminates. If the
  // process dies after the 8s grace window, localStatus.running never
  // becomes true and the state machine would be stuck without this.
  useEffect(() => {
    if (state !== "ensuring") return;

    const unlistenPromise = onRunnerStopped((payload) => {
      if (!mountedRef.current) return;
      setState((prev) => {
        if (prev !== "ensuring") return prev;
        const code = payload.exit_code;
        if (code !== null && code !== 0) {
          setError(
            `Runner process exited unexpectedly (code ${code}). ` +
            "Check the runner logs for details.",
          );
        } else {
          setError(
            "Runner process exited before becoming ready. " +
            "Check the runner logs for details.",
          );
        }
        return "error";
      });
    });

    return () => {
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [state]);

  const enable = useCallback(async () => {
    if (ensureInFlightRef.current) return;
    enabledRef.current = true;
    setError(null);
    setState("ensuring");
    await invokeSetRunnerPreference({ enabled: true, prompted: true });
  }, []);

  const disable = useCallback(async () => {
    enabledRef.current = false;
    ensureInFlightRef.current = false;
    await invokeSetRunnerPreference({ enabled: false, prompted: true });
    try {
      await invokeStopRunnerViaSocket();
    } catch {
      // Socket may already be gone — that's fine.
    }
    setState("disabled");
    setError(null);
  }, []);

  const retry = useCallback(async () => {
    if (ensureInFlightRef.current) return;
    setError(null);
    setState("ensuring");
  }, []);

  return { state, error, enable, disable, retry };
}
