/**
 * The child-organization lookups a composition reads
 * (ComposedServices.childOrganizations). A child organization names its
 * parent in `spec.parent_org` and may carry the parent's own identifier
 * for it in `spec.external_id`; both are fixed at create, and the
 * organization domain keeps them (domain/organization/children.ts). A
 * composition never reads the rows or the name table for them itself:
 *
 *   - a sign-in through a parent's identity provider routes a token's
 *     external_id_claim to a child with `findByExternalId`;
 *   - billing rolls a parent's children up with `listIds`.
 *
 * Neither authorizes: the caller has already decided the question is its
 * to ask (a verified token's provider names the parent; a period worker
 * acts for the platform). Faults propagate; "none" is undefined or empty.
 */
import type { Organization } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

export interface ChildOrganizations {
  /**
   * The child of `parentId` whose external_id is `externalId`, or
   * undefined when the parent has no such child (no claim, or a claim
   * whose child is gone).
   */
  findByExternalId(
    parentId: string,
    externalId: string,
  ): Promise<Organization | undefined>;
  /** Every child of `parentId`, by id, newest first; empty when it has none. */
  listIds(parentId: string): Promise<ReadonlyArray<string>>;
}
