"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage } from "@stigmer/sdk";
import { NewSessionViewer } from "../session/NewSessionViewer.js";
import { SessionViewer } from "../session/SessionViewer.js";
import { useSharedAgentProfile } from "./useSharedAgentProfile.js";
import type { SharingAudience } from "./useSaveAgentShare.js";

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
        className={cn("stg:flex stg:h-full stg:w-full stg:items-center stg:justify-center", className)}
        aria-busy="true"
        aria-label="Loading agent"
      >
        <LoadingSkeleton />
      </div>
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
  // A profile without a default instance is equally unusable: there is
  // no deployment to chat with, so it presents as the same state.
  if (!profile || !profile.defaultInstanceId) {
    return (
      <div className={cn("stg:flex stg:h-full stg:w-full stg:items-center stg:justify-center", className)}>
        <StateCard
          title="This agent isn't available"
          message="The link may be incorrect, or sharing may have been turned off."
        />
      </div>
    );
  }

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
