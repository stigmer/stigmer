"use client";

import { Suspense, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { GitHubCallbackPageView } from "@/auth/github/GitHubCallbackPageView";

function CallbackSpinner({ message }: { message?: string }) {
  return (
    <div className="flex h-screen items-center justify-center">
      <div className="text-center space-y-2">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-foreground mx-auto" />
        <p className="text-sm text-muted-foreground">
          {message ?? "Loading..."}
        </p>
      </div>
    </div>
  );
}

export default function GitHubCallbackPage() {
  return (
    <Suspense fallback={<CallbackSpinner />}>
      <CallbackRouter />
    </Suspense>
  );
}

/**
 * Routes the GitHub OAuth callback to the appropriate handler.
 *
 * When `source=desktop` is present in the query params, the flow was
 * initiated by Stigmer Desktop. Instead of processing the callback in
 * the web console, the page redirects to a `stigmer://` deep link
 * that delivers the authorization code and state back to the desktop
 * app. The desktop app exchanges the code using its own authenticated
 * Stigmer client — no web console session required.
 *
 * All other flows (popup, full-page redirect) use the standard
 * {@link GitHubCallbackPageView}.
 */
function CallbackRouter() {
  const searchParams = useSearchParams();

  if (searchParams.get("source") === "desktop") {
    return <DesktopGitHubBridge />;
  }

  return <GitHubCallbackPageView />;
}

/**
 * Deep link bridge for Stigmer Desktop's GitHub OAuth flow.
 *
 * Reads the `code` and `state` query params from the GitHub redirect
 * and immediately navigates to the `stigmer://github/callback` custom
 * scheme URL. The OS routes this to the Tauri app, which extracts the
 * params and completes the token exchange server-side.
 *
 * This component has no auth dependencies — it is a pure redirect.
 */
function DesktopGitHubBridge() {
  const searchParams = useSearchParams();
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  useEffect(() => {
    if (!code || !state) return;

    const deepLink =
      `stigmer://github/callback` +
      `?code=${encodeURIComponent(code)}` +
      `&state=${encodeURIComponent(state)}`;

    window.location.href = deepLink;
  }, [code, state]);

  if (!code || !state) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-sm text-destructive">
          Missing authorization code or state parameter.
        </p>
      </div>
    );
  }

  return <CallbackSpinner message="Redirecting to Stigmer Desktop..." />;
}
