"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, iamRoleDisplayName, iamRoleDescription } from "@stigmer/sdk";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useInvitationPreview } from "./useInvitationPreview.js";
import { useRedeemInvitation } from "./useRedeemInvitation.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Props for {@link InvitationRedemption}. */
export interface InvitationRedemptionProps {
  /** The invitation token from the invite URL. */
  readonly token: string;
  /**
   * Whether the current user is authenticated.
   *
   * Controls the button's click behavior, not its label. Both
   * states show "Accept Invitation". When `false`, clicking
   * fires {@link onAuthRequired} to initiate the auth flow.
   * When `true` or omitted, clicking redeems the invitation
   * directly.
   *
   * @default true
   */
  readonly isAuthenticated?: boolean;
  /**
   * When `true`, automatically triggers invitation redemption
   * on mount (requires `isAuthenticated` to also be `true`).
   *
   * Used by host applications to complete the acceptance flow
   * after an OIDC redirect — the user clicked "Accept Invitation"
   * before the redirect, so no second click should be required.
   *
   * @default false
   */
  readonly autoAccept?: boolean;
  /**
   * Fired after the invitation is successfully redeemed.
   *
   * The returned {@link Invitation} contains the organization and
   * role information needed for post-redemption navigation
   * (e.g. redirecting to the org dashboard).
   */
  readonly onAccepted?: (invitation: Invitation) => void;
  /**
   * Fired when an unauthenticated user clicks "Accept Invitation".
   *
   * The host application controls what happens next — this
   * callback typically triggers a redirect to the OIDC provider
   * with a return URL back to the invite page.
   */
  readonly onAuthRequired?: () => void;
  /** Additional CSS class names for the root container. */
  readonly className?: string;
}

/**
 * Self-contained invite acceptance flow.
 *
 * Fetches the invitation preview by token (public endpoint, no auth
 * required), displays the organization info and role being offered,
 * and provides an accept button that redeems the invitation.
 *
 * Handles all states: loading, invalid (expired / revoked / fully
 * redeemed), authentication required, redemption in flight,
 * success, and error — with appropriate UX for each.
 *
 * The component is auth-agnostic: it delegates authentication
 * decisions to the host application via `isAuthenticated` and
 * `onAuthRequired` props. The button always reads "Accept Invitation"
 * regardless of auth state — `isAuthenticated` only controls whether
 * clicking redeems directly or triggers the auth flow first.
 *
 * When `autoAccept` is `true` and the user is authenticated, the
 * component automatically triggers redemption on mount. This enables
 * a seamless post-OIDC-redirect flow where the user doesn't need
 * to click "Accept Invitation" a second time.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * <InvitationRedemption
 *   token={tokenFromUrl}
 *   onAccepted={(inv) => router.push("/dashboard")}
 * />
 *
 * <InvitationRedemption
 *   token={tokenFromUrl}
 *   isAuthenticated={!!currentUser}
 *   autoAccept={shouldAutoAccept}
 *   onAccepted={(inv) => router.push(`/org/${inv.metadata?.org}`)}
 *   onAuthRequired={() => redirectToLogin()}
 * />
 * ```
 */
export function InvitationRedemption({
  token,
  isAuthenticated = true,
  autoAccept = false,
  onAccepted,
  onAuthRequired,
  className,
}: InvitationRedemptionProps) {
  const { preview, isLoading, error: fetchError, refetch } = useInvitationPreview(token);
  const { redeem, isRedeeming, error: redeemError, clearError } = useRedeemInvitation();
  const [accepted, setAccepted] = useState<Invitation | null>(null);
  const autoAcceptFired = useRef(false);

  const handleAccept = useCallback(async () => {
    clearError();
    try {
      const invitation = await redeem(token);
      setAccepted(invitation);
      onAccepted?.(invitation);
    } catch {
      // error state is managed by useRedeemInvitation
    }
  }, [token, redeem, clearError, onAccepted]);

  useEffect(() => {
    if (
      autoAccept &&
      isAuthenticated &&
      preview?.isValid &&
      !accepted &&
      !isRedeeming &&
      !autoAcceptFired.current
    ) {
      autoAcceptFired.current = true;
      handleAccept();
    }
  }, [autoAccept, isAuthenticated, preview, accepted, isRedeeming, handleAccept]);

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn("stg:mx-auto stg:max-w-sm", className)}
        aria-busy="true"
        aria-label="Loading invitation"
      >
        <LoadingSkeleton />
      </div>
    );
  }

  // Fetch error
  if (fetchError) {
    return (
      <div className={cn("stg:mx-auto stg:max-w-sm", className)}>
        <ErrorCard
          message={getUserMessage(fetchError)}
          onRetry={refetch}
        />
      </div>
    );
  }

  // No preview returned
  if (!preview) {
    return (
      <div className={cn("stg:mx-auto stg:max-w-sm", className)}>
        <ErrorCard message="This invitation could not be found." />
      </div>
    );
  }

  // Redemption success
  if (accepted) {
    const orgName = preview.organizationName || "the organization";
    const roleName = iamRoleDisplayName(preview.role);
    return (
      <div className={cn("stg:mx-auto stg:max-w-sm", className)}>
        <div className="stg:rounded-lg stg:border stg:border-primary/30 stg:bg-primary-subtle stg:p-6 stg:text-center stg:shadow-sm">
          <SuccessIcon />
          <h2 className="stg:mt-3 stg:text-base stg:font-semibold stg:text-foreground">
            You&rsquo;ve joined {orgName}
          </h2>
          <p className="stg:mt-1 stg:text-sm stg:text-muted-foreground">
            You now have <span className="stg:font-medium stg:text-foreground">{roleName}</span> access.
          </p>
        </div>
      </div>
    );
  }

  const orgName = preview.organizationName || "Unknown organization";
  const orgLogo = preview.organizationLogoUrl;
  const orgInitial = orgName.charAt(0).toUpperCase();
  const roleName = iamRoleDisplayName(preview.role);
  const expiresAt = preview.expiresAt ? timestampDate(preview.expiresAt) : null;

  return (
    <div className={cn("stg:mx-auto stg:max-w-sm", className)}>
      <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-6 stg:shadow-sm">
        {/* Org identity */}
        <div className="stg:flex stg:flex-col stg:items-center stg:text-center">
          {orgLogo ? (
            <img
              src={orgLogo}
              alt={`${orgName} logo`}
              className="stg:size-14 stg:rounded-full stg:object-cover"
            />
          ) : (
            <div className="stg:flex stg:size-14 stg:items-center stg:justify-center stg:rounded-full stg:bg-muted stg:text-xl stg:font-semibold stg:text-muted-foreground">
              {orgInitial}
            </div>
          )}

          <h2 className="stg:mt-3 stg:text-base stg:font-semibold stg:text-foreground">
            Join {orgName}
          </h2>

          {preview.label && (
            <p className="stg:mt-1 stg:text-sm stg:italic stg:text-muted-foreground">
              {preview.label}
            </p>
          )}
        </div>

        {/* Role + expiry details */}
        <div className="stg:mt-4 stg:flex stg:flex-col stg:items-center stg:gap-1.5 stg:text-center">
          <span className="stg:inline-flex stg:items-center stg:gap-1.5 stg:rounded-md stg:border stg:border-border stg:bg-muted stg:px-2.5 stg:py-1 stg:text-xs stg:font-medium stg:text-foreground">
            <ShieldIcon />
            {roleName} access
          </span>
          <span className="stg:text-[0.7rem] stg:text-muted-foreground">
            {iamRoleDescription(preview.role)}
          </span>
          {expiresAt && (
            <span className="stg:text-[0.7rem] stg:text-muted-foreground">
              {formatExpiry(expiresAt)}
            </span>
          )}
        </div>

        {/* Invalid state */}
        {!preview.isValid && (
          <InvalidNotice reason={preview.invalidReason} />
        )}

        {/* Action area */}
        {preview.isValid && (
          <div className="stg:mt-5">
            {isAuthenticated ? (
              <>
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={isRedeeming}
                  className={cn(
                    "stg:w-full stg:inline-flex stg:items-center stg:justify-center stg:gap-1.5 stg:rounded-md stg:px-4 stg:py-2.5 stg:text-sm stg:font-medium",
                    "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
                    "stg:disabled:pointer-events-none stg:disabled:opacity-50",
                    "stg:transition-colors",
                  )}
                >
                  {isRedeeming && <SpinnerIcon size={14} />}
                  {isRedeeming ? "Accepting\u2026" : "Accept Invitation"}
                </button>
                {redeemError && (
                  <p className="stg:mt-2 stg:text-center stg:text-[0.65rem] stg:text-destructive" role="alert">
                    {getUserMessage(redeemError)}
                  </p>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={onAuthRequired}
                className={cn(
                  "stg:w-full stg:inline-flex stg:items-center stg:justify-center stg:gap-1.5 stg:rounded-md stg:px-4 stg:py-2.5 stg:text-sm stg:font-medium",
                  "stg:bg-primary stg:text-primary-foreground stg:hover:bg-primary-hover",
                  "stg:transition-colors",
                )}
              >
                Accept Invitation
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// InvalidNotice (internal)
// ---------------------------------------------------------------------------

function InvalidNotice({ reason }: { reason: string }) {
  return (
    <div className="stg:mt-4 stg:rounded-md stg:bg-muted-subtle stg:px-3 stg:py-2.5 stg:text-center">
      <WarningIcon />
      <p className="stg:mt-1 stg:text-xs stg:text-muted-foreground">
        {reason || "This invitation is no longer valid."}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ErrorCard (internal)
// ---------------------------------------------------------------------------

function ErrorCard({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="stg:rounded-lg stg:border stg:border-destructive/30 stg:bg-destructive-subtle stg:p-6 stg:text-center stg:shadow-sm">
      <p className="stg:text-sm stg:text-destructive">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "stg:mt-3 stg:inline-flex stg:items-center stg:rounded-md stg:px-3 stg:py-1.5 stg:text-xs stg:font-medium",
            "stg:text-muted-foreground stg:hover:text-foreground stg:hover:bg-accent-hover",
            "stg:transition-colors",
          )}
        >
          Try again
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoadingSkeleton (internal)
// ---------------------------------------------------------------------------

function LoadingSkeleton() {
  return (
    <div className="stg:rounded-lg stg:border stg:border-border stg:bg-card stg:p-6 stg:shadow-sm stg:space-y-4">
      <div className="stg:flex stg:flex-col stg:items-center stg:gap-3">
        <div className="stg:size-14 stg:rounded-full stg:bg-muted-subtle stg:animate-pulse" />
        <div className="stg:h-5 stg:w-40 stg:rounded stg:bg-muted-subtle stg:animate-pulse" />
        <div className="stg:h-4 stg:w-56 stg:rounded stg:bg-muted-subtle stg:animate-pulse" />
      </div>
      <div className="stg:flex stg:flex-col stg:items-center stg:gap-1.5">
        <div className="stg:h-6 stg:w-28 stg:rounded-md stg:bg-muted-subtle stg:animate-pulse" />
        <div className="stg:h-3 stg:w-44 stg:rounded stg:bg-muted-subtle stg:animate-pulse" />
        <div className="stg:h-3 stg:w-24 stg:rounded stg:bg-muted-subtle stg:animate-pulse" />
      </div>
      <div className="stg:h-[42px] stg:w-full stg:rounded-md stg:bg-muted-subtle stg:animate-pulse" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatExpiry(date: Date): string {
  const now = Date.now();
  const diffMs = date.getTime() - now;

  if (diffMs <= 0) return "Expired";

  const days = Math.ceil(diffMs / 86_400_000);
  if (days === 1) return "Expires tomorrow";
  if (days <= 30) return `Expires in ${days} days`;

  return `Expires ${date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  })}`;
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ShieldIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="stg:shrink-0"
    >
      <path d="M8 1.5l5.5 2v4.5c0 3.5-2.5 5.5-5.5 7-3-1.5-5.5-3.5-5.5-7V3.5L8 1.5z" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="stg:mx-auto stg:text-muted-foreground"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M8 5v3.5M8 10.5v.5" />
    </svg>
  );
}

function SuccessIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="stg:mx-auto stg:text-primary"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l2.5 2.5L16 9" />
    </svg>
  );
}

