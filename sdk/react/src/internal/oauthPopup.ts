"use client";

/**
 * Shared OAuth popup machinery.
 *
 * Provider-agnostic plumbing for browser OAuth flows that complete via a
 * popup window: open the popup synchronously (before any async work, so
 * popup blockers allow it), navigate it to the provider's consent screen,
 * and wait for the callback page to post `{ code, state }` back.
 *
 * Consumed by `useMcpServerOAuthConnect` (MCP server OAuth) and
 * `useConnectSlackChannel` (agent channel installs). The callback side of
 * the contract is `OAuthCallbackHandler`, which posts
 * {@link OAuthCallbackMessage} via `window.opener.postMessage` and the
 * {@link OAUTH_BROADCAST_CHANNEL} BroadcastChannel.
 *
 * Not exported from the public barrel — platform builders interact with
 * the behavior hooks and `OAuthCallbackHandler`, never this module.
 */

/**
 * Message type posted by `OAuthCallbackHandler` to the opener window.
 *
 * @internal
 */
export const OAUTH_CALLBACK_MESSAGE_TYPE = "stigmer:oauth:callback";

/**
 * BroadcastChannel name used as a fallback when `window.opener` is severed
 * by `Cross-Origin-Opener-Policy` headers on the OAuth provider.
 *
 * @internal
 */
export const OAUTH_BROADCAST_CHANNEL = "stigmer:oauth:broadcast";

/**
 * Shape of the `postMessage` payload sent from the OAuth callback popup.
 *
 * @internal
 */
export interface OAuthCallbackMessage {
  readonly type: typeof OAUTH_CALLBACK_MESSAGE_TYPE;
  readonly code: string;
  readonly state: string;
}

/**
 * The subset of `Window` the callback-wait machinery needs from the popup.
 *
 * `Window` satisfies this structurally; tests pass a plain fake instead of
 * constructing a real window.
 *
 * @internal
 */
export interface OAuthPopupHandle {
  readonly closed: boolean;
  close(): void;
}

const POPUP_WIDTH = 600;
const POPUP_HEIGHT = 700;

/**
 * Overall timeout for the callback wait. The safety net for abandoned
 * flows — especially under COOP, where `popup.closed` is unreliable.
 */
const POPUP_CALLBACK_TIMEOUT_MS = 120_000;

/**
 * Grace period (ms) after `popup.closed` is first detected before treating
 * it as a user-initiated close.
 *
 * Only used when BroadcastChannel is unavailable. When BC is available,
 * `popup.closed` polling is skipped entirely because COOP providers
 * (e.g. Sentry, GitHub) sever the opener reference on cross-origin
 * navigation, making `popup.closed` permanently `true` while the popup
 * is still active. The overall {@link POPUP_CALLBACK_TIMEOUT_MS} serves
 * as the safety net for abandoned flows instead.
 */
const POPUP_CLOSED_GRACE_MS = 5_000;

/**
 * Open a centered OAuth popup at `about:blank`.
 *
 * **Must be called from a synchronous user-gesture handler** (before any
 * `await`) so the browser allows the popup. Returns `null` when the
 * browser blocks it — callers surface {@link popupBlockedError}.
 *
 * @internal
 */
export function openOAuthPopup(): Window | null {
  const left = window.screenX + (window.outerWidth - POPUP_WIDTH) / 2;
  const top = window.screenY + (window.outerHeight - POPUP_HEIGHT) / 2;
  return window.open(
    "about:blank",
    "stigmer_oauth",
    `width=${POPUP_WIDTH},height=${POPUP_HEIGHT},left=${left},top=${top},popup=yes`,
  );
}

/**
 * The user-facing error for a popup the browser refused to open.
 *
 * @internal
 */
export function popupBlockedError(): Error {
  return new Error(
    "Your browser blocked the authentication popup. " +
      "Please allow popups for this site and try again.",
  );
}

/**
 * Wait for the OAuth callback page to deliver `{ code, state }`.
 *
 * Listens on two transports simultaneously:
 *
 * 1. `window.postMessage` from the popup (origin-checked) — works when
 *    the provider preserves `window.opener`.
 * 2. A {@link OAUTH_BROADCAST_CHANNEL} BroadcastChannel — works even when
 *    COOP headers sever the opener reference.
 *
 * Rejects on state mismatch, missing code, timeout, user-closed popup
 * (legacy transport only — see {@link POPUP_CLOSED_GRACE_MS}), or
 * cancellation via the `onDispose` handle.
 *
 * @param popup - The popup opened by {@link openOAuthPopup}.
 * @param expectedState - The `state` returned by the initiate RPC; the
 *   callback must echo it exactly.
 * @param onDispose - Receives a dispose function the caller can invoke to
 *   cancel the wait (settles with a cancellation error and closes the popup).
 *
 * @internal
 */
export function waitForOAuthCallback(
  popup: OAuthPopupHandle,
  expectedState: string,
  onDispose: (dispose: () => void) => void,
): Promise<{ code: string; state: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout>;
    let pollId: ReturnType<typeof setInterval>;
    let bc: BroadcastChannel | null = null;
    let hasBroadcastChannel = false;

    function cleanup() {
      if (timeoutId) clearTimeout(timeoutId);
      if (pollId) clearInterval(pollId);
      window.removeEventListener("message", onMessage);
      try { bc?.close(); } catch { /* ignore */ }
    }

    function settle(
      outcome: { code: string; state: string } | Error,
    ) {
      if (settled) return;
      settled = true;
      cleanup();
      if (outcome instanceof Error) {
        reject(outcome);
      } else {
        resolve(outcome);
      }
    }

    onDispose(() => {
      settle(new Error("OAuth flow was cancelled."));
      closeOAuthPopup(popup);
    });

    function validateAndSettle(data: OAuthCallbackMessage | undefined) {
      if (data?.type !== OAUTH_CALLBACK_MESSAGE_TYPE) return;

      if (data.state !== expectedState) {
        settle(
          new Error(
            "OAuth state mismatch — the callback did not match the " +
              "initiated flow. Please try again.",
          ),
        );
        return;
      }

      if (!data.code) {
        settle(new Error("No authorization code received from the OAuth provider."));
        return;
      }

      settle({ code: data.code, state: data.state });
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      validateAndSettle(event.data as OAuthCallbackMessage | undefined);
    }

    window.addEventListener("message", onMessage);

    // BroadcastChannel — works even when COOP severs window.opener.
    try {
      bc = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
      hasBroadcastChannel = true;
      bc.onmessage = (event: MessageEvent) => {
        validateAndSettle(event.data as OAuthCallbackMessage | undefined);
      };
    } catch {
      // BroadcastChannel unsupported — rely on postMessage only.
    }

    timeoutId = setTimeout(() => {
      settle(
        new Error(
          "OAuth authentication timed out. Ensure your callback page " +
            "renders <OAuthCallbackHandler /> from @stigmer/react at " +
            "the URL configured as your OAuth redirect URI.",
        ),
      );
      closeOAuthPopup(popup);
    }, POPUP_CALLBACK_TIMEOUT_MS);

    // When BroadcastChannel is available, skip popup.closed polling.
    // COOP providers (Sentry, GitHub, etc.) sever the opener reference
    // on cross-origin navigation, making popup.closed permanently true
    // while the popup is still active. BroadcastChannel reliably
    // delivers the callback regardless of COOP; the overall timeout
    // above catches abandoned flows.
    //
    // When BroadcastChannel is NOT available (legacy browsers), fall
    // back to popup.closed polling with a short grace period — it is
    // the only signal we have in that degraded path.
    let popupClosedAt: number | null = null;

    pollId = setInterval(() => {
      if (hasBroadcastChannel) return;

      if (popup.closed) {
        if (popupClosedAt === null) {
          popupClosedAt = Date.now();
        } else if (Date.now() - popupClosedAt > POPUP_CLOSED_GRACE_MS) {
          settle(new Error("The authentication window was closed before completing sign-in."));
        }
      } else {
        popupClosedAt = null;
      }
    }, 500);
  });
}

/**
 * Close a popup, swallowing the cross-origin `close()` throw.
 *
 * @internal
 */
export function closeOAuthPopup(popup: OAuthPopupHandle | null) {
  try {
    popup?.close();
  } catch {
    // Cross-origin popup may throw on close — safe to ignore.
  }
}
