/**
 * Utility for respecting the user's motion preference (prefers-reduced-motion)
 * in programmatic animations (smooth `scrollIntoView` and the like) that are
 * NOT covered by the CSS-level reduced-motion rule in styles.css.
 *
 * JS-driven animations (smooth `scrollIntoView`) bypass CSS media queries —
 * they must be explicitly checked. Lives in `internal/` because it is
 * cross-cutting: feature domains such as the workspace file viewer depend on
 * it, and `internal/` may not depend on a feature domain.
 */

let cachedPreference: boolean | null = null;
let mediaQuery: MediaQueryList | null = null;

function getMediaQuery(): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  if (!mediaQuery) {
    mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  }
  return mediaQuery;
}

/**
 * Returns true if the user prefers reduced motion.
 * Caches the result and updates on media query change.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  const mq = getMediaQuery();
  if (!mq) return false;

  if (cachedPreference === null) {
    cachedPreference = mq.matches;
    mq.addEventListener("change", (e) => {
      cachedPreference = e.matches;
    });
  }
  return cachedPreference;
}
