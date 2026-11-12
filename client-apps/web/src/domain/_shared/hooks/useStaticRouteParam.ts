"use client";

import { useMemo } from "react";
import { useParams, usePathname } from "next/navigation";

const PLACEHOLDER = "__placeholder__";

/**
 * Resolve a dynamic route parameter in static export deployments.
 *
 * When nginx serves __placeholder__.html for an unknown dynamic route,
 * useParams() returns "__placeholder__" from the pre-rendered RSC data
 * instead of the actual value from the URL.  This hook detects that
 * case and extracts the real value from the router's pathname. The
 * router's, not `window.location`'s: on a client-side arrival (a `Link`
 * from another page) the first render runs before the address bar holds
 * the new path, so `window.location` still names the page left behind
 * (a session's `/sessions/ses_…` read as an agent's slug).
 *
 * @param name  The route parameter name (e.g. "slug", "org").
 * @param fromEnd  Position from the end of the URL path segments
 *   (1-based). Defaults to `1` (the last segment). Use `2` for the
 *   second-to-last segment, etc. Only used when falling back to
 *   `window.location.pathname` — ignored when Next.js provides the
 *   real value directly.
 *
 * Returns null if the real value cannot be determined.
 */
/** A path segment decoded; a malformed escape ("%E0%A4%A") is kept as written, so it reads as not found, not as a crash. */
function decoded(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function useStaticRouteParam(
  name: string,
  fromEnd = 1,
): string | null {
  const params = useParams();
  const raw = params[name] as string;
  const pathname = usePathname();

  return useMemo(() => {
    if (raw !== PLACEHOLDER) return raw;
    const segments = pathname.split("/").filter(Boolean);
    const actual = segments[segments.length - fromEnd];
    return actual && actual !== PLACEHOLDER ? decoded(actual) : null;
  }, [raw, fromEnd, pathname]);
}
