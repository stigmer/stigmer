"use client";

import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { StigmerContext } from "./context.js";

export interface StigmerProviderProps {
  /** A configured {@link Stigmer} client instance. */
  readonly client: Stigmer;
  readonly children: ReactNode;
}

/**
 * React provider that distributes a {@link Stigmer} SDK client to
 * descendant components via {@link StigmerContext}.
 *
 * Create the client once (typically in a top-level bridge component)
 * and pass it here. All `useStigmer()` calls in the subtree will
 * receive this instance.
 *
 * @example
 * ```tsx
 * const client = useMemo(
 *   () => new Stigmer({ baseUrl, getAccessToken }),
 *   [getAccessToken],
 * );
 *
 * <StigmerProvider client={client}>
 *   <App />
 * </StigmerProvider>
 * ```
 */
export function StigmerProvider({ client, children }: StigmerProviderProps) {
  return (
    <StigmerContext.Provider value={client}>
      {children}
    </StigmerContext.Provider>
  );
}
