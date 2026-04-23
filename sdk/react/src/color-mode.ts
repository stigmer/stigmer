"use client";

import { createContext, useContext, useEffect, useState } from "react";

/**
 * Color mode requested by the host application.
 *
 * - `"light"` — light design tokens.
 * - `"dark"`  — dark design tokens.
 * - `"system"` — follows the user's OS preference via `prefers-color-scheme`.
 */
export type ColorMode = "light" | "dark" | "system";

/**
 * The concrete color mode applied to the Stigmer component tree.
 *
 * Always `"light"` or `"dark"` — the `"system"` input is resolved
 * to one of these before it reaches components or CSS.
 */
export type ResolvedColorMode = "light" | "dark";

/**
 * React context for the resolved color mode.
 *
 * Separated from the provider to mirror the `StigmerContext` / `context.ts`
 * pattern and avoid circular imports.
 *
 * Defaults to `"light"` so components outside a provider render safely.
 */
export const ColorModeContext = createContext<ResolvedColorMode>("light");

/**
 * Read the resolved color mode from the nearest `StigmerProvider`.
 *
 * Returns `"light"` or `"dark"` — never `"system"`. The provider
 * resolves `"system"` to a concrete value before setting context.
 *
 * Useful for components that need mode-aware logic in JavaScript
 * (e.g., choosing between icon variants, canvas rendering, or
 * third-party library theming).
 */
export function useColorMode(): ResolvedColorMode {
  return useContext(ColorModeContext);
}

const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

/**
 * Internal hook that tracks the user's OS color scheme preference.
 *
 * Listens to `matchMedia("(prefers-color-scheme: dark)")` and
 * returns a resolved `"light" | "dark"` value that updates when
 * the OS preference changes.
 *
 * Returns `"light"` during SSR (no `window`).
 *
 * @internal Not exported from the public API — used only by the provider.
 */
export function useSystemColorMode(): ResolvedColorMode {
  const [mode, setMode] = useState<ResolvedColorMode>(() => {
    if (typeof window === "undefined") return "light";
    return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
  });

  useEffect(() => {
    const mql = window.matchMedia(DARK_MEDIA_QUERY);
    const handler = (e: MediaQueryListEvent) => {
      setMode(e.matches ? "dark" : "light");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return mode;
}
