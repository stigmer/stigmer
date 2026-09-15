/**
 * The organization-directory extension point (convergence program C2,
 * 20260827.10; plan-gate ruling Q7). Three organization query behaviors
 * fork between editions — the forks are ratified vocabulary as the
 * conformance capability flags, and this port is their ONE seam:
 *
 *   - `find` (org enumeration; capability `organizationEnumeration`):
 *     the trusted-local laptop enumerates freely; the cloud — and open
 *     source under the built-in authorization posture — refuses with
 *     UNIMPLEMENTED (no caller may list organizations they hold no role
 *     in; `find` is skip-authorization by annotation, so the refusal is
 *     the only thing standing between a member and every row).
 *   - `findMyOrganizations` (capability `multiTenant`): the trusted-local
 *     laptop answers ALL organizations (single-user semantics); the cloud
 *     and the built-in directory filter to what the caller may view.
 *   - `getByExternalOrgId` (capability `externalOrgLookup`): deliberately
 *     absent from the OSS partial registration (UNIMPLEMENTED by
 *     construction); the cloud resolves external IdP org ids.
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
   * When true, `find` refuses org enumeration with UNIMPLEMENTED before
   * any store read (the cloud posture).
   */
  readonly refusesEnumeration: boolean;
  /**
   * The org ids the caller may see in findMyOrganizations, or
   * ALL_ORGANIZATIONS for unfiltered results. Ids the store no longer
   * holds are skipped by the controller (grants can outlive rows).
   */
  listMyOrganizationIds(
    caller: CallerIdentity,
  ): Promise<ReadonlyArray<string> | typeof ALL_ORGANIZATIONS>;
  /**
   * Resolves an external IdP organization id to the org's resource id;
   * undefined = no mapping. When this method is present, the controller
   * registers `getByExternalOrgId` (its chain stays controller-owned);
   * when absent, the RPC stays unregistered and answers UNIMPLEMENTED.
   */
  getOrganizationIdByExternalOrgId?(
    externalOrgId: string,
  ): Promise<string | undefined>;
}
