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
 * Returns `"local"` for Stigmer (the open-source edition), `"enterprise"`
 * for Stigmer Enterprise and `"cloud"` for Stigmer Cloud. Ask it a TIER
 * question through {@link useResourceAvailable}; a site that compares it to
 * `"cloud"` directly is asking about a cloud-only facility (the wallet,
 * Stigmer-managed compute, the shared platform messaging apps) and should
 * say which one.
 */
export function useDeploymentMode(): DeploymentMode {
  return useContext(DeploymentModeContext);
}

/**
 * Check whether a given {@link ApiResourceKind} is served by the connected
 * edition.
 *
 * Combines the deployment mode from context with the proto-derived tier
 * metadata via {@link isResourceAvailable}: a kind is served when the
 * edition ranks at or above the kind's minimum edition (oss < enterprise <
 * cloud).
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
