"use client";

import { useEffect } from "react";

/**
 * Redirect a legacy-alias route to its live equivalent, client-side.
 *
 * A server-component `redirect()` cannot do this job for routes with
 * dynamic params: in `output: "export"` mode the page renders exactly
 * once, at build time, so a target built from params is baked into the
 * exported document with build-time values (observed in the export as
 * `/library/workflows/undefined/undefined`). The real values exist only
 * in the browser's URL — the same constraint that motivates
 * `useStaticRouteParam`, applied to redirects.
 *
 * @param buildTarget  Maps the pathname segments (split on "/", empties
 *   dropped) to the target path, or null when the segments cannot be
 *   resolved (e.g. the build-time placeholder document loaded directly).
 *   Must be a module-level function so the effect runs once per mount.
 *   Query string and hash are carried over to the target automatically.
 */
export function useLegacyPathRedirect(
  buildTarget: (segments: string[]) => string | null,
): void {
  useEffect(() => {
    const { pathname, search, hash } = window.location;
    const segments = pathname.split("/").filter(Boolean);
    const target = buildTarget(segments);
    if (target) {
      // Hard replace, not router navigation: in static export the router
      // cannot soft-navigate to a dynamic route that was not pre-rendered
      // (the documented reason library-navigation.tsx exists), and
      // replace() keeps the legacy URL out of the back-button history.
      window.location.replace(target + search + hash);
    }
  }, [buildTarget]);
}
