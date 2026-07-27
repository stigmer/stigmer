"use client";

import { useTheme } from "next-themes";

/**
 * The two color modes the Stigmer SDK theme scope understands.
 * Mirrors the `data-stgm-color-mode` attribute contract.
 */
export type StigmerColorMode = "light" | "dark";

/**
 * Resolves the docs reader's current color mode for `.stgm` theme scopes.
 *
 * Consumers (demo shells, the Ask AI panel) pass this value as
 * `data-stgm-color-mode` on their `.stgm` scoping element — the same
 * "pass your theme state straight through" pattern the theming docs
 * prescribe for host applications embedding the SDK.
 *
 * `resolvedTheme` is `undefined` during SSR and the first client render
 * (next-themes resolves it after mount); defaulting to `"dark"` keeps
 * server and client markup identical and matches the site's dark-first
 * aesthetic, then corrects on mount for light-mode readers.
 */
export function useDocsColorMode(): StigmerColorMode {
  const { resolvedTheme } = useTheme();
  return resolvedTheme === "light" ? "light" : "dark";
}
