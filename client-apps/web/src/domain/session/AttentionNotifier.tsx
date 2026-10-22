"use client";

import { useCallback } from "react";
import {
  useAttentionNotifications,
  useAttentionNotificationsSetting,
  useOrg,
  type AttentionNotice,
} from "@stigmer/react-sdk";
import { useSessionNavigation } from "./session-navigation";

/** Whether this browser can show notifications at all. */
export function browserNotificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

/**
 * Asks the browser's permission to show notifications, from the person's flip
 * of the notifications setting (a browser asks only from a click, and the
 * console never asks on load). Resolves whether notifications may be shown.
 */
export async function requestBrowserNotificationPermission(): Promise<boolean> {
  if (!browserNotificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  return (await Notification.requestPermission()) === "granted";
}

/**
 * Shows a browser notification each time a conversation the person started
 * in the active organization finishes, fails, or waits for their answer, once
 * they turned notifications on (Settings, Notifications) and the browser
 * allows it. Nothing shows for the conversation open in a tab the person is
 * looking at. Clicking a notification brings the console forward on that
 * conversation. Renders nothing; mounted once by the signed-in shell.
 */
export function AttentionNotifier() {
  const { activeOrg } = useOrg();
  const { on } = useAttentionNotificationsSetting();
  const { activeSessionId, navigateToSession } = useSessionNavigation();

  const isShowing = useCallback(
    (sessionId: string) => sessionId === activeSessionId && document.visibilityState === "visible",
    [activeSessionId],
  );
  const notify = useCallback(
    (notice: AttentionNotice) => {
      if (Notification.permission !== "granted") return;
      const shown = new Notification(notice.title, { body: notice.body, tag: notice.id });
      shown.onclick = () => {
        window.focus();
        navigateToSession(notice.sessionId);
        shown.close();
      };
    },
    [navigateToSession],
  );

  useAttentionNotifications({
    org: activeOrg?.metadata?.id,
    enabled: on && browserNotificationsSupported(),
    isShowing,
    notify,
  });
  return null;
}
