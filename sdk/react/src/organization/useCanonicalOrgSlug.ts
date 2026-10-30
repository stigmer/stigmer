"use client";

/**
 * useCanonicalOrgSlug: the current slug for a URL's org segment, when the
 * segment is not it.
 *
 * A console URL's org segment is a slug, but a link may carry an id (one
 * built from a stored `metadata.org`) or a slug the organization has since
 * been renamed away from (old slugs keep resolving for a while). Pages
 * work either way, since the server accepts both; this hook tells the
 * host which slug to replace the segment with so the address bar reads
 * the organization's current name. Navigation stays the host's: it
 * replaces the URL itself.
 */
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";
import { useKnownOrgs, useOptionalOrg } from "./OrgProvider.js";

interface LookedUpSlug {
  readonly segment: string;
  readonly slug: string;
}

/**
 * Answers the slug a URL's org segment should read, or `null` when the
 * segment already reads it or the answer is not known.
 *
 * - A segment equal to the current slug of one of the person's
 *   organizations, or of the one they have open, is canonical: `null`,
 *   with no request.
 * - A segment equal to one of those organizations' ids answers that
 *   organization's slug, with no request.
 * - Any other segment is looked up once (the server resolves an id or an
 *   old slug to the organization); its slug is answered when it differs.
 *   A lookup the server refuses answers `null`.
 *
 * Waits for {@link OrgProvider}'s list to load, and answers `null` when no
 * provider is mounted.
 *
 * @param orgSegment - The org segment of the current URL, or `""`/`null`
 *   when the URL has none.
 *
 * @example
 * ```tsx
 * const canonical = useCanonicalOrgSlug(params.org);
 * useEffect(() => {
 *   if (canonical) navigate(`/library/agents/${canonical}/${params.slug}`, { replace: true });
 * }, [canonical]);
 * ```
 */
export function useCanonicalOrgSlug(
  orgSegment: string | null | undefined,
): string | null {
  const stigmer = useStigmer();
  const ctx = useOptionalOrg();
  const segment = orgSegment ?? "";
  const ready = ctx !== null && !ctx.isLoading && segment !== "";
  const orgs = useKnownOrgs() ?? [];

  const isMemberSlug = orgs.some((o) => o.metadata?.slug === segment);
  const memberById = orgs.find((o) => o.metadata?.id === segment);
  const needsLookup = ready && !isMemberSlug && memberById === undefined;

  // The answer carries the segment it was looked up for: on the render
  // where the segment changes, the previous segment's answer is still the
  // fetch's data and must not be read as this one's.
  const { data: looked } = useFetch<LookedUpSlug | null>(
    needsLookup
      ? async () => {
          const org = await stigmer.organization.get(segment);
          return { segment, slug: org.metadata?.slug ?? "" };
        }
      : null,
    [needsLookup, segment, stigmer],
    null,
  );

  if (!ready || isMemberSlug) return null;
  const slug = memberById
    ? (memberById.metadata?.slug ?? "")
    : looked?.segment === segment
      ? looked.slug
      : "";
  return slug && slug !== segment ? slug : null;
}
