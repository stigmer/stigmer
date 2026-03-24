"use client";

import { useState, useEffect } from "react";
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
 * Returns null during the brief resolution frame so consumers can
 * show a loading state instead of firing API calls with the placeholder.
 */
export function useStaticRouteParam(name: string): string | null {
  const params = useParams();
  const raw = params[name] as string;

  const [resolved, setResolved] = useState<string | null>(
    raw === PLACEHOLDER ? null : raw,
  );

  useEffect(() => {
    if (raw !== PLACEHOLDER) {
      setResolved(raw);
      return;
    }
    const segments = window.location.pathname.split("/").filter(Boolean);
    const actual = segments[segments.length - 1];
    if (actual && actual !== PLACEHOLDER) {
      setResolved(actual);
    }
  }, [raw]);

  return resolved;
}
