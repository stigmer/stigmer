"use client";

import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { cn, resolvePresetClass } from "@stigmer/theme";
import type { ThemePresetId } from "@stigmer/theme";
import { StigmerContext } from "./context";

export interface StigmerProviderProps {
  /** A configured {@link Stigmer} client instance. */
  readonly client: Stigmer;
  readonly children: ReactNode;
  /**
   * Built-in theme preset to apply.
   *
   * Maps to a CSS class on the scoping container so the preset's
   * design tokens take effect for all descendant Stigmer components.
   * Omit (or pass `"default"`) to use the base Stigmer palette.
   *
   * @example
   * ```tsx
   * <StigmerProvider client={client} preset="corporate">
   *   <ChatWidget />
   * </StigmerProvider>
   * ```
   */
  readonly preset?: ThemePresetId;
  /**
   * Additional CSS class names applied to the scoping container element.
   * The container always includes the `stgm` class for style isolation.
   */
  readonly className?: string;
}

/**
 * React provider that distributes a {@link Stigmer} SDK client to
 * descendant components via {@link StigmerContext}.
 *
 * Renders a `<div class="stgm">` container that scopes Stigmer's
 * CSS reset and design tokens. External consumers importing
 * `@stigmer/react/styles.css` get isolated styles that do not
 * leak into the host application.
 *
 * Pass {@link StigmerProviderProps.preset | preset} to apply a
 * built-in theme, or use {@link StigmerProviderProps.className | className}
 * for custom styling.
 *
 * @example
 * ```tsx
 * const client = useMemo(
 *   () => new Stigmer({ baseUrl, getAccessToken }),
 *   [getAccessToken],
 * );
 *
 * <StigmerProvider client={client} preset="fintech">
 *   <App />
 * </StigmerProvider>
 * ```
 */
export function StigmerProvider({
  client,
  children,
  preset,
  className,
}: StigmerProviderProps) {
  const presetClass = preset ? resolvePresetClass(preset) : "";

  return (
    <StigmerContext.Provider value={client}>
      <div className={cn("stgm", presetClass, className)}>{children}</div>
    </StigmerContext.Provider>
  );
}
