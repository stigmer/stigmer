/**
 * Access-list machinery (20260913.01 slice 5): the row-driven answer to
 * "who has access, with which roles" behind `listResourceAccessByPrincipal`
 * — the Java ResourceHierarchyResolver and PrincipalEnricher ports, moved
 * as-is from the cloud's iam/policy/access-lists.ts so every edition
 * renders an access list the same way over its own IamPolicyStore.
 *
 * The hierarchy walk climbs the resource's scope tuples (child →
 * organization → platform, at most five steps, `platform` terminal) in the
 * policy rows themselves — a structural link is a row whose principal is
 * not a person and whose relation is not a role (store.ts `findScopeTuple`
 * states the exclusions). Inherited grants carry their owning level so the
 * console can say "inherited from organization". On open source no chain
 * seeds scope links (a policy is the authorization record, not a protected
 * resource — the IamPolicy chains splice no tuple step), so the walk is one
 * level unless the platform's own pipeline bootstrapped a link.
 *
 * Display enrichment is a seam (`PrincipalDisplayResolver`) because the
 * data lives in the identity-account domain; display-resolver.ts fills it
 * over that domain's PORT. A grantee of any other kind (a team) is named by
 * the edition's `drivers.principalDisplay` when one is composed
 * (extensions/principal-display.ts). A principal nobody answers for — no
 * driver, or an account or team whose row is gone — renders as kind/id
 * with the id standing in as the display name, the Java `enrich()`
 * fallback shape.
 */
import { create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IamPolicy } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/api_pb";
import type {
  ApiResourceRefView,
  PrincipalAccess,
  RoleGrant,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import {
  ApiResourceRefViewSchema,
  PrincipalAccessSchema,
  RoleGrantSchema,
} from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { ApiResourceRefSchema } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/spec_pb";

import type { PrincipalDisplay } from "../../extensions/principal-display.js";
import { kindByEnumName, kindEnumName } from "../../pipeline/apiresource-meta.js";
import { assignableRelations, roleInfoFromRelation } from "./roles.js";
import type { IamPolicyStore } from "./store.js";

/** The Java resolver's bounds: ≤5 steps, platform terminates the walk. */
const MAX_HIERARCHY_DEPTH = 5;
const TERMINAL_KINDS: ReadonlySet<string> = new Set([
  kindEnumName(ApiResourceKind.platform),
]);

export interface HierarchyLevel {
  readonly kind: string;
  readonly id: string;
}

/**
 * Child-first hierarchy via scope-tuple rows (Java resolve): index 0 is
 * the resource itself; each later level is the previous one's structural
 * scope parent.
 */
export async function resolveHierarchy(
  policies: IamPolicyStore,
  resourceKind: string,
  resourceId: string,
  includeInherited: boolean,
): Promise<ReadonlyArray<HierarchyLevel>> {
  const hierarchy: HierarchyLevel[] = [{ kind: resourceKind, id: resourceId }];
  if (!includeInherited) {
    return hierarchy;
  }
  let currentKind = resourceKind;
  let currentId = resourceId;
  for (
    let depth = 0;
    depth < MAX_HIERARCHY_DEPTH && !TERMINAL_KINDS.has(currentKind);
    depth++
  ) {
    const scopeTuple = await policies.findScopeTuple(currentKind, currentId);
    const parent = scopeTuple?.spec?.principal;
    if (parent === undefined) {
      break;
    }
    currentKind = parent.kind;
    currentId = parent.id;
    hierarchy.push({ kind: currentKind, id: currentId });
  }
  return hierarchy;
}

/**
 * The display-enrichment seam (the Java PrincipalEnricher's account half):
 * the views for the identity-account ids it can resolve, keyed by id. Ids
 * it does not answer for fall back below.
 */
export interface PrincipalDisplayResolver {
  resolveIdentityAccounts(
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, ApiResourceRefView>>;
}

/**
 * Groups assignable-role policies by principal in first-seen order (the
 * Java LinkedHashMap contract), enriched where the resolver (people) or
 * the composed principal display (every other kind) answers, and the Java
 * fallback shape (name = id) everywhere else.
 */
export async function buildPrincipalAccessList(
  policies: IamPolicyStore,
  displayResolver: PrincipalDisplayResolver,
  principalDisplay: PrincipalDisplay | undefined,
  hierarchy: ReadonlyArray<HierarchyLevel>,
): Promise<ReadonlyArray<PrincipalAccess>> {
  interface GrantAtLevel {
    readonly policy: IamPolicy;
    readonly isInherited: boolean;
    readonly level: HierarchyLevel;
  }
  const grants: GrantAtLevel[] = [];
  for (const [index, level] of hierarchy.entries()) {
    const rows = await policies.findByResourceWithRelations(
      level.kind,
      level.id,
      assignableRelations(),
    );
    for (const policy of rows) {
      grants.push({ policy, isInherited: index > 0, level });
    }
  }
  if (grants.length === 0) {
    return [];
  }

  const enriched = await resolvePrincipalViews(
    grants.map((g) => g.policy),
    displayResolver,
    principalDisplay,
  );

  const grouped = new Map<
    string,
    { principal: ApiResourceRefView; roles: RoleGrant[] }
  >();
  for (const grant of grants) {
    const principal = grant.policy.spec?.principal;
    if (principal === undefined) {
      continue;
    }
    const key = `${principal.kind}:${principal.id}`;
    let entry = grouped.get(key);
    if (entry === undefined) {
      entry = {
        // The Java enrich() fallback shape for unresolved principals of
        // ANY kind: kind/id with the id standing in as the display name.
        principal:
          enriched.get(key) ??
          create(ApiResourceRefViewSchema, {
            kind: principal.kind,
            id: principal.id,
            name: principal.id,
          }),
        roles: [],
      };
      grouped.set(key, entry);
    }
    entry.roles.push(buildGrant(grant.policy, grant.isInherited, grant.level));
  }

  return [...grouped.values()].map((entry) =>
    create(PrincipalAccessSchema, {
      principal: entry.principal,
      roles: entry.roles,
    }),
  );
}

/**
 * The display views of every distinct principal the rows name, keyed
 * `kind:id` (the grouping key, so two kinds can never share an id's view):
 * people through the identity-account resolver, every other kind the
 * edition's principal display knows through it, one call per kind. A kind
 * string that names no kind (a legacy row) and every kind with no display
 * are simply absent, so the caller's fallback shape names them.
 */
async function resolvePrincipalViews(
  rows: ReadonlyArray<IamPolicy>,
  displayResolver: PrincipalDisplayResolver,
  principalDisplay: PrincipalDisplay | undefined,
): Promise<ReadonlyMap<string, ApiResourceRefView>> {
  const accountKind = kindEnumName(ApiResourceKind.identity_account);
  const idsByKind = new Map<string, Set<string>>();
  for (const row of rows) {
    const principal = row.spec?.principal;
    if (principal === undefined) {
      continue;
    }
    const ids = idsByKind.get(principal.kind) ?? new Set<string>();
    ids.add(principal.id);
    idsByKind.set(principal.kind, ids);
  }

  const views = new Map<string, ApiResourceRefView>();
  for (const [kindName, ids] of idsByKind) {
    let resolved: ReadonlyMap<string, ApiResourceRefView>;
    if (kindName === accountKind) {
      resolved = await displayResolver.resolveIdentityAccounts([...ids]);
    } else {
      const kind = kindByEnumName(kindName);
      if (
        principalDisplay === undefined ||
        kind === ApiResourceKind.api_resource_kind_unknown
      ) {
        continue;
      }
      resolved = await principalDisplay.resolve(kind, [...ids]);
    }
    for (const [id, view] of resolved) {
      views.set(`${kindName}:${id}`, view);
    }
  }
  return views;
}

function buildGrant(
  policy: IamPolicy,
  isInherited: boolean,
  level: HierarchyLevel,
): RoleGrant {
  return create(RoleGrantSchema, {
    role: roleInfoFromRelation(policy.spec?.relation ?? ""),
    isInherited,
    ...(isInherited
      ? {
          ownerResource: create(ApiResourceRefSchema, {
            kind: level.kind,
            id: level.id,
          }),
        }
      : {}),
  });
}
