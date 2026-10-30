// The terminal kit's provider: the conversation core's two contexts (the
// client and the deployment mode) without the React kit's DOM wrapper, the
// colour theme every Ink component draws its roles from (theme.ts), and the
// terminal's background a host's theme may follow.
import React, { useMemo, type ReactNode } from "react";
import { StigmerContext, DeploymentModeContext } from "@stigmer/react-core";
import type { Stigmer, DeploymentMode } from "@stigmer/client";
import { InkThemeContext, TerminalBackgroundContext, resolveInkTheme, type InkThemeInput } from "./theme.js";
import type { TerminalBackground } from "./terminal-background.js";

/**
 * Props for {@link InkStigmerProvider}.
 */
export interface InkStigmerProviderProps {
  /** Pre-configured Stigmer client (use {@link createNodeClient} to create one). */
  client: Stigmer;

  /** Child components to render. */
  children: ReactNode;

  /**
   * Deployment mode for feature gating.
   * - `"cloud"`: All features available (default).
   * - `"local"`: OSS feature subset only.
   */
  deploymentMode?: DeploymentMode;

  /**
   * The host's colours by role, over Stigmer's default (monochrome, with hue
   * only for success, warning and danger). For example `{ accent: "magenta" }`
   * or `{ accent: "#7c3aed" }`; or a function of the terminal's background,
   * `(background) => (background === "light" ? { accent: "#5b21b6" } : { accent: "#c4b5fd" })`.
   */
  theme?: InkThemeInput;

  /**
   * The terminal's background, for a theme given as a function:
   * `detectBackground()` before rendering finds it, and `runInTerminal` does
   * so itself. "unknown" by default.
   */
  background?: TerminalBackground;
}

/**
 * Stigmer provider for Ink (terminal) environments.
 *
 * Provides the same React contexts as `StigmerProvider` from
 * `@stigmer/react-sdk`, but without the DOM `<div>` wrapper used for
 * CSS scoping (which is not applicable in a terminal).
 *
 * All hooks from `@stigmer/react-core` (`useStigmer`, `useSessionConversation`,
 * `useSessionEvents`, etc.) work identically under this provider.
 *
 * @example
 * ```tsx
 * import { render } from "ink";
 * import { InkStigmerProvider, createNodeClient } from "@stigmer/ink-ui";
 *
 * const client = createNodeClient({
 *   baseUrl: "https://api.stigmer.ai",
 *   apiKey: process.env.STIGMER_API_KEY,
 * });
 *
 * render(
 *   <InkStigmerProvider client={client}>
 *     <MyTerminalApp />
 *   </InkStigmerProvider>
 * );
 * ```
 */
export function InkStigmerProvider({
  client,
  children,
  deploymentMode = "cloud",
  theme,
  background = "unknown",
}: InkStigmerProviderProps) {
  const resolved = useMemo(() => resolveInkTheme(theme, background), [theme, background]);
  return (
    <StigmerContext.Provider value={client}>
      <DeploymentModeContext.Provider value={deploymentMode}>
        <TerminalBackgroundContext.Provider value={background}>
          <InkThemeContext.Provider value={resolved}>{children}</InkThemeContext.Provider>
        </TerminalBackgroundContext.Provider>
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>
  );
}
