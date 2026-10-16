/**
 * This edition's grant scope — `drivers.grantScope` — and the proto
 * read it is made of; and `isPersonCaller`, who may acquire an
 * organization role at all.
 *
 * Grantable-role resolution reads the proto kind_meta AuthorizationConfig
 * (the shared contract's single source of truth — the same enum-value
 * extension the OSS server's apiresource-meta reads), so adding a
 * grantable role to a kind is a proto change, never a code change here.
 * The read stays this module's own rather than the library's
 * `grantableRolesFor`, which is not on the barrel: a proto read, not a
 * core behaviour, so two copies are not a divergence.
 *
 * What this module does not carry: the assignable-relation allowlist and
 * the role display table are the library's (its five roles and their copy
 * are in `@stigmer/server`'s `domain/grant/roles.ts`, and its access
 * lists read them).
 */
import { getOption, hasOption } from "@bufbuild/protobuf";

import {
  ApiResourceKind,
  ApiResourceKindSchema,
  kind_meta,
} from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamRole } from "@stigmer/apis/ai/stigmer/iam/v1/enum_pb";
import type { CallerIdentity, GrantScope } from "@stigmer/server";

/**
 * The kind's grantable roles from its proto kind_meta AuthorizationConfig.
 * Kinds without metadata grant nothing — the create path's validation
 * refuses them.
 * Total over the enum, the unknown kind included; never throws.
 */
export function grantableRolesFor(
  kind: ApiResourceKind,
): ReadonlyArray<IamRole> {
  const valueDesc = ApiResourceKindSchema.values.find(
    (value) => value.number === kind,
  );
  if (valueDesc === undefined || !hasOption(valueDesc, kind_meta)) {
    return [];
  }
  return getOption(valueDesc, kind_meta).authorization?.grantableRoles ?? [];
}

/**
 * The GrantScope that grants what each kind's `kind_meta` lists, and
 * narrows nothing: what an edition that serves per-resource sharing wants.
 * The OSS `ValidateGrantableRole` step intersects the proto's
 * `grantable_roles` with the scope, so an edition can only NARROW what a
 * kind grants. Total over the enum and synchronous, as the contract
 * requires.
 */
export function newKindMetaGrantScope(): GrantScope {
  return { grantableRoles: grantableRolesFor };
}

/**
 * Whether the caller is a person acting as themselves, and so may acquire
 * an organization role through their own act: redeeming an invitation,
 * founding an organization. The rule is open source's ("the roles are
 * people's": in `@stigmer/server`, `domain/grant/role-lifecycle.ts` and
 * `@stigmer/server`'s `domain/grant/membership.ts` admit only the
 * `user` class), stated again here because a host of this code runs its own
 * lifecycle and its own lanes, where that rule would otherwise never run.
 *
 * The caller class is the request's statement of who is acting, so every
 * other class is refused: the shared guest account a public share mints
 * for anonymous visitors, the schedule and channel system accounts, the
 * sandbox family (whose subject is a person, but whose caller is the agent
 * code holding the token), a runner, a machine, and the server itself.
 *
 * Deliberately admitted: an app user is `user`-class, and its own minted
 * token keeps it in one organization. The library's user-token verifier
 * binds every such token to the minting service account's organization or
 * a child of it, and refuses any other (`@stigmer/server`'s
 * `domain/token/verifier.ts`, pinned by its verifier-and-guard suite).
 * Redeem refuses a credential bound elsewhere (`refuseBoundElsewhere` in
 * iam/invitation/handlers.ts, pinned by the handler suite's app-user case), and the library's organization
 * create admits a bound credential only for a child of its own
 * organization (`@stigmer/server`'s `domain/organization/steps.ts`). So
 * such a user joins only its token's organization or one of that
 * organization's children, and founds only a child of it.
 * The library's `isPersonAccount` answers another question (which
 * accounts the built-in membership rules derive roles for, federated ones
 * excluded) and is not this rule: it would refuse every person who signs
 * in through their organization's own federation issuer.
 */
export function isPersonCaller(caller: CallerIdentity): boolean {
  return caller.callerClass === "user";
}
