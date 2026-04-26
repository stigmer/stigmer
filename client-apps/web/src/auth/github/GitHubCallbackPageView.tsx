"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useGitHubConnection,
  GITHUB_CALLBACK_MESSAGE_TYPE,
  useActiveOrgSlug,
} from "@stigmer/react";
import { Button } from "@/domain/_shared/ui/button";

/**
 * Whether this page is running inside a popup window opened by the
 * OAuth flow (as opposed to a full-page redirect). Determined once on
 * mount — `window.opener` is non-null when opened via `window.open`.
 */
function isPopupWindow(): boolean {
  try {
    return window.opener != null && !window.opener.closed;
  } catch {
    return false;
  }
}

/**
 * Signal the opener window that the OAuth flow completed successfully
 * and close this popup. The opener's `useGitHubConnection` hook
 * listens for this message and re-reconciles the token from the
 * personal environment.
 */
function signalOpenerAndClose(): void {
  try {
    window.opener?.postMessage(
      { type: GITHUB_CALLBACK_MESSAGE_TYPE },
      window.location.origin,
    );
  } catch {
    // Cross-origin or closed opener — fall through.
  }
  window.close();
}

/**
 * OAuth callback view for GitHub.
 *
 * GitHub redirects here after the user authorizes. The page reads the
 * `code` and `state` query params, exchanges the code for a token via
 * the Stigmer backend, persists it in the personal environment, and
 * either signals the opener popup or redirects to the home page.
 *
 * When running inside a popup (opened by the `connect({ popup: true })`
 * flow), the page sends a `postMessage` to the opener and closes
 * itself instead of navigating. This keeps the user on the original
 * page without context loss.
 *
 * The effect waits for both org context and the personal environment
 * to be ready before calling `handleCallback`, which writes the token
 * directly to the server-side personal environment.
 */
export function GitHubCallbackPageView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const org = useActiveOrgSlug();
  const { handleCallback, isLoading } = useGitHubConnection(org || null);

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const missingParams = !code || !state;

  const [error, setError] = useState<string | null>(
    missingParams ? "Missing authorization code or state parameter" : null,
  );
  const exchangedRef = useRef(false);
  const [isPopup] = useState(isPopupWindow);

  const handleSuccess = useCallback(() => {
    if (isPopup) {
      signalOpenerAndClose();
    } else {
      router.replace("/");
    }
  }, [isPopup, router]);

  const handleError = useCallback((err: unknown) => {
    setError(
      err instanceof Error
        ? err.message
        : "Failed to connect GitHub account",
    );
  }, []);

  useEffect(() => {
    if (missingParams || exchangedRef.current || !org || isLoading) return;
    exchangedRef.current = true;

    const redirectUri = `${window.location.origin}/auth/github/callback`;

    handleCallback(code, state, redirectUri)
      .then(handleSuccess)
      .catch(handleError);
  }, [
    code,
    state,
    missingParams,
    org,
    isLoading,
    handleCallback,
    handleSuccess,
    handleError,
  ]);

  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="max-w-md space-y-4 text-center">
          <p className="text-sm text-destructive">{error}</p>
          {isPopup ? (
            <p className="text-xs text-muted-foreground">
              You can close this window and try again.
            </p>
          ) : (
            <Button onClick={() => router.replace("/")}>
              Back to Home
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center space-y-2">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          Connecting your GitHub account...
        </p>
      </div>
    </div>
  );
}
