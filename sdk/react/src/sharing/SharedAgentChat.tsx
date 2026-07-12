"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { NewSessionViewer } from "../session/NewSessionViewer.js";
import { SessionViewer } from "../session/SessionViewer.js";
import { useSharedAgentProfile } from "./useSharedAgentProfile.js";
import type { SharingAudience } from "./useUpdateAgentSharing.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link SharedAgentChat}. */
export interface SharedAgentChatProps {
  /** Organization slug from the share URL. */
  readonly org: string;
  /** Agent slug from the share URL. */
  readonly slug: string;
  /**
   * Heading above the composer before the first message.
   * Defaults to a prompt built from the agent's name.
   */
  readonly heading?: string;
  /** Placeholder for the composer textarea. */
  readonly placeholder?: string;
  /**
   * Render the "Powered by Stigmer" footer.
   *
   * @default true
   */
  readonly showPoweredBy?: boolean;
  /**
   * Called after the visitor's session and first execution are
   * created — e.g. to reflect the session in the host page's URL.
   */
  readonly onSessionCreated?: (sessionId: string) => void;
  /**
   * Which sharing audience this surface serves. Selects the profile
   * resolution path: `"public"` uses the anonymous `getSharedProfile`
   * RPC (pair with `createGuestAuth`); `"org"` uses the authenticated
   * `getSharedProfileForMember` RPC and requires a `StigmerProvider`
   * whose client carries a signed-in org member's token. The chat
   * presentation is identical either way.
   *
   * @default "public"
   */
  readonly sharingAudience?: SharingAudience;
  /**
   * Share-link token from the URL's `?k=` parameter (public audience
   * only). Required when the share link has been locked with a
   * rotatable token; harmless on plain links. Pair it with the same
   * `linkToken` on `createGuestAuth` so profile resolution and token
   * minting present the same credentialing.
   */
  readonly linkToken?: string;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * The complete shared-agent chat experience for anonymous visitors —
 * the organism behind a shared agent's hosted page and embeds.
 *
 * Resolves the agent's public profile (name, description, icon, and
 * the pinned deployment) via {@link useSharedAgentProfile}, then
 * renders the session organisms with `audience="guest"`: a pure chat
 * surface with no configuration pickers, pinned to the shared agent's
 * default instance so the session binds synchronously on mount.
 *
 * Handles all states: loading, unavailable (the agent does not exist
 * or is not shared — indistinguishable by design), transient errors
 * (with retry), and the live chat.
 *
 * **Auth contract:** requires a `StigmerProvider` whose client can
 * chat with this agent. For public shares (the default), pair with
 * `createGuestAuth({ baseUrl, org, slug })` from `@stigmer/sdk` —
 * the profile fetch is public and sessions use the guest token the
 * provider mints on demand. For org-members-only shares, pass
 * `sharingAudience="org"` and a client carrying the signed-in
 * member's own token; the presentation stays the same pure chat.
 *
 * @example
 * ```tsx
 * const guestAuth = createGuestAuth({ baseUrl, org, slug });
 * const client = useMemo(
 *   () => new Stigmer({ baseUrl, getAccessToken: guestAuth.getAccessToken }),
 *   [guestAuth],
 * );
 *
 * <StigmerProvider client={client} colorMode="system">
 *   <SharedAgentChat org={org} slug={slug} />
 * </StigmerProvider>
 * ```
 */
export function SharedAgentChat({
  org,
  slug,
  heading,
  placeholder,
  showPoweredBy = true,
  onSessionCreated,
  sharingAudience = "public",
  linkToken,
  className,
}: SharedAgentChatProps) {
  const { profile, isLoading, error, refetch } = useSharedAgentProfile(org, slug, {
    audience: sharingAudience,
    linkToken,
  });
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSessionCreated = useCallback(
    (id: string) => {
      setSubmitError(null);
      setSessionId(id);
      onSessionCreated?.(id);
    },
    [onSessionCreated],
  );

  if (isLoading) {
    return (
      <div
        className={cn("flex h-full w-full items-center justify-center", className)}
        aria-busy="true"
        aria-label="Loading agent"
      >
        <LoadingSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn("flex h-full w-full items-center justify-center", className)}>
        <StateCard
          title="Something went wrong"
          message={getUserMessage(error)}
          onRetry={refetch}
        />
      </div>
    );
  }

  // NOT_FOUND covers both "no such agent" and "sharing disabled" — the
  // server keeps them indistinguishable so a revoked link leaks nothing.
  // A profile without a default instance is equally unusable: there is
  // no deployment to chat with, so it presents as the same state.
  if (!profile || !profile.defaultInstanceId) {
    return (
      <div className={cn("flex h-full w-full items-center justify-center", className)}>
        <StateCard
          title="This agent isn't available"
          message="The link may be incorrect, or sharing may have been turned off."
        />
      </div>
    );
  }

  return (
    <div className={cn("flex h-full w-full flex-col", className)}>
      <header className="flex items-center gap-3 border-b border-border px-4 py-3">
        {profile.iconUrl ? (
          <img
            src={profile.iconUrl}
            alt=""
            className="size-8 rounded-md object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-md bg-muted text-sm font-semibold text-muted-foreground"
          >
            {(profile.name || slug).charAt(0).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-foreground">
            {profile.name || slug}
          </h1>
          {profile.description && (
            <p className="truncate text-xs text-muted-foreground">
              {profile.description}
            </p>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1">
        {sessionId ? (
          <SessionViewer
            sessionId={sessionId}
            org={org}
            audience="guest"
            enableGitHub={false}
          />
        ) : (
          <NewSessionViewer
            org={org}
            audience="guest"
            initialAgentRef={{ org, slug }}
            initialInstanceId={profile.defaultInstanceId}
            enableGitHub={false}
            heading={heading ?? `Chat with ${profile.name || slug}`}
            placeholder={placeholder ?? "Ask anything\u2026"}
            onSessionCreated={handleSessionCreated}
            onError={setSubmitError}
            footerContent={
              submitError ? (
                <p
                  role="alert"
                  className="text-center text-xs text-destructive"
                >
                  {submitError}
                </p>
              ) : undefined
            }
          />
        )}
      </div>

      {showPoweredBy && (
        <footer className="border-t border-border px-4 py-2 text-center">
          <a
            href="https://stigmer.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[0.65rem] text-muted-foreground hover:text-foreground transition-colors"
          >
            Powered by Stigmer
          </a>
        </footer>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// State presentation
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="w-full max-w-sm space-y-3 px-6">
      <div className="mx-auto h-8 w-8 animate-pulse rounded-md bg-muted" />
      <div className="mx-auto h-4 w-2/3 animate-pulse rounded bg-muted" />
      <div className="mx-auto h-3 w-1/2 animate-pulse rounded bg-muted" />
    </div>
  );
}

function StateCard({
  title,
  message,
  onRetry,
}: {
  readonly title: string;
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="mx-6 w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center shadow-sm">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "mt-4 inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium",
            "bg-primary text-primary-foreground hover:bg-primary-hover",
            "transition-colors",
          )}
        >
          Try again
        </button>
      )}
    </div>
  );
}
