"use client";

import { createContext } from "react";
import type { Transport } from "@connectrpc/connect";

/**
 * React context for the Stigmer Connect-RPC transport.
 *
 * Separated from the provider component to prevent circular imports:
 * both the provider (`provider.tsx`) and the consumer hooks (`hooks.ts`)
 * import from this file, but neither imports the other.
 *
 * The context value is `null` when no provider is mounted. Consumer hooks
 * throw in this case to surface wiring mistakes during development.
 */
export const StigmerTransportContext = createContext<Transport | null>(null);
