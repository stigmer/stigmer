"use client";

import { createContext, useContext } from "react";
import type { DeploymentMode } from "@stigmer/sdk";
import { isResourceAvailable, ApiResourceKind } from "@stigmer/sdk";

/**
 * React context for the current deployment mode.
 *
 * Separated from the provider to mirror the `StigmerContext` / `context.ts`
 * pattern and avoid circular imports.
 *
 * Defaults to `"cloud"` so existing consumers who don't pass
 * `deploymentMode` to `StigmerProvider` see all features enabled.
 */
export const DeploymentModeContext = createContext<DeploymentMode>("cloud");

/**
 * Read the deployment mode from the nearest `StigmerProvider`.
 *
 * Returns `"local"` when connected to the local Go CLI server (OSS)
 * and `"cloud"` when connected to Stigmer Cloud.
 */
export function useDeploymentMode(): DeploymentMode {
  return useContext(DeploymentModeContext);
}

/**
 * Check whether a given {@link ApiResourceKind} is available in the
 * current deployment mode.
 *
 * Combines the deployment mode from context with the proto-derived
 * tier metadata via {@link isResourceAvailable}.
 *
 * @example
 * ```tsx
 * const available = useResourceAvailable(ApiResourceKind.api_key);
 * if (!available) return <CloudFeatureNotice>...</CloudFeatureNotice>;
 * ```
 */
export function useResourceAvailable(kind: ApiResourceKind): boolean {
  const mode = useDeploymentMode();
  return isResourceAvailable(kind, mode);
}

export { type DeploymentMode, ApiResourceKind };
