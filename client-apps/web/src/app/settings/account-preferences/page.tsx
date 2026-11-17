"use client";

import { useSyncExternalStore } from "react";
import { AccountPreferencesSection } from "@stigmer/react-sdk/console";
import {
  browserNotificationsSupported,
  requestBrowserNotificationPermission,
} from "@/domain/session/AttentionNotifier";

/** Whether notifications are supported never changes in a page's life. */
function subscribeNever(): () => void {
  return () => undefined;
}

export default function AccountPreferencesPage() {
  // The static export renders with no window: read as supported there.
  const unsupported = useSyncExternalStore(
    subscribeNever,
    () => !browserNotificationsSupported(),
    () => false,
  );
  return (
    <AccountPreferencesSection
      requestPermission={requestBrowserNotificationPermission}
      unsupported={unsupported}
    />
  );
}
