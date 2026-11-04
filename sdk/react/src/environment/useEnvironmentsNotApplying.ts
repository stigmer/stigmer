"use client";

import { useExecutionTarget } from "@stigmer/react-core/internal";
import { useEnvironmentAvailability } from "../server-info.js";
import { environmentsNotApplying, type EnvironmentsNotApplying } from "./resolve.js";

/**
 * Why no Environment would govern a conversation started under this
 * provider, or undefined when one would or the server has not said: the
 * provider's execution target (`"local"` on the desktop app) and the
 * server's answer for a conversation that names none
 * (`useEnvironmentAvailability`), read through
 * {@link environmentsNotApplying}.
 *
 * @example
 * ```tsx
 * function EnvironmentSettings({ children }: { children: ReactNode }) {
 *   const notApplying = useEnvironmentsNotApplying();
 *   if (notApplying === "own-machine") return <p>Conversations run on your machine: no Environment applies.</p>;
 *   if (notApplying === "not-on-server") return <p>This server starts no sandboxes.</p>;
 *   return <>{children}</>;
 * }
 * ```
 */
export function useEnvironmentsNotApplying(): EnvironmentsNotApplying | undefined {
  const availability = useEnvironmentAvailability();
  const target = useExecutionTarget();
  return environmentsNotApplying(availability, target);
}
