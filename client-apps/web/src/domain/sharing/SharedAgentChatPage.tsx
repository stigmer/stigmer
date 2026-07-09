"use client";

import { useMemo } from "react";
import { useTheme } from "next-themes";
import { Stigmer, createGuestAuth } from "@stigmer/sdk";
import { StigmerProvider, SharedAgentChat } from "@stigmer/react";
import type { ResolvedColorMode } from "@stigmer/react";
import { getApiBaseUrl } from "@/config/env";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

/**
 * Public hosted chat page for a shared agent —
 * `/chat/<org>/<slug>`, the URL behind an agent's Share toggle.
 *
 * Renders outside the authenticated provider chain (see `Providers.tsx`
 * PUBLIC_ROUTES): no login wall, no console chrome. The page is a thin
 * shell — everything of substance lives in the SDK:
 *
 * - `createGuestAuth` (`@stigmer/sdk`) mints short-lived guest JWTs via
 *   the public, credential-free `mintGuestToken` RPC and keeps the
 *   visitor's identity stable across visits (localStorage guest id).
 * - `SharedAgentChat` (`@stigmer/react`) resolves the public profile
 *   and renders the guest-audience chat, including the unavailable
 *   state when the agent does not exist or sharing was revoked.
 */
export default function SharedAgentChatPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug", 1);
  const { resolvedTheme } = useTheme();
  const colorMode: ResolvedColorMode =
    resolvedTheme === "dark" ? "dark" : "light";

  // One guest-auth manager + client per resolved org/slug pair. The
  // token provider mints lazily on the first RPC, so nothing happens
  // on the network until the page actually renders the chat.
  const client = useMemo(() => {
    if (!org || !slug) return null;
    const baseUrl = getApiBaseUrl();
    const guestAuth = createGuestAuth({ baseUrl, org, slug });
    return new Stigmer({ baseUrl, getAccessToken: guestAuth.getAccessToken });
  }, [org, slug]);

  // Route params resolve synchronously except during the static-export
  // placeholder pass, where window is unavailable — render nothing
  // rather than a flash of the unavailable state.
  if (!org || !slug || !client) {
    return null;
  }

  return (
    <StigmerProvider client={client} colorMode={colorMode} preset="monochrome">
      <div className="h-screen bg-background text-foreground">
        <SharedAgentChat org={org} slug={slug} />
      </div>
    </StigmerProvider>
  );
}
