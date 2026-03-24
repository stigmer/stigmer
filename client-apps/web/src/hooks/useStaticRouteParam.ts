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
 * Returns null if the real value cannot be determined.
 */
export function useStaticRouteParam(name: string): string | null {
  const params = useParams();
  const raw = params[name] as string;

  return useMemo(() => {
    if (raw !== PLACEHOLDER) return raw;
    if (typeof window === "undefined") return null;
    const segments = window.location.pathname.split("/").filter(Boolean);
    const actual = segments[segments.length - 1];
    return actual && actual !== PLACEHOLDER ? actual : null;
  }, [raw]);
}
