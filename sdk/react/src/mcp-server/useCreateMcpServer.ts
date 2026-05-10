"use client";

import { useCallback, useState } from "react";
import type { McpServerInput } from "@stigmer/sdk";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Return value of {@link useCreateMcpServer}. */
export interface UseCreateMcpServerReturn {
  /**
   * Submit a {@link McpServerInput} to create (or upsert) an MCP server blueprint.
   *
   * Uses `stigmer.mcpServer.apply()` — the idempotent upsert operation.
   * Resolves with the server-created/updated `McpServer` proto including
   * populated metadata (id, slug, audit timestamps).
   */
  readonly create: (input: McpServerInput) => Promise<McpServer>;
  /** `true` while the apply request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `mcpServer.apply()` with loading and error state.
 *
 * Creates an MCP server blueprint from a {@link McpServerInput}. Uses
 * `apply()` (upsert) rather than `create()` so re-submissions are
 * idempotent — matching the CLI's `stigmer apply` semantics.
 *
 * Follows the established SDK mutation hook pattern: `isCreating` flag,
 * `error` state, `clearError` reset, result returned from the promise
 * (not stored in hook state).
 *
 * @example
 * ```tsx
 * const { create, isCreating, error, clearError } = useCreateMcpServer();
 *
 * const server = await create({
 *   name: "github",
 *   org: "acme",
 *   http: { url: "https://mcp.github.com/sse" },
 *   env: { GITHUB_TOKEN: { isSecret: true, description: "GitHub PAT" } },
 * });
 * // server.metadata?.slug → "github"
 * ```
 */
export function useCreateMcpServer(): UseCreateMcpServerReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: McpServerInput): Promise<McpServer> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.mcpServer.apply(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create, isCreating, error, clearError };
}
