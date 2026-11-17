"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

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

/** Calls `onChange` whenever the OS color scheme changes; returns the unsubscribe. */
function subscribeToSystemColorMode(onChange: () => void): () => void {
  const mql = window.matchMedia(DARK_MEDIA_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** The OS color scheme now, in the browser. */
function systemColorModeNow(): ResolvedColorMode {
  return window.matchMedia(DARK_MEDIA_QUERY).matches ? "dark" : "light";
}

/** What a server renders, and what hydration starts from: it cannot see the OS. */
function systemColorModeOnServer(): ResolvedColorMode {
  return "light";
}

/**
 * Internal hook that tracks the user's OS color scheme preference.
 *
 * Reads `matchMedia("(prefers-color-scheme: dark)")` through
 * `useSyncExternalStore`, so it updates when the OS preference changes and
 * is safe to server-render: the server and the hydrating client both render
 * `"light"`, then the client moves to the OS's mode right after hydration.
 * Reading `matchMedia` in the first render instead made a server-rendered
 * page (a Next.js app's) hydrate with attributes the server never wrote,
 * which React reports and does not patch up (stigmer#3202).
 *
 * @internal Not exported from the public API — used only by the provider.
 */
export function useSystemColorMode(): ResolvedColorMode {
  return useSyncExternalStore(subscribeToSystemColorMode, systemColorModeNow, systemColorModeOnServer);
}
