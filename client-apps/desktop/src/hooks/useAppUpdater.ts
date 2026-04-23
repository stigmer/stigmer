import { useEffect, useRef, useCallback, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "error";

const INITIAL_DELAY_MS = 5_000;
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000; // 4 hours

/**
 * Checks for app updates on startup (after a short delay) and periodically,
 * then shows a non-blocking toast when a new version is available.
 *
 * The toast has a "Restart to Update" action. Clicking it downloads the update,
 * installs it, and relaunches the app.
 *
 * Mount once in the authenticated app root alongside `useRunnerNotifications`.
 */
export function useAppUpdater() {
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const busyRef = useRef(false);

  const performCheck = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setStatus("checking");

    try {
      const update = await check();
      if (!update) {
        setStatus("idle");
        busyRef.current = false;
        return;
      }

      setStatus("available");
      busyRef.current = false;

      toast.info(`Update available: v${update.version}`, {
        duration: Infinity,
        id: "app-update",
        action: {
          label: "Restart to Update",
          onClick: () => downloadAndRelaunch(update, setStatus),
        },
      });
    } catch {
      setStatus("error");
      busyRef.current = false;
    }
  }, []);

  useEffect(() => {
    const delay = setTimeout(performCheck, INITIAL_DELAY_MS);
    const interval = setInterval(performCheck, CHECK_INTERVAL_MS);

    return () => {
      clearTimeout(delay);
      clearInterval(interval);
    };
  }, [performCheck]);

  return { status, checkForUpdate: performCheck };
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
  } catch {
    setStatus("error");
    toast.error("Update failed. Please try again later.", {
      id: "app-update",
    });
  }
}
