/**
 * The credential binding: a credential that names an organization works in
 * that organization only. A PlatformClient user token names its client's
 * organization, an API key may be limited to one, and a composition's
 * verifiers bind the tokens they vouch for the same way; each sets
 * `CallerIdentity.boundOrg`. A person signed in at a console names none and
 * keeps every organization they hold a role in.
 *
 * Why one rule here and not a check per lane. A binding limits which of a
 * person's memberships count; it is not a relation the authorization model
 * can hold (the evaluator refuses conditions, and `agent_execution` has no
 * organization link of its own), and per-lane gates would have to cover
 * every by-id call, which names no organization. So the composition root
 * wraps the three decision drivers it resolves (the Authorizer, the list
 * read scope and the organization directory) with this rule, whatever the
 * posture chose, a unit's registration included, and a handful of handler
 * seats that act on an organization without the Authorizer call the same
 * module. Every consumer that reads the composed drivers is bound by
 * construction.
 *
 * The rule, for a caller with `boundOrg`. A target is INSIDE when it is:
 *   - the bound organization itself, and, for a permission that manages
 *     an organization (MANAGEMENT_PERMISSIONS: its settings, members,
 *     access and billing), a child organization of the bound one: managing
 *     an organization's children is managing the organization, and
 *     `can_manage_child_orgs` (finding and listing them) is asked on the
 *     bound organization itself. The child's rows stay outside;
 *   - a row of an organization-scoped or parent-scoped kind whose
 *     `metadata.org` is the bound organization (every such row carries it,
 *     an execution included, docs/single-organization.md), and an
 *     execution context whose `metadata.org` is: the kind is owner-only,
 *     but each row is its run's (or connect's) and holds that
 *     organization's resolved environment values;
 *   - an API key limited to the bound organization (`spec.bound_org`): a
 *     key is its owner's, but a bound credential manages only the keys
 *     limited where it is, never an unlimited key or one limited elsewhere;
 *   - a kind that belongs to no organization: owner-only (the person's own
 *     account) or unscoped (plans, the platform). These are nobody's
 *     organization data.
 * It is ADMITTED OUTSIDE only along the model's one path across
 * organizations, and only for a permission that reads or runs: a
 * blueprint (agent, MCP server, plugin, skill) that the bound
 * organization's own parent shares with its children at
 * `visibility_child_orgs` (connecting is how an MCP server runs). A
 * blueprint another organization shares with
 * its children is outside, even when the person belongs to one of them
 * too: the credential names this child, and only its parent's catalog
 * reaches it. The bound organization's parent is read once per request,
 * from its row. The inner
 * driver then decides as it always does. Everything else is OUTSIDE and
 * answers `deny` with `BOUND_ELSEWHERE_DENY_REASON`.
 *
 * A target whose row is missing is handed to the inner driver, which keeps
 * "a missing target answers not-found" exactly as it was. A kind whose rows
 * this server cannot read at all is outside: boot refuses a composition
 * that serves such a kind with a schema (`kindsWithoutRows`), so only kinds
 * the model never declares (and no check can allow) reach that arm.
 *
 * The deleting rule's decision seat (domain/organization/lifecycle.ts)
 * rides the same target resolution, for EVERY caller, bound or not: a
 * target that is an organization being deleted, or a row whose
 * `metadata.org` is one, answers `not-found` before anything else is
 * asked, so a per-resource owner row the delete's revocation leaves
 * cannot reach the row. It shares the memoised row read below, so a bound
 * caller pays nothing more for it; an unbound caller's by-id check pays
 * the target's row read and the memoised deletion read. The list read
 * scope leaves such rows out, and the organization directory such
 * organizations, for every caller.
 *
 * An unbound caller skips the binding rule entirely: no read for it, the
 * inner driver's answer byte for byte. A bound caller pays one primary-key read per
 * distinct target per request: a target's organization is memoised for the
 * life of the caller object (the interceptor stamps one identity object
 * per request), so the Authorizer's signature carries nothing new.
 *
 * Rows are read where the built-in authorizer reads them: a unit's
 * registered reader for the kinds a unit keeps itself, the IamPolicy and
 * PlatformClient ports a composition may substitute (their rows are not
 * the generic store's when it does), and the generic store with the model's
 * schema for every other kind.
 *
 * What the tests pin (__tests__/credential-binding.test.ts): every scope
 * class, the missing row, the admitted path and its limits (visibility,
 * the sharing organization, permission), a
 * parent's management of its children and its limits, the read memo, a
 * read fault answering unavailable, and the three decorators' unbound
 * byte-identity.
 */
import type { Message } from "@bufbuild/protobuf";
import { isMessage } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { AuthorizationScopeType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { IamPolicyStore } from "../domain/iampolicy/store.js";
import type { PlatformClientStore } from "../domain/platformclient/store.js";
import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
} from "../extensions/authorizer.js";
import type {
  BindingTarget,
  BindingVerdict,
  CredentialBinding,
} from "../extensions/credential-binding.js";
import type { CallerIdentity } from "../extensions/identity.js";
import { boundOrgOf } from "../extensions/identity.js";
import type {
  ListEntryMeta,
  ListReadScope,
} from "../extensions/list-read-scope.js";
import type { OrganizationDirectory } from "../extensions/organization-directory.js";
import { ALL_ORGANIZATIONS } from "../extensions/organization-directory.js";
import type { RowAuthorizationFacts } from "../extensions/resource-authorization.js";
import { NOTHING_DELETING } from "../domain/organization/lifecycle.js";
import type { OrganizationLifecycle } from "../domain/organization/lifecycle.js";
import type { ResourceRowReader } from "../extensions/resource-row-reader.js";
import { getKindMeta } from "../pipeline/apiresource-meta.js";
import { rowAuthorizationFactsOf } from "../pipeline/steps/authorization-facts.js";
import type { Store } from "../store/interface.js";
import { ResourceNotFoundError } from "../store/interface.js";
import type { Model } from "./model/index.js";
import { builtInModel } from "./model/index.js";

/** How many target rows `narrowIds` reads at once. */
const NARROW_BATCH = 16;

/** The denial every bound caller meets outside its organization (deny reason; the Authorize step logs it). */
export const BOUND_ELSEWHERE_DENY_REASON =
  "this credential is bound to another organization";

/**
 * The blueprints the model shares with child organizations
 * (`child_org_viewer: [organization#child_org_viewer]`).
 */
const SHARED_BLUEPRINTS: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.agent,
  ApiResourceKind.mcp_server,
  ApiResourceKind.plugin,
  ApiResourceKind.skill,
]);

const CAN_VIEW = IamPermission[IamPermission.can_view];

/**
 * The permissions that read or run: the only ones admitted outside. An MCP
 * server is run by connecting to it (its model derives `can_connect` from
 * `viewer`, and it has no `can_execute`); the connect lanes still refuse
 * writing into another organization (refuse-bound-elsewhere.ts).
 */
const READ_OR_RUN_PERMISSIONS: ReadonlySet<string> = new Set([
  CAN_VIEW,
  IamPermission[IamPermission.can_execute],
  IamPermission[IamPermission.can_connect],
]);

/**
 * The permissions that manage an organization without reading what it
 * holds: the ones the model gives a parent's admins on a child
 * (`parent_admin`, fga/model/tenancy/organization.fga), and the only ones
 * a credential bound to the parent reaches on a child.
 */
const MANAGEMENT_PERMISSIONS: ReadonlySet<string> = new Set(
  [
    IamPermission.can_view_settings,
    IamPermission.can_edit,
    IamPermission.can_delete,
    IamPermission.can_grant_access,
    IamPermission.can_view_access,
    IamPermission.can_assign_roles,
    IamPermission.can_view_billing,
  ].map((permission) => IamPermission[permission]),
);

export interface CredentialBindingDeps {
  readonly store: Pick<Store, "getResource">;
  /** The readers of the kinds units keep themselves (`drivers.resourceRowReaders`). */
  readonly rowReaders?: ReadonlyMap<ApiResourceKind, ResourceRowReader>;
  /** The IamPolicy port the composition bound (a composition may keep the rows in its own table). */
  readonly policies: Pick<IamPolicyStore, "findById">;
  /** The PlatformClient port the composition bound, for the same reason. */
  readonly platformClients: Pick<PlatformClientStore, "findById">;
  /** The declarations whose schemas decode a row; the built-in model unless a test says otherwise. */
  readonly model?: Model;
  /** The deleting rule's predicate; nothing is deleting when absent (a test's binding). */
  readonly lifecycle?: OrganizationLifecycle;
}

/**
 * The binding as the composition root holds it: the seam's rule plus the
 * deleting rule's decision seat, which shares the rule's memoised row
 * read and so is not part of the seam a unit receives.
 */
export interface ComposedCredentialBinding extends CredentialBinding {
  /**
   * Whether the target is, or belongs to, an organization being deleted,
   * for any caller. A missing row is not deleting (the inner driver
   * answers it). Throws on a read fault.
   */
  deleting(caller: CallerIdentity, target: BindingTarget): Promise<boolean>;
}

/** What the rule reads from a target's row. */
interface TargetFacts {
  readonly facts: RowAuthorizationFacts;
  readonly row: Message;
}

/** A row read the rule cannot make: the kind has no schema and no reader. */
const UNREADABLE = Symbol("unreadable");

export function newCredentialBinding(
  deps: CredentialBindingDeps,
): ComposedCredentialBinding {
  const model = deps.model ?? builtInModel;
  const lifecycle = deps.lifecycle ?? NOTHING_DELETING;
  const memo = new WeakMap<
    CallerIdentity,
    Map<string, Promise<TargetFacts | undefined | typeof UNREADABLE>>
  >();

  function loadRow(
    kind: ApiResourceKind,
    id: string,
  ): Promise<Message | undefined | typeof UNREADABLE> {
    const reader = deps.rowReaders?.get(kind);
    if (reader !== undefined) {
      return reader.findById(id);
    }
    if (kind === ApiResourceKind.iam_policy) {
      return deps.policies.findById(id);
    }
    if (kind === ApiResourceKind.platform_client) {
      return deps.platformClients.findById(id);
    }
    const schema = model.byKind(kind)?.schema;
    if (schema === undefined) {
      return Promise.resolve(UNREADABLE);
    }
    return deps.store.getResource(kind, id, schema).catch((error: unknown) => {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    });
  }

  function targetFacts(
    caller: CallerIdentity,
    kind: ApiResourceKind,
    id: string,
  ): Promise<TargetFacts | undefined | typeof UNREADABLE> {
    let held = memo.get(caller);
    if (held === undefined) {
      held = new Map();
      memo.set(caller, held);
    }
    const key = `${kind}:${id}`;
    const known = held.get(key);
    if (known !== undefined) {
      return known;
    }
    const loading = loadRow(kind, id).then((row) =>
      row === undefined || row === UNREADABLE
        ? row
        : { row, facts: rowAuthorizationFactsOf(kind, row) },
    );
    held.set(key, loading);
    // A failed read is not remembered: the next check asks again.
    loading.catch(() => held.delete(key));
    return loading;
  }

  /** The parent of the organization `id`; "" when it has none or its row is gone. */
  async function parentOf(
    caller: CallerIdentity,
    id: string,
  ): Promise<string> {
    const found = await targetFacts(caller, ApiResourceKind.organization, id);
    return found === undefined ||
      found === UNREADABLE ||
      !isMessage(found.row, OrganizationSchema)
      ? ""
      : (found.row.spec?.parentOrg ?? "");
  }

  /** Whether a row is shared with the children of the bound organization's own parent. */
  async function sharedWithBound(
    caller: CallerIdentity,
    bound: string,
    facts: Pick<RowAuthorizationFacts, "org" | "visibility">,
  ): Promise<boolean> {
    if (!isSharedVisibility(facts.visibility) || facts.org === "") {
      return false;
    }
    return facts.org === (await parentOf(caller, bound));
  }

  async function sharedAcross(
    caller: CallerIdentity,
    bound: string,
    kind: ApiResourceKind,
    target: TargetFacts,
  ): Promise<boolean> {
    return (
      SHARED_BLUEPRINTS.has(kind) &&
      (await sharedWithBound(caller, bound, target.facts))
    );
  }

  /**
   * An organization target for a bound caller: its own organization, or,
   * for a management permission, one of its children; a missing row is
   * the inner driver's to answer.
   */
  async function organizationVerdict(
    caller: CallerIdentity,
    target: BindingTarget,
    bound: string,
  ): Promise<BindingVerdict> {
    if (target.id === bound) {
      return "inside";
    }
    if (!MANAGEMENT_PERMISSIONS.has(target.permission)) {
      return "outside";
    }
    const found = await targetFacts(
      caller,
      ApiResourceKind.organization,
      target.id,
    );
    if (found === undefined) {
      return "missing";
    }
    return found !== UNREADABLE &&
      isMessage(found.row, OrganizationSchema) &&
      (found.row.spec?.parentOrg ?? "") === bound
      ? "inside"
      : "outside";
  }

  // A key is its owner's, but a bound credential manages only the keys
  // limited to its own organization: an unlimited key, or one limited to
  // another, would let it widen its reach (extend that key, or mint around
  // its own limit).
  async function keyVerdict(
    caller: CallerIdentity,
    id: string,
    bound: string,
  ): Promise<BindingVerdict> {
    const found = await targetFacts(caller, ApiResourceKind.api_key, id);
    if (found === undefined) {
      return "missing";
    }
    return found !== UNREADABLE &&
      (found.row as ApiKey).spec?.boundOrg === bound
      ? "inside"
      : "outside";
  }

  async function verdict(
    caller: CallerIdentity,
    target: BindingTarget,
  ): Promise<BindingVerdict> {
    const bound = boundOrgOf(caller);
    if (bound === undefined) {
      return "unbound";
    }
    if (target.kind === ApiResourceKind.organization) {
      return organizationVerdict(caller, target, bound);
    }
    if (target.kind === ApiResourceKind.api_key) {
      return keyVerdict(caller, target.id, bound);
    }
    if (!declaresKind(target.kind)) {
      // A kind the contract never declared (an unrecognised stored kind)
      // holds nothing a check can allow.
      return "outside";
    }
    if (!belongsToAnOrganization(target.kind)) {
      return "inside";
    }
    const found = await targetFacts(caller, target.kind, target.id);
    if (found === UNREADABLE) {
      return "outside";
    }
    if (found === undefined) {
      return "missing";
    }
    if (found.facts.org === bound) {
      return "inside";
    }
    if (
      READ_OR_RUN_PERMISSIONS.has(target.permission) &&
      (await sharedAcross(caller, bound, target.kind, found))
    ) {
      return "admitted";
    }
    return "outside";
  }

  async function deleting(
    caller: CallerIdentity,
    target: BindingTarget,
  ): Promise<boolean> {
    if (lifecycle === NOTHING_DELETING || target.id === "") {
      return false;
    }
    // While nothing is being deleted (nearly always), no row is read.
    const deletingIds = await lifecycle.deletingIds(caller);
    if (deletingIds.size === 0) {
      return false;
    }
    if (target.kind === ApiResourceKind.organization) {
      return deletingIds.has(target.id);
    }
    if (!declaresKind(target.kind) || !belongsToAnOrganization(target.kind)) {
      return false;
    }
    const found = await targetFacts(caller, target.kind, target.id);
    if (found === undefined || found === UNREADABLE) {
      return false;
    }
    return deletingIds.has(found.facts.org);
  }

  return {
    verdict,
    deleting,

    admitsOrganization(caller, org) {
      const bound = boundOrgOf(caller);
      return bound === undefined || bound === org;
    },

    async keepsEntry(caller, kind, entry) {
      const bound = boundOrgOf(caller);
      if (bound === undefined) {
        return true;
      }
      if (kind === ApiResourceKind.organization) {
        return entry.id === bound;
      }
      if (!belongsToAnOrganization(kind)) {
        return true;
      }
      return (
        entry.org === bound ||
        (SHARED_BLUEPRINTS.has(kind) &&
          (await sharedWithBound(caller, bound, entry)))
      );
    },

    async narrowIds(caller, kind, ids, permission) {
      if (boundOrgOf(caller) === undefined) {
        return ids;
      }
      // One primary-key read per id, a bounded batch at a time: the
      // enumeration a search hands over spans every organization the
      // person belongs to.
      const kept = new Set<string>();
      const ordered = [...ids];
      for (let start = 0; start < ordered.length; start += NARROW_BATCH) {
        const batch = ordered.slice(start, start + NARROW_BATCH);
        const verdicts = await Promise.all(
          batch.map((id) => verdict(caller, { kind, id, permission })),
        );
        batch.forEach((id, index) => {
          const answer = verdicts[index];
          if (answer === "inside" || answer === "admitted") {
            kept.add(id);
          }
        });
      }
      return kept;
    },
  };
}

/**
 * The Authorizer every chain calls, bound: a target in an organization
 * being deleted is not found, for any caller; an outside target is denied
 * before the inner driver is asked.
 */
export function bindAuthorizer(
  inner: Authorizer,
  binding: ComposedCredentialBinding,
): Authorizer {
  return {
    async authorize(caller, check): Promise<AuthzDecision> {
      const target = targetOf(check);
      try {
        if (await binding.deleting(caller, target)) {
          return { kind: "not-found" };
        }
      } catch (error) {
        return {
          kind: "unavailable",
          cause: error instanceof Error ? error : new Error(String(error)),
        };
      }
      if (boundOrgOf(caller) === undefined) {
        return inner.authorize(caller, check);
      }
      let verdict: BindingVerdict;
      try {
        verdict = await binding.verdict(caller, target);
      } catch (error) {
        return {
          kind: "unavailable",
          cause: error instanceof Error ? error : new Error(String(error)),
        };
      }
      if (verdict === "outside") {
        return { kind: "deny", reason: BOUND_ELSEWHERE_DENY_REASON };
      }
      return inner.authorize(caller, check);
    },
  };
}

/**
 * The list read scope, bound: candidates of an organization being deleted
 * are dropped for every caller, and candidates outside a bound caller's
 * organization, before the inner scope sees them. The deleting set is read
 * once per call (the table holds only unfinished purges); when it is empty
 * nothing else is read.
 */
export function bindListReadScope(
  inner: ListReadScope,
  binding: ComposedCredentialBinding,
  lifecycle: OrganizationLifecycle = NOTHING_DELETING,
): ListReadScope {
  return {
    async authorizedResourceIds(caller, kind) {
      const ids = await inner.authorizedResourceIds(caller, kind);
      const live = await withoutDeleting(caller, kind, ids);
      return binding.narrowIds(caller, kind, live, CAN_VIEW);
    },
    async restrictListEntries(
      caller,
      kind,
      entries: ReadonlyArray<ListEntryMeta>,
    ) {
      const deletingIds = await lifecycle.deletingIds(caller);
      const live =
        deletingIds.size === 0
          ? entries
          : entries.filter(
              (entry) =>
                !deletingIds.has(
                  kind === ApiResourceKind.organization ? entry.id : entry.org,
                ),
            );
      if (boundOrgOf(caller) === undefined) {
        return inner.restrictListEntries(caller, kind, live);
      }
      const kept = await Promise.all(
        live.map((entry) => binding.keepsEntry(caller, kind, entry)),
      );
      return inner.restrictListEntries(
        caller,
        kind,
        live.filter((_, index) => kept[index] === true),
      );
    },
  };

  async function withoutDeleting(
    caller: CallerIdentity,
    kind: ApiResourceKind,
    ids: ReadonlySet<string>,
  ): Promise<ReadonlySet<string>> {
    const deletingIds = await lifecycle.deletingIds(caller);
    if (deletingIds.size === 0) {
      return ids;
    }
    if (kind === ApiResourceKind.organization) {
      return new Set([...ids].filter((id) => !deletingIds.has(id)));
    }
    const ordered = [...ids];
    const live = new Set<string>();
    for (let start = 0; start < ordered.length; start += NARROW_BATCH) {
      const batch = ordered.slice(start, start + NARROW_BATCH);
      const answers = await Promise.all(
        batch.map((id) =>
          binding.deleting(caller, { kind, id, permission: CAN_VIEW }),
        ),
      );
      batch.forEach((id, index) => {
        if (answers[index] !== true) {
          live.add(id);
        }
      });
    }
    return live;
  }
}

/**
 * The organization directory, bound: an organization being deleted is
 * nobody's; a bound caller's organizations are its own, when the inner
 * directory holds it. `ALL_ORGANIZATIONS` passes through, and the
 * organization lanes leave deleting organizations out of what they list.
 */
export function bindOrganizationDirectory(
  inner: OrganizationDirectory,
  lifecycle: OrganizationLifecycle = NOTHING_DELETING,
): OrganizationDirectory {
  const bound: OrganizationDirectory = {
    refusesEnumeration: inner.refusesEnumeration,
    async listMyOrganizationIds(caller) {
      const own = boundOrgOf(caller);
      const listed = await inner.listMyOrganizationIds(caller);
      const deletingIds =
        listed === ALL_ORGANIZATIONS
          ? new Set<string>()
          : await lifecycle.deletingIds(caller);
      const ids =
        listed === ALL_ORGANIZATIONS || deletingIds.size === 0
          ? listed
          : listed.filter((id) => !deletingIds.has(id));
      if (own === undefined) {
        return ids;
      }
      if (ids === ALL_ORGANIZATIONS) {
        return (await lifecycle.isDeleting(caller, own)) ? [] : [own];
      }
      return ids.includes(own) ? [own] : [];
    },
  };
  return bound;
}

function targetOf(check: AuthzCheck): BindingTarget {
  return {
    kind: check.resourceKind,
    id: check.resourceId,
    permission: IamPermission[check.permission] ?? "",
  };
}

/** Whether the contract declares `kind` (its `kind_meta`); an unknown kind does not. */
function declaresKind(kind: ApiResourceKind): boolean {
  try {
    getKindMeta(kind);
    return true;
  } catch {
    return false;
  }
}

/** Whether rows of `kind` belong to one organization: organization-scoped, scoped to a parent that is, or an execution context (its run's). */
export function belongsToAnOrganization(kind: ApiResourceKind): boolean {
  if (kind === ApiResourceKind.execution_context) {
    return true;
  }
  const scope = getKindMeta(kind).authorization?.scopeType;
  return (
    scope === AuthorizationScopeType.ORGANIZATION ||
    scope === AuthorizationScopeType.PARENT
  );
}

function isSharedVisibility(visibility: ApiResourceVisibility): boolean {
  return visibility === ApiResourceVisibility.visibility_child_orgs;
}
