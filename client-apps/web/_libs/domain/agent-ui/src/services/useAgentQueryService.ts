"use client";

import { useMemo } from "react";
import { useStigmerTransport } from "@stigmer/rpc-client";
import {
  createAgentQueryService,
  type AgentQueryService,
} from "./agent-query-service";

/**
 * Returns an {@link AgentQueryService} bound to the transport from
 * {@link StigmerTransportProvider}. The service instance is memoized
 * for the lifetime of the transport.
 */
export function useAgentQueryService(): AgentQueryService {
  const transport = useStigmerTransport();
  return useMemo(() => createAgentQueryService(transport), [transport]);
}
