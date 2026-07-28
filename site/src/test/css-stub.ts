/**
 * Test-only stand-in for stylesheet imports. vitest.config.ts aliases every
 * `.css` specifier here: component suites assert structure and props, never
 * computed styles, and letting Vite process real CSS would drag the site's
 * Next-oriented PostCSS config (@tailwindcss/postcss) into vitest, where it
 * is not a valid plugin. A side-effect import of this empty module is the
 * whole behavior.
 */
export {};
