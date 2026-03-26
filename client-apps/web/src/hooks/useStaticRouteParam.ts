"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";

const PLACEHOLDER = "__placeholder__";

/**
 * Resolve a dynamic route parameter in static export deployments.
 *
 * When nginx serves __placeholder__.html for an unknown dynamic route,
 * useParams() returns "__placeholder__" from the pre-rendered RSC data
 * instead of the actual value from the URL.  This hook detects that
 * case and extracts the real value from window.location.pathname.
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
export function useStaticRouteParam(
  name: string,
  fromEnd = 1,
): string | null {
  const params = useParams();
  const raw = params[name] as string;

  return useMemo(() => {
    if (raw !== PLACEHOLDER) return raw;
    if (typeof window === "undefined") return null;
    const segments = window.location.pathname.split("/").filter(Boolean);
    const actual = segments[segments.length - fromEnd];
    return actual && actual !== PLACEHOLDER ? actual : null;
  }, [raw, fromEnd]);
}
