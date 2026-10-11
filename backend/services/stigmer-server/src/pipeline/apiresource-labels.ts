/**
 * Well-known stigmer.ai/* metadata labels — ports
 * backend/libs/go/apiresource/labels.go (itself the Go twin of the cloud
 * edition's SystemManagedLabels). Keep the three in sync.
 *
 * Trust boundary: labels are client-suppliable, so they may be used to
 * RESTRICT what a request may do but never to GRANT anything. Where a
 * grant-shaped decision is needed, key it on server-owned state instead.
 * Every write boundary runs GuardReservedLabels over the namespace
 * (pipeline/steps/guard-reserved-labels.ts), but the open-source
 * authorizer's permissive default ALLOWS reserved-label writes by design
 * (the self-hosted operator owns the store).
 */

/**
 * The platform-reserved label key namespace. Keys under this prefix carry
 * platform semantics (the schedule and surface stamps a run's vaults are
 * found by) and are written by the server — never introduced by ordinary client requests on the cloud edition.
 */
export const RESERVED_LABEL_PREFIX = "stigmer.ai/";

/**
 * Marks a resource whose lifecycle (creation, naming, visibility) is
 * system-managed; user mutations of the managed aspects are rejected.
 */
export const SYSTEM_MANAGED_LABEL = `${RESERVED_LABEL_PREFIX}system-managed`;

/**
 * The only value that activates a reserved marker label; any other value is
 * inert (matching cloud's "true".equals(...)). Stamped by the flows that
 * create system-managed resources.
 */
export const RESERVED_LABEL_TRUE = "true";
