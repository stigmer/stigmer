"use client";

import { useSyncExternalStore } from "react";
import { NotificationsSection } from "@stigmer/react-sdk/console";
import {
  browserNotificationsSupported,
  requestBrowserNotificationPermission,
} from "@/domain/session/AttentionNotifier";

/** Whether notifications are supported never changes in a page's life. */
function subscribeNever(): () => void {
  return () => undefined;
}

export default function NotificationsPage() {
  // The static export renders with no window: read as supported there.
  const unsupported = useSyncExternalStore(
    subscribeNever,
    () => !browserNotificationsSupported(),
    () => false,
  );
  return (
    <NotificationsSection
      requestPermission={requestBrowserNotificationPermission}
      unsupported={unsupported}
    />
  );
}
