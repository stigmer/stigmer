import { useEffect, useRef } from "react";
import { followAttention } from "@stigmer/client";
import type { Attention } from "@stigmer/apis/ai/stigmer/agentic/session/v1/io_pb";
import { useStigmer } from "@stigmer/react-core";

/** Why a conversation needs its person, as the server says it (`Attention.reason`). */
export type AttentionReason = "finished" | "failed" | "needs_answer";

/** One notification the hook asks its host to show. */
export interface AttentionNotice {
  /** The conversation it is about: a host opens it when the notice is clicked. */
  readonly sessionId: string;
  /** The notice's title: the conversation's title. */
  readonly title: string;
  /** The notice's line: what happened, in the person's words. */
  readonly body: string;
  readonly reason: AttentionReason;
  /** The attention's id: a host that keeps notices keys them by it. */
  readonly id: string;
}

/** Options for {@link useAttentionNotifications}. */
export interface UseAttentionNotificationsOptions {
  /** The organization whose conversations to watch; none watches nothing. */
  readonly org: string | null | undefined;
  /**
   * Shows one notice: the console's browser `Notification`, the desktop
   * app's system notification. Called once per attention, never for a
   * conversation the person is looking at ({@link isShowing}).
   */
  readonly notify: (notice: AttentionNotice) => void;
  /** Off watches nothing: a person who turned notifications off, or a host with no way to show them. */
  readonly enabled: boolean;
  /** Whether the person is looking at the conversation now: no notice is shown for it. */
  readonly isShowing?: (sessionId: string) => boolean;
}

/** What each reason says. */
const BODIES: Readonly<Record<AttentionReason, string>> = {
  finished: "Finished",
  failed: "Stopped with an error",
  needs_answer: "Waits for your answer",
};

/** The notice an attention makes; undefined for a reason this client does not know. */
export function noticeOf(attention: Attention): AttentionNotice | undefined {
  const reason = attention.reason as AttentionReason;
  const body = BODIES[reason];
  if (body === undefined) return undefined;
  return {
    sessionId: attention.sessionId,
    title: attention.title || "Conversation",
    body,
    reason,
    id: attention.id,
  };
}

/** The first reconnect's wait; the follow doubles it up to its own ceiling. */
const RECONNECT_MS = 1_000;

/**
 * Tells a person, through a notification their host shows, each time a
 * conversation they created in `org` stops working: its turn finished,
 * failed, or waits for their answer. A stop they made themselves tells
 * them nothing, and neither does a conversation they are looking at.
 *
 * It follows `SessionQueryController.streamAttention` (`followAttention` in
 * `@stigmer/client`) for as long as it is enabled and mounted: a stream
 * that drops reconnects from the last attention it showed, so nothing after
 * it is missed and nothing shown twice. It shows nothing itself: the host's
 * `notify` does, and asks the person's permission first (the console from
 * its notification setting, never on load).
 *
 * @example
 * ```tsx
 * useAttentionNotifications({
 *   org,
 *   enabled: notificationsOn,
 *   isShowing: (sessionId) => sessionId === openSessionId,
 *   notify: (notice) => new Notification(notice.title, { body: notice.body, tag: notice.id }),
 * });
 * ```
 */
export function useAttentionNotifications(options: UseAttentionNotificationsOptions): void {
  const stigmer = useStigmer();
  const { org, enabled } = options;
  // The latest callbacks, read at each attention: a host that renders a
  // new function each time never restarts the follow.
  const notifyRef = useRef(options.notify);
  const isShowingRef = useRef(options.isShowing);
  notifyRef.current = options.notify;
  isShowingRef.current = options.isShowing;

  useEffect(() => {
    if (!enabled || !org) return;
    const abort = new AbortController();
    void (async () => {
      try {
        for await (const attention of followAttention(stigmer, org, { signal: abort.signal, backoffMs: RECONNECT_MS })) {
          const notice = noticeOf(attention);
          if (notice === undefined || isShowingRef.current?.(notice.sessionId) === true) continue;
          notifyRef.current(notice);
        }
      } catch (err) {
        // A refusal ends the follow (no access to the organization): there
        // is nothing to tell the person on this page, so it is only logged.
        if (process.env.NODE_ENV !== "production") {
          console.warn("[useAttentionNotifications] the attention follow ended:", err);
        }
      }
    })();
    return () => abort.abort();
  }, [stigmer, org, enabled]);
}
