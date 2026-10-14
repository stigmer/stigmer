/**
 * The organization-directory extension point. One organization query
 * behavior forks between editions — the fork is named vocabulary as a
 * conformance capability flag, and this port is its ONE seam:
 *
 *   - `listMine` (capability `multiTenant`): the trusted-local laptop
 *     answers ALL organizations (single-user semantics); the cloud and
 *     the built-in directory filter to what the caller may view.
 *
 * Organization enumeration (`find`) was removed with the one list shape
 * (2026-10-14): no caller used it, and every edition that authorizes
 * refused it.
 *
 * No directory composed = the trusted-local behavior, byte-identical; the
 * built-in directory (authorization/organization-directory.ts) composes
 * under the built-in posture, a unit's under its own. The controller stays
 * the ONE owner of its chains — the directory answers policy questions
 * and id lookups; it never handles RPCs.
 */
import type { CallerIdentity } from "./identity.js";

/**
 * The "no filtering" answer for listMyOrganizationIds — the OSS
 * single-user semantics, also expressible by a composed directory.
 */
export const ALL_ORGANIZATIONS = "all";

/** The directory contract (single-instance point, ExtensionDrivers.organizationDirectory). */
export interface OrganizationDirectory {
  /**
   * The org ids the caller may see in listMine, or
   * ALL_ORGANIZATIONS for unfiltered results. Ids the store no longer
   * holds are skipped by the controller (grants can outlive rows).
   */
  listMyOrganizationIds(
    caller: CallerIdentity,
  ): Promise<ReadonlyArray<string> | typeof ALL_ORGANIZATIONS>;
}
