"use client";

import { Suspense, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useTheme } from "next-themes";
import { Stigmer } from "@stigmer/client";
import {
  ConnectLinkCallback,
  SignInReturn,
  StigmerProvider,
  pendingConnectLinkToken,
} from "@stigmer/react-sdk";
import type { ResolvedColorMode } from "@stigmer/react-sdk";
import { AppHandoffView, StandaloneScreen } from "@stigmer/react-sdk/console";
import { StigmerLogo } from "@/auth/StigmerLogo";
import { getApiBaseUrl } from "@/config/env";

/** The deep link Stigmer Desktop registers for a sign-in that returns through this page. */
const DESKTOP_SIGN_IN_DEEP_LINK = "stigmer://oauth/callback";

/** How long the desktop bridge waits on the operating system before it offers the way back. */
const BRIDGE_FALLBACK_MS = 3000;

/**
 * The one page every sign-in's login page returns to
 * (`STIGMER_OAUTH_REDIRECT_URI`), whoever started it. It is public
 * (`PUBLIC_ROUTES` in `providers/Providers.tsx`): a Connect link's customer
 * has no Stigmer session, and a sign-in started by an app on another
 * address, or by the CLI, has none here either. Three cases, decided in the
 * browser once the page has loaded:
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
 * - Otherwise a sign-in at an address: the SDK's `SignInReturn` hands the
 *   login page's answer to Stigmer (public; the state is the authority),
 *   and the app or terminal that started the sign-in collects it under its
 *   own session. Nothing goes between windows, so it works for an app on
 *   any address and a login page that cuts the window off from its opener.
 */
export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <CallbackRouter />
    </Suspense>
  );
}

/** What finishes this return, read in the browser only (the export prerenders nothing of it). */
type CallbackMode = "desktop" | "sign-in" | `connect-link:${string}`;

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
      return token !== null ? `${CONNECT_LINK_MODE}${token}` : "sign-in";
    },
    () => null,
  );

  if (mode === null) return null;
  if (mode === "desktop") return <DesktopSignInBridge />;
  if (mode === "sign-in") {
    return (
      <PublicCall>
        <SignInReturn />
      </PublicCall>
    );
  }
  return (
    <PublicCall help>
      <ConnectLinkCallback token={mode.slice(CONNECT_LINK_MODE.length)} />
    </PublicCall>
  );
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

  const failed = new URLSearchParams(query).has("error");
  // The operating system may not open the app: after a moment the page
  // says what happened and keeps one way back.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    window.location.href = deepLink;
    const timer = window.setTimeout(() => setSettled(true), BRIDGE_FALLBACK_MS);
    return () => window.clearTimeout(timer);
  }, [deepLink]);

  if (!settled) return <AppHandoffView mark={<StigmerLogo size={40} />} wait="Going back to Stigmer Desktop…" />;
  return (
    <AppHandoffView
      mark={<StigmerLogo size={40} />}
      title={failed ? "Go back to Stigmer Desktop" : "You're signed in"}
      lead={
        failed
          ? "The sign-in didn't finish. Open Stigmer Desktop to see why and try again."
          : "If Stigmer Desktop didn't open, open it here. You can close this tab after."
      }
      href={deepLink}
      actLabel="Open Stigmer Desktop"
    />
  );
}

/**
 * A return finished by a public call (a Connect link's completion, a
 * sign-in's hand-back), with its own client and no token: the person may
 * have no Stigmer session on this address.
 */
function PublicCall({ children, help }: { readonly children: ReactNode; readonly help?: boolean }) {
  const { resolvedTheme } = useTheme();
  const colorMode: ResolvedColorMode = resolvedTheme === "dark" ? "dark" : "light";
  const client = useMemo(() => new Stigmer({ baseUrl: getApiBaseUrl(), getAccessToken: () => null }), []);
  return (
    <StigmerProvider client={client} colorMode={colorMode}>
      <StandaloneScreen mark={<StigmerLogo size={40} />} help={help}>
        {children}
      </StandaloneScreen>
    </StigmerProvider>
  );
}
