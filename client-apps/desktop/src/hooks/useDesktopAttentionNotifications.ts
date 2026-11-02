import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { invoke } from "@tauri-apps/api/core";
import {
  isPermissionGranted,
  onNotificationClicked,
  requestPermission,
  sendNotification,
} from "@choochmeque/tauri-plugin-notifications-api";
import {
  useAttentionNotifications,
  useAttentionNotificationsSetting,
  useOrg,
  type AttentionNotice,
} from "@stigmer/react-sdk";

/**
 * The key a notice's data carries its conversation under. The notification
 * plugin hands the data back, as strings, when the notice is clicked, even
 * when the click is what launched the app.
 */
export const NOTICE_SESSION_KEY = "sessionId";

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
  void sendNotification({
    title: notice.title,
    body: notice.body,
    extra: { [NOTICE_SESSION_KEY]: notice.sessionId },
  });
}

/**
 * Shows a system notification each time a conversation the person started in
 * the active organization finishes, fails, or waits for their answer, once
 * they turned notifications on (Settings, Notifications). Nothing shows for
 * the conversation the window has open while the window has focus.
 *
 * Mount once in the authenticated app shell, beside
 * {@link useOpenNotifiedConversation}, which opens a clicked one.
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

/**
 * Clicking a notification brings the window forward on the conversation it
 * is about, as the web console's does. A click that launched the app is held
 * by the plugin and arrives once this listens. A notice with no conversation
 * in its data (none the app sent) only brings the window forward.
 *
 * Mount once in the authenticated app shell.
 */
export function useOpenNotifiedConversation(): void {
  const navigate = useNavigate();

  useEffect(
    () => {
      let cancelled = false;
      const listening = onNotificationClicked(({ data }) => {
        if (cancelled) return;
        void invoke("show_main_window");
        const sessionId = data?.[NOTICE_SESSION_KEY];
        if (sessionId) navigate(`/sessions/${encodeURIComponent(sessionId)}`);
      });
      return () => {
        cancelled = true;
        void listening.then((listener) => listener.unregister());
      };
    },
    // Stryker disable next-line ArrayDeclaration: the listener navigates to an absolute path, which any navigate the router gave resolves alike
    [navigate],
  );
}
