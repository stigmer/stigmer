import { useCallback, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/**
 * Keeps a library detail route's resource segment on the slug the resource
 * answers to now. The detail page reads the resource by the route's slug
 * anyway, and the answer carries its current slug, so a route naming one
 * the resource was renamed away from (which still leads to it for 30 days)
 * is replaced in place, with no new history entry, by the one naming the
 * current slug; no second lookup is made. The returned function moves the
 * route the same way after a rename made from the page.
 *
 * Only a change of the loaded slug moves the route: the page is the same
 * component across a navigation to another resource, and until that one
 * loads it still holds the previous resource, whose slug must not pull the
 * route back. The org segment
 * has its own rule (LibraryLayout's useCanonicalLibraryUrl); the web
 * console's library navigation does the same for both.
 */
export function useCanonicalDetailSlug(
  kind: "agents" | "schedules",
  org: string | undefined,
  routeSlug: string | undefined,
  currentSlug: string | undefined,
): (slug: string) => void {
  const location = useLocation();
  const navigate = useNavigate();

  const moveTo = useCallback(
    (slug: string) => {
      if (!org || !slug || slug === routeSlug) return;
      navigate(
        `/library/${kind}/${org}/${slug}${location.search}${location.hash}`,
        {
          replace: true,
        },
      );
    },
    [kind, org, routeSlug, navigate, location.search, location.hash],
  );

  const moveToRef = useRef(moveTo);
  moveToRef.current = moveTo;
  useEffect(() => {
    if (currentSlug) moveToRef.current(currentSlug);
  }, [currentSlug]);

  return moveTo;
}
