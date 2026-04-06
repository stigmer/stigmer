import type { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { CLOUD_ONLY_KINDS } from "./gen/resource-availability";

/**
 * Deployment mode of the Stigmer backend the client is connected to.
 *
 * - `"local"` — Running against the local Go CLI server (OSS).
 *   Only `open_source`-tier resources are available.
 * - `"cloud"` — Running against Stigmer Cloud.
 *   All resources (including `cloud_only`) are available.
 */
export type DeploymentMode = "local" | "cloud";

/**
 * Check whether a resource kind is available in the given deployment mode.
 *
 * In cloud mode every resource is available. In local mode only
 * `open_source`-tier resources (those NOT in {@link CLOUD_ONLY_KINDS})
 * are available.
 */
export function isResourceAvailable(
  kind: ApiResourceKind,
  mode: DeploymentMode,
): boolean {
  if (mode === "cloud") return true;
  return !CLOUD_ONLY_KINDS.has(kind);
}
