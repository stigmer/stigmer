"use client";

import { useCallback, useState } from "react";
import { cn } from "@stigmer/theme";
import { getUserMessage, iamRoleDisplayName, iamRoleDescription } from "@stigmer/sdk";
import type { Invitation } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/api_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useInvitationPreview } from "./useInvitationPreview";
import { useRedeemInvitation } from "./useRedeemInvitation";

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
   * When `false`, the component shows a "Sign in to accept" CTA
   * instead of the accept button. When `true` or omitted, the
   * accept button calls `redeem` directly.
   *
   * @default true
   */
  readonly isAuthenticated?: boolean;
  /**
   * Fired after the invitation is successfully redeemed.
   *
   * The returned {@link Invitation} contains the organization and
   * role information needed for post-redemption navigation
   * (e.g. redirecting to the org dashboard).
   */
  readonly onAccepted?: (invitation: Invitation) => void;
  /**
   * Fired when an unauthenticated user clicks "Sign in to accept".
   *
   * The host application controls what "sign in" means — this
   * callback typically triggers a redirect to the login page with
   * a return URL back to the invite page.
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
 * `onAuthRequired` props. Platform builders who render this
 * component only for authenticated users can ignore both props.
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
 *   onAccepted={(inv) => router.push(`/org/${inv.metadata?.org}`)}
 *   onAuthRequired={() => router.push(`/login?return=/invite/${token}`)}
 * />
 * ```
 */
export function InvitationRedemption({
  token,
  isAuthenticated = true,
  onAccepted,
  onAuthRequired,
  className,
}: InvitationRedemptionProps) {
  const { preview, isLoading, error: fetchError, refetch } = useInvitationPreview(token);
  const { redeem, isRedeeming, error: redeemError, clearError } = useRedeemInvitation();
  const [accepted, setAccepted] = useState<Invitation | null>(null);

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

  // Loading state
  if (isLoading) {
    return (
      <div
        className={cn("mx-auto max-w-sm", className)}
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
      <div className={cn("mx-auto max-w-sm", className)}>
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
      <div className={cn("mx-auto max-w-sm", className)}>
        <ErrorCard message="This invitation could not be found." />
      </div>
    );
  }

  // Redemption success
  if (accepted) {
    const orgName = preview.organizationName || "the organization";
    const roleName = iamRoleDisplayName(preview.role);
    return (
      <div className={cn("mx-auto max-w-sm", className)}>
        <div className="rounded-lg border border-primary/30 bg-primary-subtle p-6 text-center shadow-sm">
          <SuccessIcon />
          <h2 className="mt-3 text-base font-semibold text-foreground">
            You&rsquo;ve joined {orgName}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            You now have <span className="font-medium text-foreground">{roleName}</span> access.
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
    <div className={cn("mx-auto max-w-sm", className)}>
      <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
        {/* Org identity */}
        <div className="flex flex-col items-center text-center">
          {orgLogo ? (
            <img
              src={orgLogo}
              alt={`${orgName} logo`}
              className="size-14 rounded-full object-cover"
            />
          ) : (
            <div className="flex size-14 items-center justify-center rounded-full bg-muted text-xl font-semibold text-muted-foreground">
              {orgInitial}
            </div>
          )}

          <h2 className="mt-3 text-base font-semibold text-foreground">
            Join {orgName}
          </h2>

          {preview.label && (
            <p className="mt-1 text-sm italic text-muted-foreground">
              {preview.label}
            </p>
          )}
        </div>

        {/* Role + expiry details */}
        <div className="mt-4 flex flex-col items-center gap-1.5 text-center">
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted px-2.5 py-1 text-xs font-medium text-foreground">
            <ShieldIcon />
            {roleName} access
          </span>
          <span className="text-[0.7rem] text-muted-foreground">
            {iamRoleDescription(preview.role)}
          </span>
          {expiresAt && (
            <span className="text-[0.7rem] text-muted-foreground">
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
          <div className="mt-5">
            {isAuthenticated ? (
              <>
                <button
                  type="button"
                  onClick={handleAccept}
                  disabled={isRedeeming}
                  className={cn(
                    "w-full inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2.5 text-sm font-medium",
                    "bg-primary text-primary-foreground hover:bg-primary-hover",
                    "disabled:pointer-events-none disabled:opacity-50",
                    "transition-colors",
                  )}
                >
                  {isRedeeming && <SpinnerIcon />}
                  {isRedeeming ? "Accepting\u2026" : "Accept Invitation"}
                </button>
                {redeemError && (
                  <p className="mt-2 text-center text-[0.65rem] text-destructive" role="alert">
                    {getUserMessage(redeemError)}
                  </p>
                )}
              </>
            ) : (
              <button
                type="button"
                onClick={onAuthRequired}
                className={cn(
                  "w-full inline-flex items-center justify-center gap-1.5 rounded-md px-4 py-2.5 text-sm font-medium",
                  "bg-primary text-primary-foreground hover:bg-primary-hover",
                  "transition-colors",
                )}
              >
                Sign in to accept
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
    <div className="mt-4 rounded-md bg-muted-subtle px-3 py-2.5 text-center">
      <WarningIcon />
      <p className="mt-1 text-xs text-muted-foreground">
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
    <div className="rounded-lg border border-destructive/30 bg-destructive-subtle p-6 text-center shadow-sm">
      <p className="text-sm text-destructive">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "mt-3 inline-flex items-center rounded-md px-3 py-1.5 text-xs font-medium",
            "text-muted-foreground hover:text-foreground hover:bg-accent-hover",
            "transition-colors",
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
    <div className="rounded-lg border border-border bg-card p-6 shadow-sm space-y-4">
      <div className="flex flex-col items-center gap-3">
        <div className="size-14 rounded-full bg-muted-subtle animate-pulse" />
        <div className="h-5 w-40 rounded bg-muted-subtle animate-pulse" />
        <div className="h-4 w-56 rounded bg-muted-subtle animate-pulse" />
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <div className="h-6 w-28 rounded-md bg-muted-subtle animate-pulse" />
        <div className="h-3 w-44 rounded bg-muted-subtle animate-pulse" />
        <div className="h-3 w-24 rounded bg-muted-subtle animate-pulse" />
      </div>
      <div className="h-[42px] w-full rounded-md bg-muted-subtle animate-pulse" />
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
      className="shrink-0"
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
      className="mx-auto text-muted-foreground"
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
      className="mx-auto text-primary"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 12l2.5 2.5L16 9" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="animate-spin"
      aria-hidden="true"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  );
}
