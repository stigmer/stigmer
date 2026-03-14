"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { getMcpServer } from "@/services/mcp-server-service";

export interface UseMcpServerDetailReturn {
  mcpServer: McpServer | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Fetches a full McpServer resource by ID.
 *
 * Returns the complete MCP server including metadata, spec (server type,
 * tool approvals, env spec), and status (validation, discovered capabilities).
 */
export function useMcpServerDetail(
  mcpServerId: string,
): UseMcpServerDetailReturn {
  const [mcpServer, setMcpServer] = useState<McpServer | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const fetchMcpServer = useCallback(async () => {
    if (!mcpServerId) return;

    const requestId = ++requestIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await getMcpServer(mcpServerId);

      if (requestId !== requestIdRef.current) return;

      setMcpServer(result);
    } catch (err: unknown) {
      if (requestId !== requestIdRef.current) return;

      const message =
        err instanceof Error ? err.message : "Failed to load MCP server";
      setError(message);
      setMcpServer(null);
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [mcpServerId]);

  useEffect(() => {
    fetchMcpServer();
  }, [fetchMcpServer]);

  return { mcpServer, isLoading, error, refresh: fetchMcpServer };
}
