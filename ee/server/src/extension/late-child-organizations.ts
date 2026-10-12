/**
 * The library's child-organization lookups (ComposedServices
 * .childOrganizations) for a unit built before composeServer returns. The
 * unit hands its components `lookups` at build time and fills them from
 * its `onComposed`; each call reads what was filled, and a call before
 * that is a boot-order bug, answered with the unit's name. The identity
 * unit reads them for the sign-in routing and the deprovision's reach, and
 * any other unit built the same way may hold them.
 */
import type { ChildOrganizations } from "@stigmer/server";

export interface LateChildOrganizations {
  /** The lookups a unit's components hold; each call reads the composed ones. */
  readonly lookups: ChildOrganizations;
  /** Fills the lookups from the composition (the unit's onComposed). */
  fill(composed: ChildOrganizations): void;
}

export function lateChildOrganizations(unit: string): LateChildOrganizations {
  let held: ChildOrganizations | undefined;
  const composed = (): ChildOrganizations => {
    if (held === undefined) {
      throw new Error(
        `${unit} read the child organizations before the composition handed them over — a boot-order bug`,
      );
    }
    return held;
  };
  return {
    lookups: {
      findByExternalId: (parentId, externalId) => composed().findByExternalId(parentId, externalId),
      listIds: (parentId) => composed().listIds(parentId),
      listIdsBeingDeleted: (parentId) => composed().listIdsBeingDeleted(parentId),
    },
    fill(lookups) {
      held = lookups;
    },
  };
}
