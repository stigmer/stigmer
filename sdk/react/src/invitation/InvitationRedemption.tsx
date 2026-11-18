"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getUserMessage, grantableRoleDescription, iamRoleDisplayName } from "@stigmer/client";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import type { Invitation } from "@stigmer/apis/ai/stigmer/iam/invitation/v1/api_pb";
import { timestampDate } from "@bufbuild/protobuf/wkt";
import { useInvitationPreview } from "./useInvitationPreview.js";
import { useRedeemInvitation } from "./useRedeemInvitation.js";
import { SpinnerIcon } from "../internal/SpinnerIcon.js";
import { Button } from "../button/Button.js";
import { ErrorMessage } from "../error/ErrorMessage.js";
import { Tag } from "../internal/surface/Tag.js";
import { ScreenWait } from "../standalone-screen/StandaloneScreen.js";
import { ScreenColumn, type ScreenColumnProps } from "../internal/ScreenColumn.js";

// ---------------------------------------------------------------------------
// The invited person's line
// ---------------------------------------------------------------------------

/**
 * What the invited person can do once they join, in their own words, one
 * line per role an invitation can carry. The access lists' descriptions
 * (`grantableRoleDescription`) are written about "them" for whoever picks a
 * role; the invitation speaks to the person it invites. A role without a
 * line here reads its description.
 */
const INVITED_ROLE_LINES: Partial<Record<IamRole, string>> = {
  [IamRole.owner]: "As an owner you can do everything, including deleting the organization and choosing its owners.",
  [IamRole.admin]: "As an admin you can manage the organization's people, settings, billing, agents and tools.",
  [IamRole.member]: "As a member you can use the organization's agents and start your own conversations.",
  [IamRole.viewer]: "As a viewer you can see what's shared with the organization, but not start conversations.",
};

function invitedRoleLine(role: IamRole): string {
  return INVITED_ROLE_LINES[role] ?? grantableRoleDescription(ApiResourceKind.organization, role);
}

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
   * When `true` or omitted, the button reads "Accept invitation" and
   * redeems the invitation directly. When `false`, it fires
   * {@link onAuthRequired} to initiate the auth flow, under the same
   * words, or, when the host passes {@link onSignUp}, the visitor is
   * offered a new account first and sign-in second.
   *
   * @default true
   */
  readonly isAuthenticated?: boolean;
  /**
   * When `true`, automatically triggers invitation redemption
   * on mount (requires `isAuthenticated` to also be `true`).
   *
   * Used by host applications to complete the acceptance flow
   * after an OIDC redirect — the user clicked "Accept invitation"
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
   * Fired when an unauthenticated user asks to sign in: "Accept
   * invitation", or "I already have an account" when
   * {@link onSignUp} is passed.
   *
   * The host application controls what happens next — this
   * callback typically triggers a redirect to the OIDC provider
   * with a return URL back to the invite page.
   */
  readonly onAuthRequired?: () => void;
  /**
   * Fired when an unauthenticated user asks to make an account:
   * "Create your account and join".
   *
   * Someone arriving through an invite link is most often new, so
   * when the host passes this, a signed-out visitor is offered a new
   * account first ("Create your account and join") and sign-in second,
   * as a quieter "I already have an account" that fires
   * {@link onAuthRequired}. Without it, the visitor sees one "Accept
   * invitation" button that fires {@link onAuthRequired}. Pass it only
   * when the host can open its identity provider's sign-up screen; the
   * callback typically redirects there with a return URL back to the
   * invite page. Ignored for a signed-in visitor.
   */
  readonly onSignUp?: () => void;
  /**
   * The level of its title: 1 when the invitation is the page (the
   * console's invite page), 2 (the default) when it sits under a page's
   * own heading.
   *
   * @default 2
   */
  readonly headingLevel?: 1 | 2;
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
 * decisions to the host application via `isAuthenticated`,
 * `onAuthRequired` and `onSignUp` props. A signed-in visitor sees
 * "Accept invitation", which redeems directly. A signed-out visitor
 * sees the same button, which starts the host's sign-in, or, when the
 * host passes `onSignUp`, "Create your account and join" first and a
 * quieter "I already have an account" under it.
 *
 * When `autoAccept` is `true` and the user is authenticated, the
 * component automatically triggers redemption on mount. This enables
 * a seamless post-OIDC-redirect flow where the user doesn't need
 * to click "Accept invitation" a second time.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 *
 * @example
 * ```tsx
 * type JoinPageProps = {
 *   token: string;
 *   signedIn: boolean;
 *   onOpen: (href: string) => void;
 *   onSignIn: () => void;
 *   onSignUp: () => void;
 * };
 *
 * function JoinPage({ token, signedIn, onOpen, onSignIn, onSignUp }: JoinPageProps) {
 *   return (
 *     <InvitationRedemption
 *       token={token}
 *       isAuthenticated={signedIn}
 *       onAccepted={(invitation) => onOpen(`/org/${invitation.metadata?.org}`)}
 *       onAuthRequired={onSignIn}
 *       onSignUp={onSignUp}
 *     />
 *   );
 * }
 * ```
 */
export function InvitationRedemption({
  token,
  isAuthenticated = true,
  autoAccept = false,
  onAccepted,
  onAuthRequired,
  onSignUp,
  headingLevel = 2,
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

  const column = (body: ScreenColumnProps) => <ScreenColumn {...body} headingLevel={headingLevel} className={className} />;

  if (isLoading) {
    return (
      <ScreenColumn className={className}>
        <ScreenWait>Opening your invitation…</ScreenWait>
      </ScreenColumn>
    );
  }

  if (fetchError) {
    return (
      <ScreenColumn className={className}>
        <ErrorMessage
          error={fetchError}
          title="Stigmer couldn't open the invitation."
          comfort="The invitation itself is unaffected."
          retry={refetch}
        />
      </ScreenColumn>
    );
  }

  if (!preview) {
    return column({
      title: "This invitation isn't here",
      lead: "It may have been withdrawn, or the link was copied in part. Ask whoever sent it for a new link.",
    });
  }

  const orgName = preview.orgName || "the organization";
  const roleName = iamRoleDisplayName(preview.role);

  if (accepted) {
    return column({
      title: `You've joined ${orgName}`,
      lead: `You have ${roleName} access. Taking you there…`,
      children: <ScreenWait />,
    });
  }

  if (!preview.isValid) {
    return column({
      // The server words its reason as a sentence; as a title it drops the full stop.
      title: preview.invalidReason.replace(/\.$/, "") || "This invitation is no longer valid",
      lead: "Ask whoever sent it for a new link.",
    });
  }

  const expiresAt = preview.expiresAt ? timestampDate(preview.expiresAt) : null;

  return column({
    title: `Join ${orgName}`,
    lead: invitedRoleLine(preview.role),
    meta: (
      <>
        <span className="stg:flex stg:flex-wrap stg:items-center stg:justify-center stg:gap-x-2 stg:gap-y-1">
          <Tag>{roleName} access</Tag>
          {expiresAt && <span>{formatExpiry(expiresAt)}</span>}
        </span>
        {preview.label && <span>{preview.label}</span>}
      </>
    ),
    children:
      isAuthenticated && redeemError ? (
        <ErrorMessage
          error={redeemError}
          title="Stigmer couldn't accept the invitation."
          comfort="The invitation is still good."
        />
      ) : undefined,
    acts: isAuthenticated ? (
      <Button
        onClick={handleAccept}
        disabled={isRedeeming}
        aria-busy={isRedeeming}
        icon={isRedeeming ? <SpinnerIcon size={14} /> : undefined}
      >
        {isRedeeming ? "Accepting\u2026" : "Accept invitation"}
      </Button>
    ) : onSignUp ? (
      <>
        <Button onClick={onSignUp}>Create your account and join</Button>
        <Button variant="ghost" onClick={onAuthRequired}>
          I already have an account
        </Button>
      </>
    ) : (
      <Button onClick={onAuthRequired}>Accept invitation</Button>
    ),
  });
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
