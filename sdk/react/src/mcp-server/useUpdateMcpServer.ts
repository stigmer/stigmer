"use client";

import { useCallback, useState } from "react";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import type { McpServerInput } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useUpdateMcpServer}. */
export interface UseUpdateMcpServerReturn {
  /** Update an existing MCP server with a full input. Returns the updated resource. */
  readonly update: (input: McpServerInput) => Promise<McpServer>;
  /** `true` while the update RPC is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
  /** Clear the error state. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that updates an existing MCP Server resource.
 *
 * Wraps `stigmer.mcpServer.update(input)` with loading and error state.
 * The caller must provide a **complete** `McpServerInput` — the backend
 * performs full spec replacement. Use `toMcpServerUpdateInput()` (from
 * `@stigmer/sdk`) to reconstruct the input from a fetched server, modify
 * the desired field, and pass the result here.
 */
export function useUpdateMcpServer(): UseUpdateMcpServerReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const update = useCallback(
    async (input: McpServerInput): Promise<McpServer> => {
      setIsUpdating(true);
      setError(null);

      try {
        return await stigmer.mcpServer.update(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return { update, isUpdating, error, clearError };
}
