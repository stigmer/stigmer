"use client";

import { useMemo } from "react";
import { useStigmerTransport } from "@stigmer/rpc-client";
import {
  createSessionQueryService,
  type SessionQueryService,
} from "./session-query-service";

/**
 * Returns a {@link SessionQueryService} bound to the transport from
 * {@link StigmerTransportProvider}. The service instance is memoized
 * for the lifetime of the transport.
 */
export function useSessionQueryService(): SessionQueryService {
  const transport = useStigmerTransport();
  return useMemo(() => createSessionQueryService(transport), [transport]);
}
