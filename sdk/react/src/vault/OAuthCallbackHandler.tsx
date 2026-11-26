"use client";

/**
 * The Slack install's return page: it hands the `code` and `state` to the
 * page that started the install, in the same browser and on the same
 * address, and closes. It knows nothing of what was installed; the page
 * that started the flow completes it (the Slack connect's own call).
 *
 * A sign-in at an address returns to `SignInReturn` instead, which hands
 * the answer to Stigmer, so it finishes from an app on any address. This
 * page only sends: it never says "Connected", since it cannot know the
 * page it sent to finished.
 */

import { useEffect, useRef, useState } from "react";
import {
  OAUTH_CALLBACK_MESSAGE_TYPE,
  OAUTH_BROADCAST_CHANNEL,
} from "../internal/oauthPopup.js";
import type { OAuthCallbackMessage } from "../internal/oauthPopup.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { ScreenColumn } from "../internal/ScreenColumn.js";
import { ScreenWait } from "../standalone-screen/StandaloneScreen.js";

/** Parameters extracted from the OAuth callback URL. */
export interface OAuthCallbackParams {
  /** The authorization code returned by the OAuth provider. */
  readonly code: string;
  /** The opaque state token used to correlate the callback with the originating request. */
  readonly state: string;
}

/** Props for {@link OAuthCallbackHandler}. */
export interface OAuthCallbackHandlerProps {
  /**
   * Fallback callback invoked when the page was opened as a regular
   * navigation (no `window.opener`), meaning the popup `postMessage`
   * path cannot be used.
   *
   * Receives the extracted `code` and `state` so the host application
   * can complete the OAuth flow via its own routing logic.
   *
   * When omitted and `window.opener` is unavailable, the component
   * renders an instructional message asking the user to close the tab.
   */
  readonly onFallback?: (params: OAuthCallbackParams) => void;
  /**
   * The app the person goes back to, as they know it ("Stigmer"), in the
   * page's lines: "Sent back to Stigmer".
   *
   * @default "the app"
   */
  readonly appName?: string;
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/** Tells the page that started a sign-in, on every transport that may reach it; best effort. */
function announce(message: OAuthCallbackMessage): void {
  try {
    const bc = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
    bc.postMessage(message);
    bc.close();
  } catch {
    // BroadcastChannel unavailable: the opener below is the only path.
  }
  try {
    const opener = window.opener as Window | null;
    if (opener && !opener.closed) opener.postMessage(message, window.location.origin);
  } catch {
    // An opener of another origin cannot be told.
  }
}

/**
 * Lightweight component for OAuth callback pages.
 *
 * Render this component at the Slack install's redirect URI. It extracts
 * the `code` and `state` query parameters from the current URL, posts them
 * back to the opener window via `window.postMessage`, and closes the
 * popup. A sign-in at an address (`STIGMER_OAUTH_REDIRECT_URI`) renders
 * `SignInReturn`.
 *
 * The component handles three scenarios:
 * 1. **Popup with opener** (primary): posts the message and closes.
 * 2. **No opener, `onFallback` provided**: calls the fallback with
 *    the extracted parameters so the host app can handle them.
 * 3. **No opener, no fallback**: says the window could not reach the app,
 *    and to go back to it.
 *
 * When the login page refused (`error`), the refusal is passed to the
 * page that started the sign-in, so its wait ends at once, and shown here.
 *
 * Platform builders create a route in their application that renders
 * this component:
 *
 * @example
 * ```tsx
 * // app/oauth/slack/callback/page.tsx (Next.js)
 * import { OAuthCallbackHandler } from "@stigmer/react-sdk";
 *
 * export default function SlackCallbackPage() {
 *   return <OAuthCallbackHandler />;
 * }
 * ```
 */
export function OAuthCallbackHandler({
  onFallback,
  appName = "the app",
  className,
}: OAuthCallbackHandlerProps) {
  const [status, setStatus] = useState<"processing" | "done" | "no-opener" | "error">("processing");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const didRun = useRef(false);

  useEffect(() => {
    if (didRun.current) return;
    didRun.current = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    const state = params.get("state");

    const oauthError = params.get("error");
    if (oauthError) {
      const description = params.get("error_description") || oauthError;
      // The page that started the sign-in hears the refusal at once,
      // rather than waiting out its timeout.
      if (state) {
        announce({ type: OAUTH_CALLBACK_MESSAGE_TYPE, code: "", state, error: description });
      }
      setErrorMessage(`the sign-in page said: ${description}`);
      setStatus("error");
      return;
    }

    if (!code || !state) {
      setErrorMessage(
        "this page was opened without the sign-in's code; it only finishes a sign-in that sent you here",
      );
      setStatus("error");
      return;
    }

    const message: OAuthCallbackMessage = {
      type: OAUTH_CALLBACK_MESSAGE_TYPE,
      code,
      state,
    };

    // Always broadcast via BroadcastChannel — works even when
    // Cross-Origin-Opener-Policy has severed window.opener.
    let broadcastSent = false;
    try {
      const bc = new BroadcastChannel(OAUTH_BROADCAST_CHANNEL);
      bc.postMessage(message);
      bc.close();
      broadcastSent = true;
    } catch {
      // BroadcastChannel unavailable — rely on postMessage below.
    }

    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      try {
        opener.postMessage(message, window.location.origin);
        setStatus("done");
        window.close();
      } catch {
        if (broadcastSent) {
          setStatus("done");
          window.close();
        } else {
          setErrorMessage(
            "the window that started the sign-in couldn't be reached",
          );
          setStatus("error");
        }
      }
      return;
    }

    // opener is null (COOP case) but BroadcastChannel delivered the message.
    if (broadcastSent) {
      setStatus("done");
      window.close();
      return;
    }

    if (onFallback) {
      onFallback({ code, state });
      setStatus("done");
      return;
    }

    setStatus("no-opener");
  }, [onFallback]);

  if (status === "processing") {
    return (
      <ScreenColumn className={className}>
        <ScreenWait>Finishing the connection…</ScreenWait>
      </ScreenColumn>
    );
  }
  if (status === "done") {
    return (
      <ScreenColumn
        className={className}
        headingLevel={1}
        title={`Sent back to ${appName}`}
        lead={`It finishes in ${appName}. You can close this window.`}
      />
    );
  }
  if (status === "no-opener") {
    return (
      <ScreenColumn
        className={className}
        headingLevel={1}
        title={`Go back to ${appName}`}
        lead={`This window couldn't reach ${appName}, so nothing was finished here. Close this tab and try again from ${appName}.`}
      />
    );
  }
  return (
    <ScreenColumn className={className}>
      <ErrorMessage
        error={new Error(errorMessage ?? "the sign-in didn't finish")}
        title="The connection didn't finish."
        comfort={`Nothing was saved. Close this window and try again from ${appName}.`}
      />
    </ScreenColumn>
  );
}
