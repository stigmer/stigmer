import { useEffect, useRef } from "react";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  onRunnerStarted,
  onRunnerStopped,
  onRunnerError,
  type RunnerStartedPayload,
  type RunnerStoppedPayload,
  type RunnerErrorPayload,
} from "./tauri";

/**
 * Sends native OS notifications for runner lifecycle events.
 *
 * - Requests notification permission on first mount.
 * - Subscribes to `runner:started`, `runner:stopped`, and `runner:error`
 *   Tauri events (emitted by `sidecar.rs`).
 * - Only fires when the window is **not focused** — avoids redundant
 *   alerts when the user is already looking at the app.
 * - Cleans up all listeners on unmount.
 *
 * Mount once in the authenticated app root (e.g. `AuthenticatedApp`).
 */
export function useRunnerNotifications(): void {
  const permittedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: Promise<UnlistenFn>[] = [];

    async function init() {
      let granted = await isPermissionGranted();
      if (!granted) {
        const result = await requestPermission();
        granted = result === "granted";
      }
      if (cancelled) return;
      permittedRef.current = granted;
      if (!granted) return;

      unlisteners.push(
        onRunnerStarted((payload: RunnerStartedPayload) => {
          if (document.hasFocus()) return;
          sendNotification({
            title: "Runner Started",
            body: `${payload.name} is now running`,
          });
        }),
      );

      unlisteners.push(
        onRunnerStopped((payload: RunnerStoppedPayload) => {
          if (document.hasFocus()) return;
          const exitInfo =
            payload.exit_code != null
              ? ` (exit code ${payload.exit_code})`
              : "";
          sendNotification({
            title: "Runner Stopped",
            body: `${payload.name} has stopped${exitInfo}`,
          });
        }),
      );

      unlisteners.push(
        onRunnerError((payload: RunnerErrorPayload) => {
          if (document.hasFocus()) return;
          sendNotification({
            title: "Runner Error",
            body: `${payload.name}: ${payload.message}`,
          });
        }),
      );
    }

    init();

    return () => {
      cancelled = true;
      for (const p of unlisteners) {
        p.then((unlisten) => unlisten());
      }
    };
  }, []);
}
