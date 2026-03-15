"use client";

import { useMemo } from "react";
import { useStigmerTransport } from "@stigmer/rpc-client";
import {
  createExecutionService,
  type ExecutionService,
} from "../services/execution-service";

/**
 * Returns an {@link ExecutionService} bound to the transport from
 * {@link StigmerTransportProvider}. The service instance is memoized
 * for the lifetime of the transport.
 */
export function useExecutionService(): ExecutionService {
  const transport = useStigmerTransport();
  return useMemo(() => createExecutionService(transport), [transport]);
}
