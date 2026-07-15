"use client";

/**
 * Monochrome Slack mark (the four-lobe glyph) as an inline SVG.
 *
 * Renders in `currentColor` so it follows the surrounding text token —
 * the SDK never hardcodes brand colors (theme-token compliance). Shared
 * by the channel components; not exported from the public barrel.
 */
export function SlackMarkIcon({ className }: { readonly className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M5.04 15.17a2.52 2.52 0 1 1-2.52-2.52h2.52v2.52zM6.31 15.17a2.52 2.52 0 0 1 5.04 0v6.31a2.52 2.52 0 1 1-5.04 0v-6.31zM8.83 5.04a2.52 2.52 0 1 1 2.52-2.52v2.52H8.83zM8.83 6.31a2.52 2.52 0 0 1 0 5.04H2.52a2.52 2.52 0 1 1 0-5.04h6.31zM18.96 8.83a2.52 2.52 0 1 1 2.52 2.52h-2.52V8.83zM17.69 8.83a2.52 2.52 0 0 1-5.04 0V2.52a2.52 2.52 0 1 1 5.04 0v6.31zM15.17 18.96a2.52 2.52 0 1 1-2.52 2.52v-2.52h2.52zM15.17 17.69a2.52 2.52 0 0 1 0-5.04h6.31a2.52 2.52 0 1 1 0 5.04h-6.31z" />
    </svg>
  );
}
