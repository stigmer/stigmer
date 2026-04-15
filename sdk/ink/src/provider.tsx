import React, { type ReactNode } from "react";
import { StigmerContext, DeploymentModeContext } from "@stigmer/react";
import type { Stigmer, DeploymentMode } from "@stigmer/sdk";

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
}

/**
 * Stigmer provider for Ink (terminal) environments.
 *
 * Provides the same React contexts as `StigmerProvider` from
 * `@stigmer/react`, but without the DOM `<div>` wrapper used for
 * CSS scoping (which is not applicable in a terminal).
 *
 * All hooks from `@stigmer/react` (`useStigmer`, `useSessionConversation`,
 * `useExecutionStream`, etc.) work identically under this provider.
 *
 * @example
 * ```tsx
 * import { render } from "ink";
 * import { InkStigmerProvider, createNodeClient } from "@stigmer/ink";
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
}: InkStigmerProviderProps) {
  return (
    <StigmerContext.Provider value={client}>
      <DeploymentModeContext.Provider value={deploymentMode}>
        {children}
      </DeploymentModeContext.Provider>
    </StigmerContext.Provider>
  );
}
