import { useCallback } from "react";
import { useLocation } from "react-router-dom";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import {
  useAttentionNotifications,
  useAttentionNotificationsSetting,
  useOrg,
  type AttentionNotice,
} from "@stigmer/react-sdk";

/** The conversation the window shows, from a `/sessions/:id` path. */
function openSessionOf(pathname: string): string | null {
  const match = /^\/sessions\/([^/]+)/.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/**
 * Asks the system's permission to show notifications, from the person's
 * flip of the notifications setting (never on load). Resolves whether the
 * app may show them.
 */
export async function requestDesktopNotificationPermission(): Promise<boolean> {
  if (await isPermissionGranted()) return true;
  return (await requestPermission()) === "granted";
}

function showNotice(notice: AttentionNotice): void {
  sendNotification({ title: notice.title, body: notice.body });
}

/**
 * Shows a system notification each time a conversation the person started in
 * the active organization finishes, fails, or waits for their answer, once
 * they turned notifications on (Settings, Notifications). Nothing shows for
 * the conversation the window has open while the window has focus.
 *
 * Mount once in the authenticated app shell.
 */
export function useDesktopAttentionNotifications(): void {
  const { activeOrg } = useOrg();
  const { on } = useAttentionNotificationsSetting();
  const { pathname } = useLocation();
  const openSession = openSessionOf(pathname);
  const isShowing = useCallback(
    (sessionId: string) => sessionId === openSession && document.hasFocus(),
    [openSession],
  );
  useAttentionNotifications({
    org: activeOrg?.metadata?.id,
    enabled: on,
    isShowing,
    notify: showNotice,
  });
}
