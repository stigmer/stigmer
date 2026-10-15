"use client";

/**
 * Translating between an organization's two names: its id, which never
 * changes and which every request and stored resource carries, and its
 * slug, which a person reads and which console URLs put in their org
 * segment.
 *
 * Both hooks answer from the person's organizations (the list
 * {@link OrgProvider} loaded) and the one they have open (a child
 * organization its parent's admin opened, which that list does not hold),
 * and hand back their input unchanged for any other organization, or when
 * no provider is mounted: the server accepts a
 * slug or an id wherever an org is named, so an unmapped value still
 * works, it just reads less well. Ids and slugs are opaque, each unique;
 * an older organization's id equals its slug.
 */
import { useCallback } from "react";
import { findOrgByRef, useKnownOrgs } from "./OrgProvider.js";

/**
 * Returns a function answering the slug of the organization an id names,
 * for display text and URL segments.
 *
 * The answer is the org's current slug when it is one of the person's
 * organizations or the one they have open, and the id unchanged otherwise.
 *
 * @example
 * ```tsx
 * const slugForOrg = useOrgSlugForId();
 * navigate(`/library/agents/${slugForOrg(agent.metadata.org)}/${agent.metadata.slug}`);
 * ```
 */
export function useOrgSlugForId(): (orgId: string) => string {
  const orgs = useKnownOrgs();
  return useCallback(
    (orgId: string) => {
      if (!orgId || !orgs) return orgId;
      const match = orgs.find((o) => o.metadata?.id === orgId);
      return match?.metadata?.slug || orgId;
    },
    [orgs],
  );
}

/**
 * Returns a function answering the id of the organization a reference
 * names, where the reference is a slug or an id (a URL's org segment, for
 * one). Use it before comparing a reference with a stored `metadata.org`,
 * which is an id.
 *
 * The answer is the org's id when the reference names one of the person's
 * organizations, or the one they have open, by id or current slug, and the
 * reference unchanged otherwise.
 *
 * @example
 * ```tsx
 * const orgIdFor = useOrgIdForRef();
 * const isOwn = agent.metadata?.org === orgIdFor(routeOrg);
 * ```
 */
export function useOrgIdForRef(): (orgRef: string) => string {
  const orgs = useKnownOrgs();
  return useCallback(
    (orgRef: string) => {
      if (!orgRef || !orgs) return orgRef;
      return findOrgByRef(orgs, orgRef)?.metadata?.id || orgRef;
    },
    [orgs],
  );
}
