"use client";

import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { create } from "@bufbuild/protobuf";
import { GetSharedProfileRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import {
  LINK_TOKEN_PARAM,
  Stigmer,
  createGuestAuth,
  isNotFound,
  isPermissionDenied,
} from "@stigmer/sdk";
import { isEmbedded, notifyParent, resolveParentOrigin } from "@stigmer/embed";
import { StigmerProvider, SharedAgentChat } from "@stigmer/react";
import type { ResolvedColorMode } from "@stigmer/react";
import { useAuth } from "@/auth";
import { getApiBaseUrl } from "@/config/env";
import { useStaticRouteParam } from "@/domain/_shared/hooks/useStaticRouteParam";

/**
 * Hosted chat page for a shared agent —
 * `/chat/<org>/<slug>`, the URL behind an agent's Share toggle and the
 * page the `<stigmer-agent>` embed widget frames.
 *
 * Renders on an auth-OPTIONAL route (see `Providers.tsx`
 * AUTH_OPTIONAL_ROUTES): `useAuth()` works and login can be triggered on
 * demand, but nothing forces anonymous visitors to sign in. The page is
 * a thin shell — everything of substance lives in the SDK:
 *
 * - `createGuestAuth` (`@stigmer/sdk`) mints short-lived guest JWTs via
 *   the public, credential-free `mintGuestToken` RPC and keeps the
 *   visitor's identity stable across visits (localStorage guest id).
 * - `@stigmer/embed` owns the embed protocol: when the page runs inside
 *   an iframe it discovers the embedding page's origin from
 *   browser-authentic sources and reports `ready`/`refused` to the
 *   loader.
 * - `SharedAgentChat` (`@stigmer/react`) resolves the profile and
 *   renders the pure-chat surface, including the unavailable state.
 *
 * Audience routing (standalone page): the page probes the anonymous
 * `getSharedProfile` once. A hit means a public share — the current
 * guest flow, zero login. A NOT_FOUND is deliberately ambiguous (no such
 * agent, unshared, org-members-only, or a token-locked link without its
 * `?k=` token), so the page offers "sign in if you have access": a
 * signed-in member's `SharedAgentChat sharingAudience="org"` resolves
 * through the authenticated `getSharedProfileForMember` and chats with
 * the member's own token — membership is re-checked server-side on
 * every turn.
 *
 * Locked links: when the share URL carries `?k=<token>` (an owner reset
 * the link), the token rides the probe, the guest mint, and the profile
 * fetch. The server validates it everywhere; the page just forwards it.
 *
 * Embedded flow (public shares only — org shares refuse the guest mint):
 * the discovered parent origin rides the mint request, where the server
 * validates it against the share's `allowed_origins` and stamps it into
 * the guest JWT. The mint is eager (unlike the standalone page's lazy
 * first-RPC mint) so a disallowed or unavailable embed hides before the
 * visitor types anything, instead of failing on their first message.
 */

/** Where the page is in the embed lifecycle. Standalone pages skip it entirely. */
type EmbedPhase =
  | { readonly kind: "standalone" }
  | { readonly kind: "resolving" }
  | { readonly kind: "active"; readonly parentOrigin: string }
  | { readonly kind: "refused" };

/**
 * Which access path the standalone page serves. Embeds are always
 * `guest`. `member` covers both "signed-in member chatting" and
 * "anonymous visitor being offered sign-in" — the render branches on
 * the live auth state.
 */
type AccessPath = "probing" | "guest" | "member";

export default function SharedAgentChatPage() {
  const org = useStaticRouteParam("org", 2);
  const slug = useStaticRouteParam("slug", 1);
  const linkToken = useLinkTokenParam();
  const colorMode = usePageColorMode();
  const auth = useAuth();

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

  // Standalone audience probe: one anonymous getSharedProfile decides
  // guest vs member. Embeds skip it — they are public-audience only.
  const [accessPath, setAccessPath] = useState<AccessPath>("probing");
  useEffect(() => {
    if (phase.kind !== "standalone" || !org || !slug) return;
    let cancelled = false;
    const anon = new Stigmer({
      baseUrl: getApiBaseUrl(),
      getAccessToken: () => null,
    });
    anon.agentShare
      .getSharedProfile(
        create(GetSharedProfileRequestSchema, { org, slug, linkToken }),
      )
      .then(
        () => {
          if (!cancelled) setAccessPath("guest");
        },
        (error: unknown) => {
          if (cancelled) return;
          // NOT_FOUND is deliberately ambiguous server-side (missing,
          // unshared, org-members-only, or a locked link without its
          // token); the member path resolves it for anyone with access.
          // Transient errors take the guest path so SharedAgentChat's
          // retry surface handles them.
          setAccessPath(isNotFound(error) ? "member" : "guest");
        },
      );
    return () => {
      cancelled = true;
    };
  }, [phase.kind, org, slug, linkToken]);

  // One guest-auth manager + client per resolved org/slug (+ embed
  // context). Standalone pages mint lazily on the first RPC, so nothing
  // happens on the network until the page actually renders the chat.
  const guestRuntime = useMemo(() => {
    if (!org || !slug) return null;
    if (phase.kind === "resolving" || phase.kind === "refused") return null;
    const baseUrl = getApiBaseUrl();
    const guestAuth = createGuestAuth({
      baseUrl,
      org,
      slug,
      // Required on locked links; harmless (ignored server-side) on plain ones.
      ...(linkToken ? { linkToken } : {}),
      // Absent on the standalone page — the server's absence-means-exempt
      // rule is what keeps the hosted link anyone-with-link.
      ...(phase.kind === "active" ? { embedOrigin: phase.parentOrigin } : {}),
    });
    const client = new Stigmer({
      baseUrl,
      getAccessToken: guestAuth.getAccessToken,
    });
    return { client, guestAuth };
  }, [org, slug, linkToken, phase]);

  // The member client carries the signed-in member's own token. Rebuilt
  // on token renewal, mirroring StigmerTransportBridge on authenticated
  // routes, so long chats keep streaming across silent renews.
  const memberClient = useMemo(() => {
    if (!auth.accessToken && auth.isLoading) return null;
    const token = auth.accessToken;
    return new Stigmer({
      baseUrl: getApiBaseUrl(),
      getAccessToken: () => token,
    });
  }, [auth.accessToken, auth.isLoading]);

  // Embedded pages mint eagerly: a refusal must hide the widget before
  // the visitor invests in it. PERMISSION_DENIED is an origin refusal;
  // NOT_FOUND means no publicly shared agent lives at this address
  // (missing, revoked, or org-members-only — embeds cannot serve any of
  // them). Any other failure (network blip, editions without guest
  // minting) keeps the widget up and lets the lazy error paths surface
  // it on actual use.
  useEffect(() => {
    if (phase.kind !== "active" || !guestRuntime) return;
    let cancelled = false;
    guestRuntime.guestAuth.getAccessToken().then(
      () => {
        if (!cancelled) notifyParent({ type: "ready" }, phase.parentOrigin);
      },
      (error: unknown) => {
        if (cancelled) return;
        if (isPermissionDenied(error) || isNotFound(error)) {
          notifyParent({ type: "refused" }, phase.parentOrigin);
          setPhase({ kind: "refused" });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [phase, guestRuntime]);

  // Route params resolve synchronously except during the static-export
  // placeholder pass, where window is unavailable — render nothing
  // rather than a flash of the unavailable state. Refused embeds also
  // render nothing: the loader hides the element, and a blank frame is
  // the graceful fallback for hosts that ignore the protocol.
  if (!org || !slug || !guestRuntime) {
    return null;
  }

  // Standalone member branch: the anonymous probe found nothing public.
  if (phase.kind === "standalone" && accessPath === "member") {
    if (auth.isLoading || !memberClient) {
      return null;
    }
    if (!auth.isAuthenticated) {
      return (
        <StigmerProvider
          client={guestRuntime.client}
          colorMode={colorMode}
          preset="monochrome"
        >
          <div className="h-screen bg-background text-foreground">
            <SignInIfYouHaveAccess onSignIn={auth.login} />
          </div>
        </StigmerProvider>
      );
    }
    return (
      <StigmerProvider
        client={memberClient}
        colorMode={colorMode}
        preset="monochrome"
      >
        <div className="h-screen bg-background text-foreground">
          <SharedAgentChat org={org} slug={slug} sharingAudience="org" />
        </div>
      </StigmerProvider>
    );
  }

  // Guest branch: public shares (and embeds). While the standalone probe
  // is still in flight, SharedAgentChat's own loading skeleton covers it —
  // its profile fetch races the probe harmlessly (both are the same RPC).
  if (phase.kind === "standalone" && accessPath === "probing") {
    return null;
  }

  return (
    <StigmerProvider
      client={guestRuntime.client}
      colorMode={colorMode}
      preset="monochrome"
    >
      <div className="h-screen bg-background text-foreground">
        <SharedAgentChat org={org} slug={slug} linkToken={linkToken} />
      </div>
    </StigmerProvider>
  );
}

/**
 * The share-link token from the URL's `?k=` parameter, or empty for plain
 * links. Read once on mount (like the theme param): the token is part of
 * the link's identity, and a mid-session change is not a supported flow.
 */
function useLinkTokenParam(): string {
  const [linkToken] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    return (
      new URLSearchParams(window.location.search).get(LINK_TOKEN_PARAM) ?? ""
    );
  });
  return linkToken;
}

/**
 * The anonymous face of an org-members-only (or nonexistent) share: a
 * generic not-found surface with a sign-in affordance — the GitHub
 * private-repo pattern. It must not reveal whether the agent exists;
 * signing in and retrying is the only way to learn more, and only for
 * actual members.
 */
function SignInIfYouHaveAccess({ onSignIn }: { readonly onSignIn: () => void }) {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="mx-6 w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center shadow-sm">
        <h2 className="text-base font-semibold text-foreground">
          This agent isn&apos;t available
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The link may be incorrect, sharing may have been turned off, or the
          agent may be restricted to members of its organization.
        </p>
        <button
          type="button"
          onClick={onSignIn}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
        >
          Sign in if you have access
        </button>
      </div>
    </div>
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
