"use client";

import { createContext } from "react";
import type { Stigmer } from "@stigmer/sdk";

/**
 * React context for the Stigmer SDK client instance.
 *
 * Separated from the provider component to prevent circular imports:
 * both the provider and consumer hooks import from this file.
 *
 * The context value is `null` when no provider is mounted. Consumer hooks
 * throw in this case to surface wiring mistakes during development.
 */
export const StigmerContext = createContext<Stigmer | null>(null);
