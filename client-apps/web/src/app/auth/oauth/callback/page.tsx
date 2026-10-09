"use client";

import { Suspense, useEffect, useMemo, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Stigmer } from "@stigmer/sdk";
import {
  ConnectLinkCallback,
  OAuthCallbackHandler,
  StigmerProvider,
  pendingConnectLinkToken,
} from "@stigmer/react";
import type { ResolvedColorMode } from "@stigmer/react";
import { getApiBaseUrl } from "@/config/env";

/** The deep link Stigmer Desktop registers for a sign-in that returns through this page. */
const DESKTOP_SIGN_IN_DEEP_LINK = "stigmer://oauth/callback";

/**
 * The one page every sign-in's login page returns to
 * (`STIGMER_OAUTH_REDIRECT_URI`), whoever started it. It is public
 * (`PUBLIC_ROUTES` in `providers/Providers.tsx`): a Connect link's customer
 * has no Stigmer session, and a popup needs none. Three cases, decided in
 * the browser once the page has loaded:
 *
 * - `source=desktop`: the sign-in was started by Stigmer Desktop in the
 *   system browser. The page hands the code and state on to the app through
 *   its deep link, and the app finishes the sign-in with its own session.
 * - The return's `state` is the one a Connect link this tab started with
 *   (`pendingConnectLinkToken(state)` answers the link's secret): the SDK's
 *   `ConnectLinkCallback` finishes the link's sign-in and sends the browser
 *   on to the integrator's return URL. The state decides, never
 *   `window.opener`: an integrator may open the link in a window of its
 *   own, whose opener a browser lets this page see.
 * - Otherwise a popup: the SDK's `OAuthCallbackHandler` posts the code and
 *   state back to the page that opened it.
 */
export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackRouter />
    </Suspense>
  );
}

/** What finishes this return, read in the browser only (the export prerenders nothing of it). */
type CallbackMode = "desktop" | "popup" | `connect-link:${string}`;

const CONNECT_LINK_MODE = "connect-link:";

/** The page's mode never changes while it is open: there is nothing to subscribe to. */
function subscribeToNothing(): () => void {
  return () => {};
}

function CallbackRouter() {
  const params = useSearchParams();
  const fromDesktop = params.get("source") === "desktop";
  const state = params.get("state");
  const mode = useSyncExternalStore<CallbackMode | null>(
    subscribeToNothing,
    () => {
      if (fromDesktop) return "desktop";
      const token = pendingConnectLinkToken(state);
      return token !== null ? `${CONNECT_LINK_MODE}${token}` : "popup";
    },
    () => null,
  );

  if (mode === null) return null;
  if (mode === "desktop") return <DesktopSignInBridge />;
  if (mode === "popup") return <OAuthCallbackHandler className="min-h-screen" />;
  return <ConnectLinkCompletion token={mode.slice(CONNECT_LINK_MODE.length)} />;
}

/**
 * Hands a desktop sign-in back to Stigmer Desktop: the code, state (or the
 * login page's error) go to the app's deep link, which the OS routes to the
 * app. No session is needed here — it is a pure redirect.
 */
function DesktopSignInBridge() {
  const query = useSearchParams().toString();
  const deepLink = useMemo(() => {
    const received = new URLSearchParams(query);
    const forwarded = new URLSearchParams();
    for (const key of ["code", "state", "error", "error_description"]) {
      const value = received.get(key);
      if (value !== null) forwarded.set(key, value);
    }
    return `${DESKTOP_SIGN_IN_DEEP_LINK}?${forwarded.toString()}`;
  }, [query]);

  useEffect(() => {
    window.location.href = deepLink;
  }, [deepLink]);

  return (
    <div className="flex h-screen items-center justify-center">
      <p className="text-sm text-muted-foreground">Returning to Stigmer Desktop...</p>
    </div>
  );
}

/** A Connect link's completion, with its own client and no token: the call is public. */
function ConnectLinkCompletion({ token }: { readonly token: string }) {
  const { resolvedTheme } = useTheme();
  const colorMode: ResolvedColorMode = resolvedTheme === "dark" ? "dark" : "light";
  const client = useMemo(() => new Stigmer({ baseUrl: getApiBaseUrl(), getAccessToken: () => null }), []);
  return (
    <StigmerProvider client={client} colorMode={colorMode} preset="monochrome">
      <ConnectLinkCallback token={token} className="min-h-screen" />
    </StigmerProvider>
  );
}
