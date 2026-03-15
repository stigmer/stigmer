"use client";

import { useContext, useMemo } from "react";
import { createClient, type Client } from "@connectrpc/connect";
import type { DescService } from "@bufbuild/protobuf";
import { StigmerTransportContext } from "./context";

/**
 * Access the Stigmer RPC transport from the nearest
 * {@link StigmerTransportProvider}.
 *
 * Throws if called outside a provider — this surfaces wiring mistakes
 * immediately during development rather than producing silent `null`
 * failures at runtime.
 */
export function useStigmerTransport() {
  const transport = useContext(StigmerTransportContext);
  if (!transport) {
    throw new Error(
      "useStigmerTransport must be used within <StigmerTransportProvider>",
    );
  }
  return transport;
}

/**
 * Create a typed Connect-RPC service client from the nearest transport
 * provider.
 *
 * The client is memoized on the `(service, transport)` tuple — it is
 * stable across re-renders as long as the transport does not change
 * (which only happens when `serverUrl` changes).
 *
 * @example
 * ```ts
 * const client = useServiceClient(AgentExecutionQueryController);
 * const execution = await client.get(request);
 * ```
 */
export function useServiceClient<T extends DescService>(service: T): Client<T> {
  const transport = useStigmerTransport();
  return useMemo(() => createClient(service, transport), [service, transport]);
}
