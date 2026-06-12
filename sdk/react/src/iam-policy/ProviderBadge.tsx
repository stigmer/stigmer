"use client";

import type { ApiResourceRefView } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { cn } from "@stigmer/theme";

/**
 * The human-readable identity-source label for a principal, or `""` when none
 * is known.
 *
 * Email is not an identity key in Stigmer — a person can have a direct account
 * and federated accounts that share one email. This label (e.g. "Stigmer" for
 * direct sign-ups, or an IdentityProvider's display name for federated ones)
 * is what lets the UI tell those accounts apart.
 */
export function providerLabel(principal: ApiResourceRefView | undefined): string {
  return principal?.identityOrigin?.providerDisplayName ?? "";
}

/** Props for {@link ProviderBadge}. */
export interface ProviderBadgeProps {
  /** The principal whose identity source to display. */
  readonly principal: ApiResourceRefView | undefined;
  /** Additional CSS class names. */
  readonly className?: string;
}

/**
 * A subtle pill naming the identity source an account belongs to.
 *
 * Renders nothing when no provider label is available (e.g. legacy accounts
 * with unspecified provisioning mode), so it never adds empty chrome.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function ProviderBadge({ principal, className }: ProviderBadgeProps) {
  const label = providerLabel(principal);
  if (!label) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[0.6rem] font-medium",
        "bg-muted-subtle text-muted-foreground",
        className,
      )}
      title={`Identity provider: ${label}`}
    >
      {label}
    </span>
  );
}
