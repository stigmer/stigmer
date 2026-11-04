"use client";

/**
 * OrgSlugText: an organization's slug as text, given the id a stored
 * resource names it by. For places that render an org per row (a table
 * column, a card) and cannot call a hook in a plain render callback.
 */
import { useOrgSlugForId } from "./useOrgRefs.js";

/** Props for {@link OrgSlugText}. */
export interface OrgSlugTextProps {
  /** The organization's id, as a stored `metadata.org` carries it. */
  readonly orgId: string;
  /** Additional CSS class names for the text span. */
  readonly className?: string;
}

/**
 * Renders the slug of the organization `orgId` names when it is one of the
 * person's organizations, and the id itself otherwise.
 *
 * @example
 * ```tsx
 * // A stored `metadata.org` is an id; the cell reads the organization's slug.
 * <OrgSlugText orgId="org_01jabc" />
 * ```
 */
export function OrgSlugText({ orgId, className }: OrgSlugTextProps) {
  const slugForOrg = useOrgSlugForId();
  return <span className={className}>{slugForOrg(orgId)}</span>;
}
