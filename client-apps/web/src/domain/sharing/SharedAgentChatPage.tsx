"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { Stigmer, createGuestAuth, isPermissionDenied } from "@stigmer/sdk";
import { isEmbedded, notifyParent, resolveParentOrigin } from "@stigmer/embed";
import { StigmerProvider, SharedAgentChat } from "@stigmer/react";
import type { ResolvedColorMode } from "@stigmer/react";
import { getApiBaseUrl } from "@/config/env";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

/**
 * Public hosted chat page for a shared agent —
 * `/chat/<org>/<slug>`, the URL behind an agent's Share toggle and the
 * page the `<stigmer-agent>` embed widget frames.
 *
 * Renders outside the authenticated provider chain (see `Providers.tsx`
 * PUBLIC_ROUTES): no login wall, no console chrome. The page is a thin
 * shell — everything of substance lives in the SDK:
 *
 * - `createGuestAuth` (`@stigmer/sdk`) mints short-lived guest JWTs via
 *   the public, credential-free `mintGuestToken` RPC and keeps the
 *   visitor's identity stable across visits (localStorage guest id).
 * - `@stigmer/embed` owns the embed protocol: when the page runs inside
 *   an iframe it discovers the embedding page's origin from
 *   browser-authentic sources and reports `ready`/`refused` to the
 *   loader.
 * - `SharedAgentChat` (`@stigmer/react`) resolves the public profile
 *   and renders the guest-audience chat, including the unavailable
 *   state when the agent does not exist or sharing was revoked.
 *
 * Embedded flow: the discovered parent origin rides the mint request,
 * where the server validates it against the agent's `allowed_origins`
 * and stamps it into the guest JWT. The mint is eager (unlike the
 * standalone page's lazy first-RPC mint) so a disallowed embed hides
 * before the visitor types anything, instead of failing on their first
 * message.
 */

/** Where the page is in the embed lifecycle. Standalone pages skip it entirely. */
type EmbedPhase =
  | { readonly kind: "standalone" }
  | { readonly kind: "resolving" }
  | { readonly kind: "active"; readonly parentOrigin: string }
  | { readonly kind: "refused" };

export default function SharedAgentChatPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug", 1);
  const colorMode = usePageColorMode();

  const [phase, setPhase] = useState<EmbedPhase>(() =>
    isEmbedded() ? { kind: "resolving" } : { kind: "standalone" },
  );

  useEffect(() => {
    if (phase.kind !== "resolving") return;
    let cancelled = false;
    void resolveParentOrigin().then((parentOrigin) => {
      if (!cancelled) {
        setPhase({ kind: "active", parentOrigin });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [phase.kind]);

  // One guest-auth manager + client per resolved org/slug (+ embed
  // context). Standalone pages mint lazily on the first RPC, so nothing
  // happens on the network until the page actually renders the chat.
  const runtime = useMemo(() => {
    if (!org || !slug) return null;
    if (phase.kind === "resolving" || phase.kind === "refused") return null;
    const baseUrl = getApiBaseUrl();
    const guestAuth = createGuestAuth({
      baseUrl,
      org,
      slug,
      // Absent on the standalone page — the server's absence-means-exempt
      // rule is what keeps the hosted link anyone-with-link.
      ...(phase.kind === "active" ? { embedOrigin: phase.parentOrigin } : {}),
    });
    const client = new Stigmer({
      baseUrl,
      getAccessToken: guestAuth.getAccessToken,
    });
    return { client, guestAuth };
  }, [org, slug, phase]);

  // Embedded pages mint eagerly: an origin refusal must hide the widget
  // before the visitor invests in it. Any other failure (network blip,
  // editions without guest minting) keeps the widget up and lets the
  // existing lazy error paths surface it on actual use.
  useEffect(() => {
    if (phase.kind !== "active" || !runtime) return;
    let cancelled = false;
    runtime.guestAuth.getAccessToken().then(
      () => {
        if (!cancelled) notifyParent({ type: "ready" }, phase.parentOrigin);
      },
      (error: unknown) => {
        if (cancelled) return;
        if (isPermissionDenied(error)) {
          notifyParent({ type: "refused" }, phase.parentOrigin);
          setPhase({ kind: "refused" });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [phase, runtime]);

  // Route params resolve synchronously except during the static-export
  // placeholder pass, where window is unavailable — render nothing
  // rather than a flash of the unavailable state. Refused embeds also
  // render nothing: the loader hides the element, and a blank frame is
  // the graceful fallback for hosts that ignore the protocol.
  if (!org || !slug || !runtime) {
    return null;
  }

  return (
    <StigmerProvider
      client={runtime.client}
      colorMode={colorMode}
      preset="monochrome"
    >
      <div className="h-screen bg-background text-foreground">
        <SharedAgentChat org={org} slug={slug} />
      </div>
    </StigmerProvider>
  );
}

/**
 * The page's color mode: the embed loader's explicit `?theme=` choice
 * (resolved once on the host page — see `@stigmer/embed`) wins over the
 * visitor-level `next-themes` preference, so the widget matches the
 * site it is embedded in rather than the visitor's console setting.
 */
function usePageColorMode(): ResolvedColorMode {
  const { resolvedTheme } = useTheme();
  const [themeParam] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("theme");
  });
  if (themeParam === "light" || themeParam === "dark") {
    return themeParam;
  }
  return resolvedTheme === "dark" ? "dark" : "light";
}
