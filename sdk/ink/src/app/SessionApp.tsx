import React from "react";
import { Box, Text } from "ink";
import type { TokenProvider } from "@stigmer/sdk";
import { InkStigmerProvider } from "../provider.js";
import { createNodeClient, type NodeClientConfig } from "@stigmer/sdk/node";
import { SessionView } from "./SessionView.js";

/** Props for {@link SessionApp}. */
export interface SessionAppProps {
  /** Session ID to display and converse in. */
  readonly sessionId: string;
  /** Organization slug for creating follow-up executions. */
  readonly org: string;
  /** Stigmer API server URL. */
  readonly baseUrl: string;
  /** Static API key for authentication. */
  readonly apiKey?: string;
  /** Dynamic token provider for authentication. */
  readonly getAccessToken?: TokenProvider;
  /**
   * Default interaction mode for follow-up executions.
   *
   * - `"agent"` (default): full tool access.
   * - `"plan"`: read-only analysis, no file mutations.
   *
   * When set, all follow-up executions in this session use this mode
   * unless overridden by the user.
   */
  readonly mode?: "agent" | "plan";
}

/**
 * Self-contained top-level Ink application for viewing and
 * interacting with a Stigmer agent session in the terminal.
 *
 * Creates a Node.js-compatible Stigmer client, wraps in
 * `InkStigmerProvider`, and renders a {@link SessionView}.
 *
 * This is the highest-level component — platform builders who
 * need more control should compose {@link InkStigmerProvider},
 * {@link SessionView}, or the individual components directly.
 *
 * @example
 * ```tsx
 * import { render } from "ink";
 * import { SessionApp } from "@stigmer/ink";
 *
 * render(
 *   <SessionApp
 *     sessionId="ses-abc123"
 *     org="my-org"
 *     baseUrl="https://api.stigmer.ai"
 *     apiKey={process.env.STIGMER_API_KEY}
 *   />
 * );
 * ```
 */
export function SessionApp({
  sessionId,
  org,
  baseUrl,
  apiKey,
  getAccessToken,
  mode,
}: SessionAppProps) {
  const clientConfig: NodeClientConfig = { baseUrl, apiKey, getAccessToken };

  const client = React.useMemo(
    () => createNodeClient(clientConfig),
    [baseUrl, apiKey, getAccessToken],
  );

  return (
    <InkStigmerProvider client={client}>
      <Box flexDirection="column">
        <Box paddingLeft={1} paddingBottom={1}>
          <Text dimColor>
            Session {sessionId} · {org}
          </Text>
        </Box>
        <SessionView sessionId={sessionId} org={org} mode={mode} />
      </Box>
    </InkStigmerProvider>
  );
}
