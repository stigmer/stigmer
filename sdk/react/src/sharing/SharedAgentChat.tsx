"use client";

import { useCallback, useMemo, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, type ResourceRef } from "@stigmer/sdk";
import type { SharedAgentProfile } from "@stigmer/protos/ai/stigmer/agentic/agentshare/v1/io_pb";
import { NewSessionViewer } from "../session/NewSessionViewer.js";
import { SessionViewer } from "../session/SessionViewer.js";
import { useSharedAgentProfile } from "./useSharedAgentProfile.js";
import type { SharingAudience } from "./useSaveAgentShare.js";
import { LoadingRegion } from "../internal/LoadingRegion.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link SharedAgentChat}. */
export interface SharedAgentChatProps {
  /**
   * Id of the share, from the hosted chat link (`/chat/<share id>`). The
   * share's organization and slug come from its resolved profile.
   */
  readonly shareId: string;
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
   * Called after the visitor's session and first run are
   * created — e.g. to reflect the session in the host page's URL.
   */
  readonly onSessionCreated?: (sessionId: string) => void;
  /**
   * Which sharing audience this surface serves. Selects the profile
   * resolution path: `"public"` uses the anonymous `getSharedProfile`
   * RPC (pair with `createGuestAuth`); `"org"` uses the authenticated
   * `getSharedProfileForMember` RPC and requires a `StigmerProvider`
   * whose client carries a signed-in org member's token. The chat
   * presentation is identical either way; what differs is whose keys the
   * conversation reads: a member is a person on their own token, so their
   * conversation includes their own My vault, while a public visitor
   * brings none and the share's vaults are all its runs use.
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
 * the share's agent reference) via {@link useSharedAgentProfile}, then
 * renders the session organisms with `audience="guest"`: a pure chat
 * surface with no configuration pickers, pinned to the share's agent
 * reference exactly as the profile gives it, version included, so the
 * session binds synchronously on mount and runs the version the share
 * names.
 *
 * Handles all states: loading, unavailable (the agent does not exist
 * or is not shared — indistinguishable by design), transient errors
 * (with retry), and the live chat.
 *
 * **Auth contract:** requires a `StigmerProvider` whose client can
 * chat with this agent. For public shares (the default), pair with
 * `createGuestAuth({ baseUrl, shareId })` from `@stigmer/sdk` —
 * the profile fetch is public and sessions use the guest token the
 * provider mints on demand. For org-members-only shares, pass
 * `sharingAudience="org"` and a client carrying the signed-in
 * member's own token; the presentation stays the same pure chat.
 *
 * @example
 * ```tsx
 * const guestAuth = createGuestAuth({ baseUrl, shareId });
 * const client = useMemo(
 *   () => new Stigmer({ baseUrl, getAccessToken: guestAuth.getAccessToken }),
 *   [guestAuth],
 * );
 *
 * <StigmerProvider client={client} colorMode="system">
 *   <SharedAgentChat shareId={shareId} />
 * </StigmerProvider>
 * ```
 */
export function SharedAgentChat({
  shareId,
  heading,
  placeholder,
  showPoweredBy = true,
  onSessionCreated,
  sharingAudience = "public",
  linkToken,
  className,
}: SharedAgentChatProps) {
  const { profile, isLoading, error, refetch } = useSharedAgentProfile(shareId, {
    audience: sharingAudience,
    linkToken,
  });
  // Memoized so the launcher's mount-time pin sees one stable reference.
  const agentRef = useMemo(
    () => (profile ? shareAgentRef(profile) : null),
    [profile],
  );
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
      <LoadingRegion
        className={cn("stg:flex stg:h-full stg:w-full stg:items-center stg:justify-center", className)}
        label="Loading agent"
      >
        <LoadingSkeleton />
      </LoadingRegion>
    );
  }

  if (error) {
    return (
      <div className={cn("stg:flex stg:h-full stg:w-full stg:items-center stg:justify-center", className)}>
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
  // A profile that names no agent is equally unusable: there is nothing
  // to chat with, so it presents as the same state.
  if (!profile || !agentRef) {
    return (
      <div className={cn("stg:flex stg:h-full stg:w-full stg:items-center stg:justify-center", className)}>
        <StateCard
          title="This agent isn't available"
          message="The link may be incorrect, or sharing may have been turned off."
        />
      </div>
    );
  }

  // The visitor's session lives in the share's organization, which the
  // profile names; the link itself names only the share.
  const { org, slug } = profile;

  return (
    <div className={cn("stg:flex stg:h-full stg:w-full stg:flex-col", className)}>
      <header className="stg:flex stg:items-center stg:gap-3 stg:border-b stg:border-border stg:px-4 stg:py-3">
        {profile.iconUrl ? (
          <img
            src={profile.iconUrl}
            alt=""
            className="stg:size-8 stg:rounded-md stg:object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="stg:flex stg:size-8 stg:items-center stg:justify-center stg:rounded-md stg:bg-muted stg:text-sm stg:font-semibold stg:text-muted-foreground"
          >
            {(profile.name || slug).charAt(0).toUpperCase()}
          </div>
        )}
        <div className="stg:min-w-0">
          <h1 className="stg:truncate stg:text-sm stg:font-semibold stg:text-foreground">
            {profile.name || slug}
          </h1>
          {profile.description && (
            <p className="stg:truncate stg:text-xs stg:text-muted-foreground">
              {profile.description}
            </p>
          )}
        </div>
      </header>

      <div className="stg:min-h-0 stg:flex-1">
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
            includeMyVault={sharingAudience === "org"}
            initialAgentRef={agentRef}
            enableGitHub={false}
            heading={heading ?? `Chat with ${profile.name || slug}`}
            placeholder={placeholder ?? "Ask anything\u2026"}
            onSessionCreated={handleSessionCreated}
            onError={setSubmitError}
            footerContent={
              submitError ? (
                <p
                  role="alert"
                  className="stg:text-center stg:text-xs stg:text-destructive"
                >
                  {submitError}
                </p>
              ) : undefined
            }
          />
        )}
      </div>

      {showPoweredBy && (
        <footer className="stg:border-t stg:border-border stg:px-4 stg:py-2 stg:text-center">
          <a
            href="https://stigmer.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="stg:text-[0.65rem] stg:text-muted-foreground stg:hover:text-foreground stg:transition-colors"
          >
            Powered by Stigmer
          </a>
        </footer>
      )}
    </div>
  );
}

/**
 * The share's agent reference as the session flow takes it: organization,
 * slug and version copied as the profile gives them (the edition's guest
 * gate admits a session only on the share's own reference), or `null`
 * when the profile names no agent.
 */
function shareAgentRef(profile: SharedAgentProfile): ResourceRef | null {
  const ref = profile.agentRef;
  if (ref === undefined || ref.slug === "") return null;
  return {
    org: ref.org,
    slug: ref.slug,
    ...(ref.version !== "" && { version: ref.version }),
    kind: ref.kind,
  };
}

// ---------------------------------------------------------------------------
// State presentation
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="stg:w-full stg:max-w-sm stg:space-y-3 stg:px-6">
      <div className="stg:mx-auto stg:h-8 stg:w-8 stg:animate-pulse stg:rounded-md stg:bg-muted" />
      <div className="stg:mx-auto stg:h-4 stg:w-2/3 stg:animate-pulse stg:rounded stg:bg-muted" />
      <div className="stg:mx-auto stg:h-3 stg:w-1/2 stg:animate-pulse stg:rounded stg:bg-muted" />
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
    <div className="stg:mx-6 stg:w-full stg:max-w-sm stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-6 stg:text-center stg:shadow-sm">
      <h2 className="stg:text-base stg:font-semibold stg:text-foreground">{title}</h2>
      <p className="stg:mt-1 stg:text-sm stg:text-muted-foreground">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "stg:mt-4 stg:inline-flex stg:items-center stg:justify-center stg:rounded-md stg:px-4 stg:py-2 stg:text-sm stg:font-medium",
            "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
            "stg:transition-colors",
          )}
        >
          Try again
        </button>
      )}
    </div>
  );
}
