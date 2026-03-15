"use client";

import { useMemo } from "react";
import { useStigmerTransport } from "@stigmer/rpc-client";
import {
  createMcpServerQueryService,
  type McpServerQueryService,
} from "./mcp-server-query-service";

/**
 * Returns a {@link McpServerQueryService} bound to the transport from
 * {@link StigmerTransportProvider}. The service instance is memoized
 * for the lifetime of the transport.
 */
export function useMcpServerQueryService(): McpServerQueryService {
  const transport = useStigmerTransport();
  return useMemo(() => createMcpServerQueryService(transport), [transport]);
}
