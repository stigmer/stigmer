"use client";

// ---------------------------------------------------------------------------
// ThemeProvider — next-themes with a dev-only console filter
//
// next-themes renders an inline <script> inside its provider to apply the
// stored theme before hydration (preventing a flash of the wrong theme).
// React 19 warns about any <script> rendered inside a component tree:
//
//   "Encountered a script tag while rendering React component. Scripts
//    inside React components are never executed when rendering on the
//    client. ..."
//
// The warning is a false positive for this use case — the script executes
// during SSR/static HTML, which is exactly when it matters. Upstream is
// aware but unmaintained: https://github.com/pacocoursey/next-themes/issues/385
//
// TODO(next-themes): remove this filter (and this wrapper, if it has no
// other purpose) once next-themes ships a fix for the React 19 warning.
// ---------------------------------------------------------------------------

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

const SCRIPT_TAG_WARNING = "Encountered a script tag while rendering";

// Installed at module scope so the filter is active before next-themes'
// inline script first renders. Dev-only: production builds never emit the
// warning (it comes from React's development runtime).
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].includes(SCRIPT_TAG_WARNING)) {
      return;
    }
    originalError.apply(console, args);
  };
}

/**
 * Drop-in wrapper around next-themes' `ThemeProvider`.
 *
 * Exists solely to host the dev-only console filter above; all props pass
 * through unchanged. Import this instead of `next-themes` when rendering
 * the provider (hooks like `useTheme` still come from `next-themes`).
 */
export function ThemeProvider(props: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props} />;
}
