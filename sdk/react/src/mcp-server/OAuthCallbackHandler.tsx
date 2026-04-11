"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { OAUTH_CALLBACK_MESSAGE_TYPE } from "./useMcpServerOAuthConnect";
import type { OAuthCallbackMessage } from "./useMcpServerOAuthConnect";

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
  /** Additional CSS classes for the root container. */
  readonly className?: string;
}

/**
 * Lightweight component for OAuth callback pages.
 *
 * Render this component at the URL configured as your OAuth redirect
 * URI (`STIGMER_OAUTH_REDIRECT_URI`). It extracts the `code` and
 * `state` query parameters from the current URL, posts them back to
 * the opener window via `window.postMessage`, and closes the popup.
 *
 * The component handles three scenarios:
 * 1. **Popup with opener** (primary): posts the message and closes.
 * 2. **No opener, `onFallback` provided**: calls the fallback with
 *    the extracted parameters so the host app can handle them.
 * 3. **No opener, no fallback**: shows a message asking the user to
 *    return to the main window.
 *
 * Platform builders create a route in their application that renders
 * this component:
 *
 * @example
 * ```tsx
 * // app/auth/oauth/callback/page.tsx (Next.js)
 * import { OAuthCallbackHandler } from "@stigmer/react";
 *
 * export default function OAuthCallbackPage() {
 *   return <OAuthCallbackHandler />;
 * }
 * ```
 */
export function OAuthCallbackHandler({
  onFallback,
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
      setErrorMessage(`Authentication failed: ${description}`);
      setStatus("error");
      return;
    }

    if (!code || !state) {
      setErrorMessage(
        "Missing authorization code or state parameter. " +
          "This page should only be reached via an OAuth redirect.",
      );
      setStatus("error");
      return;
    }

    const opener = window.opener as Window | null;
    if (opener && !opener.closed) {
      const message: OAuthCallbackMessage = {
        type: OAUTH_CALLBACK_MESSAGE_TYPE,
        code,
        state,
      };

      try {
        opener.postMessage(message, window.location.origin);
        setStatus("done");
        window.close();
      } catch {
        setErrorMessage(
          "Could not communicate with the parent window. " +
            "Please close this tab and try again.",
        );
        setStatus("error");
      }
      return;
    }

    if (onFallback) {
      onFallback({ code, state });
      setStatus("done");
      return;
    }

    setStatus("no-opener");
  }, [onFallback]);

  return (
    <div
      className={cn(
        "flex min-h-[200px] items-center justify-center p-8",
        className,
      )}
    >
      <div className="max-w-sm text-center">
        {status === "processing" && (
          <>
            <Spinner />
            <p className="mt-3 text-sm text-muted-foreground">
              Completing authentication...
            </p>
          </>
        )}

        {status === "done" && (
          <p className="text-sm text-muted-foreground">
            Authentication complete. You can close this window.
          </p>
        )}

        {status === "no-opener" && (
          <>
            <CheckIcon />
            <p className="mt-3 text-sm font-medium text-foreground">
              Authentication successful
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Please close this tab and return to the application to continue.
            </p>
          </>
        )}

        {status === "error" && (
          <>
            <WarningIcon />
            <p className="mt-3 text-sm font-medium text-destructive">
              Authentication failed
            </p>
            {errorMessage && (
              <p className="mt-1 text-xs text-muted-foreground">
                {errorMessage}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icons -- inline SVGs (no external icon dependency, matches SDK pattern)
// ---------------------------------------------------------------------------

function Spinner() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="mx-auto animate-spin text-muted-foreground"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mx-auto text-success"
      aria-hidden="true"
    >
      <path d="m3 8.5 3.5 3.5 6.5-8" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mx-auto text-destructive"
      aria-hidden="true"
    >
      <path d="M8 1.5 1 14h14L8 1.5Z" />
      <path d="M8 6v3.5" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}
