/**
 * Utility for respecting the user's motion preference (prefers-reduced-motion)
 * in programmatic viewport animations (fitView, setCenter, etc.) that are NOT
 * covered by the CSS-level reduced-motion rule in styles.css.
 *
 * React Flow's JS-driven animations (duration parameter on fitView/setCenter)
 * bypass CSS media queries — they must be explicitly checked.
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

/**
 * Returns 0 when the user prefers reduced motion, otherwise returns the
 * desired duration. Use for all React Flow viewport animations.
 *
 * @example
 * fitView({ duration: getAnimationDuration(300) });
 * setCenter(x, y, { duration: getAnimationDuration(400) });
 */
export function getAnimationDuration(desiredMs: number): number {
  return prefersReducedMotion() ? 0 : desiredMs;
}
