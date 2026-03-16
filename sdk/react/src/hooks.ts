"use client";

import { useContext } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "./context.js";

/**
 * Access the {@link Stigmer} SDK client from the nearest
 * {@link StigmerProvider}.
 *
 * Throws if called outside a provider — this surfaces wiring mistakes
 * immediately during development rather than producing silent `null`
 * failures at runtime.
 *
 * @example
 * ```tsx
 * function AgentDetail({ id }: { id: string }) {
 *   const stigmer = useStigmer();
 *   const agent = await stigmer.agent.get(id);
 * }
 * ```
 */
export function useStigmer(): Stigmer {
  const client = useContext(StigmerContext);
  if (!client) {
    throw new Error(
      "useStigmer must be used within <StigmerProvider>. " +
        "Wrap your component tree with <StigmerProvider client={stigmerClient}>.",
    );
  }
  return client;
}
