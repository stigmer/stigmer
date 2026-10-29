/**
 * Access-list machinery: the row-driven answer to
 * "who has access, with which roles" behind `listResourceAccessByPrincipal`
 * — the hierarchy walk and the principal display, here so every edition
 * renders an access list the same way over its own GrantStore.
 *
 * The hierarchy walk climbs the resource's scope tuples (child →
 * organization → platform, at most five steps, `platform` terminal) in the
 * grant rows themselves — a structural link is a row whose principal is
 * not a person and whose relation is not a role (store.ts `findScopeTuple`
 * states the exclusions). Inherited grants carry their owning level so the
 * console can say "inherited from organization". On open source no chain
 * seeds scope links (a grant is the authorization record, not a protected
 * resource — the Grant chains splice no tuple step), so the walk is one
 * level unless the platform's own pipeline bootstrapped a link.
 *
 * Display enrichment is a seam (`PrincipalDisplayResolver`) because the
 * data lives in the identity-account domain; display-resolver.ts fills it
 * over that domain's PORT. A grantee of any other kind (a team) is named by
 * the edition's `drivers.principalDisplay` when one is composed
 * (extensions/principal-display.ts). A principal nobody answers for — no
 * driver, or an account or team whose row is gone — renders as kind/id
 * with the id standing in as the display name (the fallback shape).
 *
 * A resource's list names only people who belong to its organization.
 * The model bounds every direct grant on an organization-scoped object by
 * the organization (fga/model/tenancy/organization.fga `affiliated`: a
 * role row on the organization, or on a child organization an admin or
 * owner row on its parent), and the grant path revokes a departed person's
 * shares, but it keeps their authorship row (grant-path.ts), which reaches
 * nothing while they are away. A row that grants nothing is not access, so
 * an account that holds no role row on the resource's organization, and
 * no admin or owner row on that organization's parent, is left out of
 * that resource's list, read from the same rows (one indexed
 * `findByPrincipal` per listed account) and one read of the organization's
 * `spec.parent_org`. So an agent a parent's admin makes in a child lists
 * them as its owner while they are one of the parent's admins, and stops
 * listing them when they are not. An organization's own list is its roles
 * and is never filtered.
 *
 * Every entry names its grantee exactly as the rows hold it: kind, id AND
 * the relation qualifier (`team:<id>#member`), and entries group by all
 * three. A revoke matches the qualifier exactly (grant-path.ts
 * `findByTriple`), so a list that dropped it would hand the console a
 * grantee whose revoke finds no row and succeeds having deleted nothing.
 */
import { clone, create } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { Grant } from "@stigmer/apis/ai/stigmer/iam/grant/v1/api_pb";
import type {
  ApiResourceRefView,
  PrincipalAccess,
  RoleGrant,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import {
  ApiResourceRefViewSchema,
  PrincipalAccessSchema,
  RoleGrantSchema,
} from "@stigmer/apis/ai/stigmer/iam/grant/v1/io_pb";
import { ApiResourceRefSchema } from "@stigmer/apis/ai/stigmer/iam/grant/v1/spec_pb";

import type { PrincipalDisplay } from "../../extensions/principal-display.js";
import {
  kindByEnumName,
  kindEnumName,
} from "../../pipeline/apiresource-meta.js";
import { loadOrganization, parentOrgOf } from "../organization/children.js";
import type { Store } from "../../store/interface.js";
import { assignableRelations, roleInfoFromRelation } from "./roles.js";
import type { GrantStore } from "./store.js";

const ACCOUNT_KIND = kindEnumName(ApiResourceKind.identity_account);
const ORGANIZATION_KIND = kindEnumName(ApiResourceKind.organization);

/** The parent's roles that make a person an admin of each child (`parent_admin: admin from parent_org`). */
const PARENT_ADMIN_ROLES: ReadonlySet<string> = new Set(["owner", "admin"]);

/** The walk's bounds: ≤5 steps, platform terminates the walk. */
const MAX_HIERARCHY_DEPTH = 5;
const TERMINAL_KINDS: ReadonlySet<string> = new Set([
  kindEnumName(ApiResourceKind.platform),
]);

export interface HierarchyLevel {
  readonly kind: string;
  readonly id: string;
}

/**
 * Child-first hierarchy via scope-tuple rows: index 0 is
 * the resource itself; each later level is the previous one's structural
 * scope parent.
 */
export async function resolveHierarchy(
  grants: GrantStore,
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
    const scopeTuple = await grants.findScopeTuple(currentKind, currentId);
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
 * The display-enrichment seam (its account half):
 * the views for the identity-account ids it can resolve, keyed by id. Ids
 * it does not answer for fall back below.
 */
export interface PrincipalDisplayResolver {
  resolveIdentityAccounts(
    ids: ReadonlyArray<string>,
  ): Promise<ReadonlyMap<string, ApiResourceRefView>>;
}

/**
 * Groups assignable-role grants by principal in first-seen order (the
 * listing's stable order), enriched where the resolver (people) or the
 * composed principal display (every other kind) answers, and the fallback
 * shape (name = id) everywhere else.
 */
export async function buildPrincipalAccessList(
  grantStore: GrantStore,
  organizations: Pick<Store, "getResource">,
  displayResolver: PrincipalDisplayResolver,
  principalDisplay: PrincipalDisplay | undefined,
  hierarchy: ReadonlyArray<HierarchyLevel>,
): Promise<ReadonlyArray<PrincipalAccess>> {
  interface GrantAtLevel {
    readonly grant: Grant;
    readonly isInherited: boolean;
    readonly level: HierarchyLevel;
  }
  const grants: GrantAtLevel[] = [];
  for (const [index, level] of hierarchy.entries()) {
    const rows = await grantStore.findByResourceWithRelations(
      level.kind,
      level.id,
      assignableRelations(),
    );
    for (const grant of rows) {
      grants.push({ grant, isInherited: index > 0, level });
    }
  }
  if (grants.length === 0) {
    return [];
  }
  const departed = await accountsOutsideOrganization(
    grantStore,
    organizations,
    hierarchy,
    grants.map((grant) => grant.grant),
  );
  const current = grants.filter((grant) => {
    const principal = grant.grant.spec?.principal;
    return !(principal?.kind === ACCOUNT_KIND && departed.has(principal.id));
  });
  if (current.length === 0) {
    return [];
  }

  const enriched = await resolvePrincipalViews(
    current.map((g) => g.grant),
    displayResolver,
    principalDisplay,
  );

  const grouped = new Map<
    string,
    { principal: ApiResourceRefView; roles: RoleGrant[] }
  >();
  for (const grant of current) {
    const principal = grant.grant.spec?.principal;
    if (principal === undefined) {
      continue;
    }
    const key = `${principal.kind}:${principal.id}#${principal.relation}`;
    let entry = grouped.get(key);
    if (entry === undefined) {
      const view = enriched.get(`${principal.kind}:${principal.id}`);
      entry = {
        // A resolved view is shared by every qualifier of one grantee, so
        // each entry stamps its own copy. The fallback shape
        // for unresolved principals of ANY kind: kind/id with the id
        // standing in as the display name.
        principal: withRelation(
          view ??
            create(ApiResourceRefViewSchema, {
              kind: principal.kind,
              id: principal.id,
              name: principal.id,
            }),
          principal.relation,
        ),
        roles: [],
      };
      grouped.set(key, entry);
    }
    entry.roles.push(buildGrant(grant.grant, grant.isInherited, grant.level));
  }

  return [...grouped.values()].map((entry) =>
    create(PrincipalAccessSchema, {
      principal: entry.principal,
      roles: entry.roles,
    }),
  );
}

/**
 * The accounts among the rows that hold no row on the resource's
 * organization and no admin or owner row on its parent (the module
 * header's rule). Empty for an organization's own list and for a resource
 * no organization holds.
 */
async function accountsOutsideOrganization(
  grants: GrantStore,
  organizations: Pick<Store, "getResource">,
  hierarchy: ReadonlyArray<HierarchyLevel>,
  rows: ReadonlyArray<Grant>,
): Promise<ReadonlySet<string>> {
  const resource = hierarchy[0];
  if (resource === undefined || resource.kind === ORGANIZATION_KIND) {
    return new Set();
  }
  const levels = hierarchy.some((level) => level.kind === ORGANIZATION_KIND)
    ? hierarchy
    : await resolveHierarchy(grants, resource.kind, resource.id, true);
  const organization = levels.find((level) => level.kind === ORGANIZATION_KIND);
  if (organization === undefined) {
    return new Set();
  }
  const accounts = new Set<string>();
  for (const row of rows) {
    if (row.spec?.principal?.kind === ACCOUNT_KIND) {
      accounts.add(row.spec.principal.id);
    }
  }
  if (accounts.size === 0) {
    return new Set();
  }
  const row = await loadOrganization(organizations, organization.id);
  const parent = row === undefined ? "" : parentOrgOf(row);
  const outside = new Set<string>();
  for (const account of accounts) {
    const held = await grants.findByPrincipal(ACCOUNT_KIND, account);
    const inOrganization = held.some((grant) => {
      const on = grant.spec?.resource;
      if (on?.kind !== ORGANIZATION_KIND) {
        return false;
      }
      return (
        on.id === organization.id ||
        (parent !== "" &&
          on.id === parent &&
          PARENT_ADMIN_ROLES.has(grant.spec?.relation ?? ""))
      );
    });
    if (!inOrganization) {
      outside.add(account);
    }
  }
  return outside;
}

/**
 * The display views of every distinct principal the rows name, keyed
 * `kind:id` (the grouping key, so two kinds can never share an id's view):
 * people through the identity-account resolver, every other kind the
 * edition's principal display knows through it, one call per kind. A kind
 * string that names no kind (a row a composition wrote under a name no
 * ApiResourceKind carries) and every kind with no display
 * are simply absent, so the caller's fallback shape names them.
 */
export async function resolvePrincipalViews(
  rows: ReadonlyArray<Grant>,
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

function withRelation(
  view: ApiResourceRefView,
  relation: string,
): ApiResourceRefView {
  const stamped = clone(ApiResourceRefViewSchema, view);
  stamped.relation = relation;
  return stamped;
}

function buildGrant(
  grant: Grant,
  isInherited: boolean,
  level: HierarchyLevel,
): RoleGrant {
  return create(RoleGrantSchema, {
    role: roleInfoFromRelation(
      grant.spec?.relation ?? "",
      kindByEnumName(level.kind),
    ),
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
