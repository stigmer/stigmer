"use client";

import type { ReactNode } from "react";
import type { Stigmer } from "@stigmer/sdk";
import { cn } from "@stigmer/theme";
import { StigmerContext } from "./context";

export interface StigmerProviderProps {
  /** A configured {@link Stigmer} client instance. */
  readonly client: Stigmer;
  readonly children: ReactNode;
  /**
   * Additional CSS class names applied to the scoping container element.
   * The container always includes the `stgm` class for style isolation.
   */
  readonly className?: string;
}

/**
 * React provider that distributes a {@link Stigmer} SDK client to
 * descendant components via {@link StigmerContext}.
 *
 * Renders a `<div class="stgm">` container that scopes Stigmer's
 * CSS reset and design tokens. External consumers importing
 * `@stigmer/react/styles.css` get isolated styles that do not
 * leak into the host application.
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
export function StigmerProvider({
  client,
  children,
  className,
}: StigmerProviderProps) {
  return (
    <StigmerContext.Provider value={client}>
      <div className={cn("stgm", className)}>{children}</div>
    </StigmerContext.Provider>
  );
}
