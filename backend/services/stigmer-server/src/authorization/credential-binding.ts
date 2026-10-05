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
 *   - the bound organization itself;
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
 * blueprint (agent, MCP server, plugin, skill, workflow) shared at
 * `visibility_platform`, and an agent's or workflow's default instance when
 * its blueprint is (the instance's `viewer from default_of`). The inner
 * driver then decides as it always does. Everything else is OUTSIDE and
 * answers `deny` with `BOUND_ELSEWHERE_DENY_REASON`.
 *
 * A target whose row is missing is handed to the inner driver, which keeps
 * "a missing target answers not-found" exactly as it was. A kind whose rows
 * this server cannot read at all is outside: boot refuses a composition
 * that serves such a kind with a schema (`kindsWithoutRows`), so only kinds
 * the model never declares (and no check can allow) reach that arm.
 *
 * An unbound caller skips the rule entirely: no read, the inner driver's
 * answer byte for byte. A bound caller pays one primary-key read per
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
 * permission, a non-default instance), the read memo, a read fault
 * answering unavailable, and the three decorators' unbound byte-identity.
 */
import type { Message } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { AuthorizationScopeType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
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
 * The blueprints the model shares across organizations
 * (`platform_viewer: [identity_provider#platform_user]`), each with the
 * instance kind whose default instance inherits that reach.
 */
const SHARED_BLUEPRINTS: ReadonlyMap<
  ApiResourceKind,
  ApiResourceKind | undefined
> = new Map([
  [ApiResourceKind.agent, ApiResourceKind.agent_instance],
  [ApiResourceKind.workflow, ApiResourceKind.workflow_instance],
  [ApiResourceKind.mcp_server, undefined],
  [ApiResourceKind.plugin, undefined],
  [ApiResourceKind.skill, undefined],
]);

/** The instance kinds, each with the blueprint its default instance follows and the parent relation naming it. */
const DEFAULT_INSTANCE_BLUEPRINTS: ReadonlyMap<
  ApiResourceKind,
  { readonly blueprint: ApiResourceKind; readonly relation: string }
> = new Map([
  [
    ApiResourceKind.agent_instance,
    { blueprint: ApiResourceKind.agent, relation: "agent" },
  ],
  [
    ApiResourceKind.workflow_instance,
    { blueprint: ApiResourceKind.workflow, relation: "workflow" },
  ],
]);

const CAN_VIEW = IamPermission[IamPermission.can_view];

/** The permissions that read or run: the only ones admitted outside. */
const READ_OR_RUN_PERMISSIONS: ReadonlySet<string> = new Set([
  CAN_VIEW,
  IamPermission[IamPermission.can_execute],
  IamPermission[IamPermission.can_create_instance],
]);

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
): CredentialBinding {
  const model = deps.model ?? builtInModel;
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

  async function sharedAcross(
    caller: CallerIdentity,
    kind: ApiResourceKind,
    target: TargetFacts,
  ): Promise<boolean> {
    if (SHARED_BLUEPRINTS.has(kind)) {
      return isSharedVisibility(target.facts.visibility);
    }
    const instance = DEFAULT_INSTANCE_BLUEPRINTS.get(kind);
    if (instance === undefined) {
      return false;
    }
    const blueprintId =
      target.facts.parentLinks.find(
        (link) => link.relation === instance.relation,
      )?.parentId ?? "";
    if (blueprintId === "") {
      return false;
    }
    const blueprint = await targetFacts(
      caller,
      instance.blueprint,
      blueprintId,
    );
    if (blueprint === undefined || blueprint === UNREADABLE) {
      return false;
    }
    return (
      defaultInstanceIdOf(blueprint.row) === target.facts.id &&
      isSharedVisibility(blueprint.facts.visibility)
    );
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
      return target.id === bound ? "inside" : "outside";
    }
    if (target.kind === ApiResourceKind.api_key) {
      return keyVerdict(caller, target.id, bound);
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
      (await sharedAcross(caller, target.kind, found))
    ) {
      return "admitted";
    }
    return "outside";
  }

  return {
    verdict,

    admitsOrganization(caller, org) {
      const bound = boundOrgOf(caller);
      return bound === undefined || bound === org;
    },

    keepsEntry(caller, kind, entry) {
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
        (SHARED_BLUEPRINTS.has(kind) && isSharedVisibility(entry.visibility))
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

/** The Authorizer every chain calls, bound: an outside target is denied before the inner driver is asked. */
export function bindAuthorizer(
  inner: Authorizer,
  binding: CredentialBinding,
): Authorizer {
  return {
    async authorize(caller, check): Promise<AuthzDecision> {
      if (boundOrgOf(caller) === undefined) {
        return inner.authorize(caller, check);
      }
      let verdict: BindingVerdict;
      try {
        verdict = await binding.verdict(caller, targetOf(check));
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

/** The list read scope, bound: candidates outside are dropped before the inner scope sees them. */
export function bindListReadScope(
  inner: ListReadScope,
  binding: CredentialBinding,
): ListReadScope {
  return {
    async authorizedResourceIds(caller, kind) {
      const ids = await inner.authorizedResourceIds(caller, kind);
      return binding.narrowIds(caller, kind, ids, CAN_VIEW);
    },
    restrictListEntries(caller, kind, entries: ReadonlyArray<ListEntryMeta>) {
      if (boundOrgOf(caller) === undefined) {
        return inner.restrictListEntries(caller, kind, entries);
      }
      return inner.restrictListEntries(
        caller,
        kind,
        entries.filter((entry) => binding.keepsEntry(caller, kind, entry)),
      );
    },
  };
}

/** The organization directory, bound: a bound caller's organizations are its own, when the inner directory holds it. */
export function bindOrganizationDirectory(
  inner: OrganizationDirectory,
): OrganizationDirectory {
  const bound: OrganizationDirectory = {
    refusesEnumeration: inner.refusesEnumeration,
    async listMyOrganizationIds(caller) {
      const own = boundOrgOf(caller);
      const ids = await inner.listMyOrganizationIds(caller);
      if (own === undefined) {
        return ids;
      }
      if (ids === ALL_ORGANIZATIONS) {
        return [own];
      }
      return ids.includes(own) ? [own] : [];
    },
  };
  const lookup = inner.lookupExternalOrganization;
  return lookup === undefined
    ? bound
    : { ...bound, lookupExternalOrganization: lookup.bind(inner) };
}

function targetOf(check: AuthzCheck): BindingTarget {
  return {
    kind: check.resourceKind,
    id: check.resourceId,
    permission: IamPermission[check.permission] ?? "",
  };
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
  return visibility === ApiResourceVisibility.visibility_platform;
}

/** `status.default_instance_id`, read structurally from an agent or workflow row. */
function defaultInstanceIdOf(row: Message): string {
  const status = (row as { status?: { defaultInstanceId?: string } }).status;
  return status?.defaultInstanceId ?? "";
}
