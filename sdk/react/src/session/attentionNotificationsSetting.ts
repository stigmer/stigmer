import { useCallback, useSyncExternalStore } from "react";

/**
 * Whether this viewer asked to be told when a conversation needs them: a
 * per-browser choice, kept in localStorage and synced across tabs. Off until
 * the person turns it on, because turning it on is where a host asks the
 * system's permission to show notifications (never on load).
 */
export const ATTENTION_NOTIFICATIONS_KEY = "stigmer:attention-notifications";

function readSetting(): boolean {
  try {
    return localStorage.getItem(ATTENTION_NOTIFICATIONS_KEY) === "true";
  } catch {
    return false;
  }
}

function readServerSetting(): boolean {
  return false;
}

function subscribe(callback: () => void): () => void {
  function onStorage(e: StorageEvent) {
    if (e.key === ATTENTION_NOTIFICATIONS_KEY) callback();
  }
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}

function writeSetting(on: boolean): void {
  try {
    localStorage.setItem(ATTENTION_NOTIFICATIONS_KEY, String(on));
  } catch {
    /* private browsing: the choice lasts this page only */
  }
  window.dispatchEvent(new StorageEvent("storage", { key: ATTENTION_NOTIFICATIONS_KEY }));
}

/** Return value of {@link useAttentionNotificationsSetting}. */
export interface AttentionNotificationsSetting {
  /** Whether the person turned notifications on in this browser. */
  readonly on: boolean;
  /** Records the person's choice. */
  readonly set: (on: boolean) => void;
}

/**
 * The person's notification choice in this browser: what
 * `useAttentionNotifications`'s `enabled` reads, and what the notifications
 * settings section writes.
 */
export function useAttentionNotificationsSetting(): AttentionNotificationsSetting {
  const on = useSyncExternalStore(subscribe, readSetting, readServerSetting);
  const set = useCallback((next: boolean) => writeSetting(next), []);
  return { on, set };
}
