import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

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
 * Resource kinds whose proto `kind_meta.tier` is `cloud_only`.
 *
 * Source of truth: `api_resource_kind.proto` — each `ApiResourceKind` enum
 * value carries a `ResourceTier` in its `kind_meta` options. This set
 * mirrors those values statically so the SDK avoids runtime proto
 * descriptor reflection.
 *
 * When a new resource kind is added with `tier: cloud_only` in the proto,
 * add it here as well.
 */
const CLOUD_ONLY_KINDS: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.api_resource_version,
  ApiResourceKind.iam_policy,
  ApiResourceKind.identity_account,
  ApiResourceKind.api_key,
  ApiResourceKind.identity_provider,
  ApiResourceKind.platform,
]);

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
