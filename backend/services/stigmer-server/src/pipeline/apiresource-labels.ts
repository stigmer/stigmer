/**
 * Well-known stigmer.ai/* metadata labels — ports
 * backend/libs/go/apiresource/labels.go (itself the Go twin of the cloud
 * edition's SystemManagedLabels). Keep the three in sync.
 *
 * Trust boundary: labels are client-suppliable, so they may be used to
 * RESTRICT what a request may do (e.g. reject visibility updates on default
 * instances) but never to GRANT anything. Where a grant-shaped decision is
 * needed, key it on server-owned state instead (e.g. the parent blueprint's
 * status.default_instance_id, written only by the create/self-heal flows).
 * Every write boundary runs GuardReservedLabels over the namespace
 * (pipeline/steps/guard-reserved-labels.ts), but the open-source
 * authorizer's permissive default ALLOWS reserved-label writes by design
 * (the self-hosted operator owns the store), which is why a restrict-shaped
 * predicate here still pairs the label with server-owned state: the
 * plugin-managed guard refuses only beside an existing plugin row.
 */
import type { ApiResourceMetadata } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

/**
 * The platform-reserved label key namespace. Keys under this prefix carry
 * platform semantics (default-agent resolution, personal-environment
 * uniqueness, default-instance marking) and are written by the server —
 * never introduced by ordinary client requests on the cloud edition.
 */
export const RESERVED_LABEL_PREFIX = "stigmer.ai/";

/**
 * Marks a blueprint's one auto-created default instance (the empty config
 * shell the runner resolves when a user has no personal instance). Default
 * instances carry no visibility of their own: their access always follows
 * the parent blueprint.
 */
export const DEFAULT_INSTANCE_LABEL = `${RESERVED_LABEL_PREFIX}default-instance`;

/**
 * Marks a resource whose lifecycle (creation, naming, visibility) is
 * system-managed; user mutations of the managed aspects are rejected.
 */
export const SYSTEM_MANAGED_LABEL = `${RESERVED_LABEL_PREFIX}system-managed`;

/**
 * The only value that activates a reserved marker label; any other value is
 * inert (matching cloud's "true".equals(...)). Stamped by the flows that
 * create system-managed resources (e.g. the defaultinstance factories) and
 * read by the predicates here.
 */
export const RESERVED_LABEL_TRUE = "true";

/**
 * The plugin that materialised a resource: the label's value is the
 * plugin's id (`plg_...`), never its slug, because `findAllByLabel` is
 * org-agnostic and two organizations may both install `thermos`. Written
 * only by the plugin controller (in-process, as the installing caller);
 * membership is derived on read from it and stored nowhere else.
 */
export const PLUGIN_LABEL = `${RESERVED_LABEL_PREFIX}plugin`;

/**
 * The archive digest a member was last materialised from — the per-child
 * convergence marker. A re-push compares every member's value with the
 * head's digest before deciding it has nothing to do, so a member another
 * lane deleted or an older install left behind is re-materialised.
 */
export const PLUGIN_VERSION_LABEL = `${RESERVED_LABEL_PREFIX}plugin-version`;

/** The plugin id a resource's labels claim, or undefined when unlabelled. */
export function pluginIdOf(
  metadata: ApiResourceMetadata | undefined,
): string | undefined {
  const value = metadata?.labels[PLUGIN_LABEL];
  return value === undefined || value === "" ? undefined : value;
}

/**
 * Whether the metadata carries the DEFAULT_INSTANCE_LABEL marker
 * (undefined-safe) — Go IsDefaultInstance.
 *
 * Because OSS has no reserved-label write guard, callers making a
 * restrict-shaped decision should combine this with the authoritative
 * parent pointer (blueprint status.default_instance_id) — the label alone
 * misses pre-labeling legacy rows and can be dropped by a client update.
 */
export function isDefaultInstance(
  metadata: ApiResourceMetadata | undefined,
): boolean {
  return metadata?.labels[DEFAULT_INSTANCE_LABEL] === RESERVED_LABEL_TRUE;
}
