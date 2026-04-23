"use client";

import type { ReactNode } from "react";
import type { Stigmer, DeploymentMode } from "@stigmer/sdk";
import { cn, resolvePresetClass } from "@stigmer/theme";
import type { ThemePresetId } from "@stigmer/theme";
import { StigmerContext } from "./context";
import { DeploymentModeContext } from "./deployment-mode";
import type { ColorMode, ResolvedColorMode } from "./color-mode";
import { ColorModeContext, useSystemColorMode } from "./color-mode";

/** Props for {@link StigmerProvider}. */
export interface StigmerProviderProps {
  /** A configured {@link Stigmer} client instance. */
  readonly client: Stigmer;
  /** React children rendered inside the provider scope. */
  readonly children: ReactNode;
  /**
   * Deployment mode of the connected Stigmer backend.
   *
   * - `"local"` — local Go CLI server (OSS). Cloud-only resources
   *   (API keys, IAM, identity management) are unavailable.
   * - `"cloud"` — Stigmer Cloud. All resources are available.
   *
   * Defaults to `"cloud"` so existing consumers see no change.
   * The Stigmer Console derives this from the API URL hostname.
   * Platform builders pass it based on their deployment context.
   */
  readonly deploymentMode?: DeploymentMode;
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
  /**
   * Controls the color mode for all descendant Stigmer components.
   *
   * - `"light"` — light design tokens (default).
   * - `"dark"`  — dark design tokens.
   * - `"system"` — follows the user's OS preference via
   *   `prefers-color-scheme`. Resolved to `"light"` or `"dark"`
   *   before reaching CSS or React context.
   *
   * The resolved value is set as `data-stgm-color-mode` on the
   * scoping container and exposed via {@link useColorMode}.
   * Host applications pass their own theme state directly —
   * no ancestor CSS class conventions are required.
   *
   * @default "light"
   *
   * @example
   * ```tsx
   * // Explicit dark mode
   * <StigmerProvider client={client} colorMode="dark">
   *   <ChatWidget />
   * </StigmerProvider>
   *
   * // Bridge from MUI
   * const muiMode = useTheme().palette.mode;
   * <StigmerProvider client={client} colorMode={muiMode}>
   *   <ChatWidget />
   * </StigmerProvider>
   * ```
   */
  readonly colorMode?: ColorMode;
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
 * The `colorMode` prop controls dark/light appearance via a
 * `data-stgm-color-mode` attribute on the scoping container.
 * Host applications pass their theme state directly — no ancestor
 * `.dark` class or Tailwind convention is required.
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
 * <StigmerProvider client={client} preset="fintech" colorMode="dark">
 *   <App />
 * </StigmerProvider>
 * ```
 */
export function StigmerProvider({
  client,
  children,
  deploymentMode = "cloud",
  preset,
  className,
  colorMode = "light",
}: StigmerProviderProps) {
  const systemMode = useSystemColorMode();
  const resolvedMode: ResolvedColorMode =
    colorMode === "system" ? systemMode : colorMode;

  const presetClass = preset ? resolvePresetClass(preset) : "";

  return (
    <StigmerContext.Provider value={client}>
      <DeploymentModeContext.Provider value={deploymentMode}>
        <ColorModeContext.Provider value={resolvedMode}>
          <div
            className={cn("stgm", presetClass, className)}
            data-stgm-color-mode={resolvedMode}
          >
            {children}
          </div>
        </ColorModeContext.Provider>
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>
  );
}
