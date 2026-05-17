import { useEffect, useRef, useCallback, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

export interface AppUpdaterState {
  status: UpdateStatus;
  availableVersion: string | null;
  checkForUpdate: () => Promise<void>;
}

const INITIAL_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000; // 4 hours

/** Tauri event emitted by the system tray "Check for Updates" menu item. */
const TRAY_CHECK_EVENT = "check-for-update";

/**
 * Checks for app updates on startup (after a short delay) and periodically,
 * then shows a non-blocking toast when a new version is available.
 *
 * Also listens for the `check-for-update` Tauri event so the system tray
 * menu can trigger a user-initiated check.
 *
 * The toast has a "Restart to Update" action. Clicking it downloads the update,
 * installs it, and relaunches the app.
 *
 * Mount once in the authenticated app root alongside `useRunnerNotifications`.
 */
export function useAppUpdater(): AppUpdaterState {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [availableVersion, setAvailableVersion] = useState<string | null>(null);
  const busyRef = useRef(false);

  const performCheck = useCallback(async (userInitiated = false) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus("checking");

    try {
      const update = await check();
      if (!update) {
        setStatus("idle");
        busyRef.current = false;
        if (userInitiated) {
          toast.success("You're on the latest version.", { id: "app-update" });
        }
        return;
      }

      setAvailableVersion(update.version);
      setStatus("available");
      busyRef.current = false;

      toast.info(`Update available: v${update.version}`, {
        duration: Infinity,
        id: "app-update",
        closeButton: true,
        action: {
          label: "Restart to Update",
          onClick: () => downloadAndRelaunch(update, setStatus),
        },
      });
    } catch (err: unknown) {
      console.warn("[updater] Failed to check for updates:", err);
      setStatus("error");
      busyRef.current = false;
      if (userInitiated) {
        toast.error("Could not check for updates. Try again later.", {
          id: "app-update",
        });
      }
    }
  }, []);

  useEffect(() => {
    const delay = setTimeout(() => performCheck(false), INITIAL_DELAY_MS);
    const interval = setInterval(() => performCheck(false), CHECK_INTERVAL_MS);

    const unlistenPromise = listen(TRAY_CHECK_EVENT, () => {
      performCheck(true);
    });

    return () => {
      clearTimeout(delay);
      clearInterval(interval);
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [performCheck]);

  const userCheck = useCallback(() => performCheck(true), [performCheck]);

  return { status, availableVersion, checkForUpdate: userCheck };
}

async function downloadAndRelaunch(
  update: Update,
  setStatus: (s: UpdateStatus) => void,
): Promise<void> {
  setStatus("downloading");
  try {
    toast.loading("Downloading update...", { id: "app-update" });
    await update.downloadAndInstall();
    setStatus("ready");
    await relaunch();
  } catch (err: unknown) {
    console.warn("[updater] Failed to download/install update:", err);
    setStatus("error");
    toast.error("Update failed. Please try again later.", {
      id: "app-update",
    });
  }
}
