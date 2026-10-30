// The terminal kit's provider: the conversation core's two contexts (the
// client and the deployment mode) without the React kit's DOM wrapper, and the
// colour theme every Ink component draws its roles from (theme.ts).
import React, { useMemo, type ReactNode } from "react";
import { StigmerContext, DeploymentModeContext } from "@stigmer/react-core";
import type { Stigmer, DeploymentMode } from "@stigmer/client";
import { InkThemeContext, resolveInkTheme, type InkTheme } from "./theme.js";

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
   * or `{ accent: "#7c3aed" }`.
   */
  theme?: Partial<InkTheme>;
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
}: InkStigmerProviderProps) {
  const resolved = useMemo(() => resolveInkTheme(theme), [theme]);
  return (
    <StigmerContext.Provider value={client}>
      <DeploymentModeContext.Provider value={deploymentMode}>
        <InkThemeContext.Provider value={resolved}>{children}</InkThemeContext.Provider>
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>
  );
}
