"use client";

import type { ApiResourceRefView } from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { cn } from "@stigmer/design-tokens";
import { Tooltip, TooltipContent, TooltipTrigger } from "../internal/tooltip.js";
import { tagClasses } from "../internal/surface/Tag.js";

/**
 * The human-readable identity-source label for a principal, or `""` when none
 * is known.
 *
 * Email is not an identity key in Stigmer — a person can have a direct account
 * and federated accounts that share one email. This label (e.g. "Stigmer" for
 * direct sign-ups, or a FederationIssuer's display name for federated ones)
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
 * A neutral tag naming the identity source an account belongs to.
 *
 * Renders nothing when no provider label is available (an account whose
 * provisioning mode names no provider), so it never adds empty chrome.
 *
 * All visual properties flow through `--stgm-*` design tokens.
 */
export function ProviderBadge({ principal, className }: ProviderBadgeProps) {
  const label = providerLabel(principal);
  if (!label) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className={cn(tagClasses(), className)} />
        }
      >
        {label}
      </TooltipTrigger>
      <TooltipContent side="top">{`Identity provider: ${label}`}</TooltipContent>
    </Tooltip>
  );
}
