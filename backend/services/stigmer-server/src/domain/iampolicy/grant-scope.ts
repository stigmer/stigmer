/**
 * Open source's PolicyGrantScope (20260913.01, T01_1_review.md Q-OR-3 and
 * Q-OR-4): the ORGANIZATION grants the roles its `kind_meta` lists —
 * owner, admin, member, viewer — and no other kind grants anything. This
 * is what lights the console's Members page in every edition while a
 * viewer on one agent, the per-resource grant, stays what the Enterprise
 * and Cloud editions add by composing a wider scope
 * (extensions/policy-grant-scope.ts carries the contract every scope is
 * held to: narrows the proto, total over the enum, synchronous).
 *
 * Installed by the composition root when no unit registers
 * `drivers.policyGrantScope` — the `newPermissiveSingleTeamAuthorizer`
 * shape: the default lives with the domain that defines its semantics and
 * is called at the `??` site, never held by the registry.
 *
 * The organization's roles are READ from the proto through
 * `grantableRolesFor`, not written here: the four words the Members page
 * shows and entry 3's authorizer enforces have one source, and a proto
 * change is the only way to change them (grant-scope.test.ts pins the
 * equality; grantable-roles-for.test.ts pins the four).
 */
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { PolicyGrantScope } from "../../extensions/policy-grant-scope.js";
import { grantableRolesFor } from "../../pipeline/apiresource-meta.js";

/** The open-source default: organization → its proto roles; every other kind → none. */
export function newOrganizationOnlyGrantScope(): PolicyGrantScope {
  return {
    grantableRoles(kind) {
      return kind === ApiResourceKind.organization
        ? grantableRolesFor(kind)
        : [];
    },
  };
}
