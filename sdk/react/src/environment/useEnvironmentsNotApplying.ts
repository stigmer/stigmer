"use client";

import { useExecutionTarget } from "../execution-target-context.js";
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
 * const notApplying = useEnvironmentsNotApplying();
 * if (notApplying === undefined) return <EnvironmentConfigureItem />;
 * ```
 */
export function useEnvironmentsNotApplying(): EnvironmentsNotApplying | undefined {
  const availability = useEnvironmentAvailability();
  const target = useExecutionTarget();
  return environmentsNotApplying(availability, target);
}
