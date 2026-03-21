/**
 * Gradient overlay that signals hidden content above or below a
 * scrollable container. Renders a `pointer-events-none` absolutely
 * positioned `div` — the parent must be `position: relative`.
 *
 * Uses `--color-popover` with a fallback so the gradient blends
 * into the most common container background. A future iteration may
 * introduce a dedicated `--stgm-scroll-fade` token.
 *
 * @internal
 */
export function ScrollFade({ position }: { readonly position: "top" | "bottom" }) {
  const isTop = position === "top";

  return (
    <div
      className={[
        "pointer-events-none absolute inset-x-0 z-10 h-3",
        isTop ? "top-0" : "bottom-0",
      ].join(" ")}
      style={{
        background: isTop
          ? "linear-gradient(to bottom, var(--color-popover, hsl(0 0% 9%)), transparent)"
          : "linear-gradient(to top, var(--color-popover, hsl(0 0% 9%)), transparent)",
      }}
      aria-hidden="true"
    />
  );
}
