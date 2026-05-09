import { useCallback, useEffect, useRef, useState } from "react";
import {
  invokeGetRunnerPreference,
  invokeSetRunnerPreference,
  invokeStopRunnerViaSocket,
  type LocalRunnerStatus,
} from "./tauri";

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
        // Don't immediately set "active" — wait for localStatus.running
        // to confirm via the next poll cycle. But clear any error.
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setState("error");
      })
      .finally(() => {
        ensureInFlightRef.current = false;
      });

    return () => { cancelled = true; };
  }, [state, onEnsure, localStatus.running]);

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
