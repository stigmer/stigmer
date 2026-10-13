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
 *     an execution included, docs/single-organization.md);
 *   - an API key limited to the bound organization (`spec.bound_org`): a
 *     key is its owner's, but a bound credential manages only the keys
 *     limited where it is, never an unlimited key or one limited elsewhere;
 *   - an organization's service account in the bound organization: an
 *     account belongs to no organization, so a person's account stays
 *     reachable, but a service account is its organization's, and a
 *     credential limited to another may not mint its keys or change it;
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
 * The organization sign-in rule (extensions/organization-sign-in-rule.ts)
 * rides the same target resolution, for every PERSON, bound or not: an
 * organization may require that the people acting in it signed in a
 * particular way (through its SSO provider). It is asked last, only after
 * the inner driver allowed, so it can only turn an allow into a deny and a
 * refusal never tells an outsider that a target exists; its denial carries
 * the refusal the caller reads (`AuthzDecision.refusal`, SSO_REQUIRED).
 * Only callers of class `user` are asked, whatever the transport, so a
 * request the server composes for a person and an automation acting as its
 * creator get that person's answer. A target's organization is the one the
 * binding resolves for its own rule (the organization itself, a row's
 * `metadata.org`, an organization's service account); a person's own
 * account, their API keys and the platform's kinds belong to no
 * organization and are never refused. The list read scope drops the
 * candidates inside an organization that refuses the caller, the
 * organization rows themselves excepted (a person sees that the
 * organization exists, and the refusal says how to get in). With no rule
 * composed, or while no organization requires anything, nothing is read
 * and every answer is the inner driver's. The refusal is remembered per
 * organization for the life of the caller object, as the row reads are.
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
 * byte-identity; the sign-in rule's arms (__tests__/
 * credential-binding.sign-in-rule.test.ts): refused only after an allow,
 * people only, bound and unbound alike, the organization rows kept in a
 * list, the refusal memo, and no reads while nothing is required.
 */
import type { Message } from "@bufbuild/protobuf";
import { isMessage } from "@bufbuild/protobuf";

import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { AuthorizationScopeType } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/authorization_config_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ApiKey } from "@stigmer/protos/ai/stigmer/iam/apikey/v1/api_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";

import type { IamPolicyStore } from "../domain/iampolicy/store.js";
import type { IdentityAccountStore } from "../domain/identityaccount/store.js";
import type { PlatformClientStore } from "../domain/platformclient/store.js";
import type {
  Authorizer,
  AuthzCheck,
  AuthzDecision,
  AuthzRefusal,
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
import type { OrganizationSignInRule } from "../extensions/organization-sign-in-rule.js";
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

/** The rule's answer when it could refuse nobody. */
const NO_ORGANIZATIONS: ReadonlySet<string> = new Set();

/** The denial every bound caller meets outside its organization (deny reason; the Authorize step logs it). */
export const BOUND_ELSEWHERE_DENY_REASON =
  "this credential is bound to another organization";

/**
 * The blueprints the model shares with child organizations
 * (`child_org_viewer: [organization#child_org_viewer]`).
 */
const SHARED_BLUEPRINTS: ReadonlySet<ApiResourceKind> = new Set([
  ApiResourceKind.agent,
  ApiResourceKind.plugin,
  ApiResourceKind.skill,
]);

const CAN_VIEW = IamPermission[IamPermission.can_view];

/**
 * The permissions that read or run: the only ones admitted outside. A
 * plugin's server is checked by whoever may view the plugin; the tools
 * listing still refuses writing into another organization
 * (refuse-bound-elsewhere.ts).
 */
const READ_OR_RUN_PERMISSIONS: ReadonlySet<string> = new Set([
  CAN_VIEW,
  IamPermission[IamPermission.can_execute],
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
  /**
   * The identity-account port the composition bound, for the same reason:
   * a service account belongs to an organization, so a bound credential
   * reaches one only in its own. Absent, every account reads as a person's
   * (a test's binding).
   */
  readonly identityAccounts?: Pick<IdentityAccountStore, "findById">;
  /** The declarations whose schemas decode a row; the built-in model unless a test says otherwise. */
  readonly model?: Model;
  /** The deleting rule's predicate; nothing is deleting when absent (a test's binding). */
  readonly lifecycle?: OrganizationLifecycle;
  /** What an organization requires of how its people signed in (`drivers.organizationSignInRule`); none when absent. */
  readonly signInRule?: OrganizationSignInRule;
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
  /**
   * The refusal the sign-in rule gives `caller` on the target's
   * organization, or undefined when it gives none (no rule, not a person,
   * a target in no organization, an organization that requires nothing,
   * or a sign-in that counts there). Throws on a read fault.
   */
  signInRefusalOn(
    caller: CallerIdentity,
    target: BindingTarget,
  ): Promise<AuthzRefusal | undefined>;
  /**
   * Whether the sign-in rule could refuse `caller` anywhere right now: a
   * rule is composed, the caller is a person, and some organization
   * requires something. False means every `signInRefusalOn` answers
   * undefined without a read.
   */
  signInRuleApplies(caller: CallerIdentity): Promise<boolean>;
  /**
   * The subset of `ids` of `kind` the sign-in rule leaves `caller`: each
   * id's row is read (memoised, a bounded batch at a time) for its
   * organization, and an id inside an organization that refuses them is
   * dropped. The organization kind's ids are kept, as a listed page keeps
   * them. Nothing is read while the rule could refuse nobody.
   */
  narrowSignInIds(
    caller: CallerIdentity,
    kind: ApiResourceKind,
    ids: ReadonlySet<string>,
    permission: string,
  ): Promise<ReadonlySet<string>>;
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
  const signInRule = deps.signInRule;
  const refusals = new WeakMap<
    CallerIdentity,
    Map<string, Promise<AuthzRefusal | undefined>>
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
    if (kind === ApiResourceKind.identity_account && deps.identityAccounts !== undefined) {
      return deps.identityAccounts.findById(id);
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

  // An account belongs to no organization, so a bound credential reaches
  // a person's account as before, but an organization's service account
  // belongs to its organization: a credential limited to another may not
  // mint its keys, list them or change it, though its person administers
  // both organizations.
  async function accountVerdict(
    caller: CallerIdentity,
    id: string,
    bound: string,
  ): Promise<BindingVerdict> {
    if (deps.identityAccounts === undefined) {
      return "inside";
    }
    const found = await targetFacts(caller, ApiResourceKind.identity_account, id);
    if (found === undefined) {
      return "missing";
    }
    // The account port answers accounts only, so the row is one.
    const row = found === UNREADABLE ? undefined : (found.row as IdentityAccount);
    if (row?.spec?.provisioningMode !== IdentityAccountProvisioningMode.service_account) {
      return "inside";
    }
    return (row.metadata?.org ?? "") === bound ? "inside" : "outside";
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
    if (target.kind === ApiResourceKind.identity_account) {
      return accountVerdict(caller, target.id, bound);
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

  /** The organizations the rule could refuse `caller` in; empty when it could refuse nobody. */
  async function requiringFor(
    caller: CallerIdentity,
  ): Promise<ReadonlySet<string>> {
    if (signInRule === undefined || caller.callerClass !== "user") {
      return NO_ORGANIZATIONS;
    }
    return signInRule.requiringOrgs();
  }

  /** The rule's refusal in one organization of `requiring`, remembered per caller. */
  function refusalIn(
    caller: CallerIdentity,
    org: string,
    rule: OrganizationSignInRule,
  ): Promise<AuthzRefusal | undefined> {
    let held = refusals.get(caller);
    if (held === undefined) {
      held = new Map();
      refusals.set(caller, held);
    }
    const known = held.get(org);
    if (known !== undefined) {
      return known;
    }
    const asking = rule.refusal(caller, org);
    held.set(org, asking);
    // A failed read is not remembered: the next check asks again.
    asking.catch(() => held.delete(org));
    return asking;
  }

  async function signInRefusal(
    caller: CallerIdentity,
    org: string,
  ): Promise<AuthzRefusal | undefined> {
    if (signInRule === undefined || org === "") {
      return undefined;
    }
    const requiring = await requiringFor(caller);
    return requiring.has(org) ? refusalIn(caller, org, signInRule) : undefined;
  }

  /**
   * The organization the sign-in rule answers for on a target: the
   * organization itself, an organization's service account's organization,
   * a row's own organization; "" for what belongs to none (a person's
   * account, an API key, the platform's kinds) and for a missing row.
   */
  async function organizationOfTarget(
    caller: CallerIdentity,
    target: BindingTarget,
  ): Promise<string> {
    if (target.kind === ApiResourceKind.organization) {
      return target.id;
    }
    if (target.kind === ApiResourceKind.identity_account) {
      if (deps.identityAccounts === undefined) {
        return "";
      }
      const found = await targetFacts(caller, target.kind, target.id);
      const row =
        found === undefined || found === UNREADABLE
          ? undefined
          : (found.row as IdentityAccount);
      return row?.spec?.provisioningMode ===
        IdentityAccountProvisioningMode.service_account
        ? (row.metadata?.org ?? "")
        : "";
    }
    if (
      target.kind === ApiResourceKind.api_key ||
      !declaresKind(target.kind) ||
      !belongsToAnOrganization(target.kind)
    ) {
      return "";
    }
    const found = await targetFacts(caller, target.kind, target.id);
    return found === undefined || found === UNREADABLE ? "" : found.facts.org;
  }

  async function signInRefusalOn(
    caller: CallerIdentity,
    target: BindingTarget,
  ): Promise<AuthzRefusal | undefined> {
    const requiring = await requiringFor(caller);
    if (requiring.size === 0 || signInRule === undefined) {
      return undefined;
    }
    const org = await organizationOfTarget(caller, target);
    return requiring.has(org) ? refusalIn(caller, org, signInRule) : undefined;
  }

  return {
    verdict,
    deleting,
    signInRefusalOn,

    async signInRuleApplies(caller) {
      return (await requiringFor(caller)).size > 0;
    },

    async narrowSignInIds(caller, kind, ids, permission) {
      if (
        ids.size === 0 ||
        kind === ApiResourceKind.organization ||
        (await requiringFor(caller)).size === 0
      ) {
        return ids;
      }
      const ordered = [...ids];
      const kept = new Set<string>();
      for (let start = 0; start < ordered.length; start += NARROW_BATCH) {
        const batch = ordered.slice(start, start + NARROW_BATCH);
        const answers = await Promise.all(
          batch.map((id) => signInRefusalOn(caller, { kind, id, permission })),
        );
        batch.forEach((id, index) => {
          if (answers[index] === undefined) {
            kept.add(id);
          }
        });
      }
      return kept;
    },

    signInRefusal,

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
      if (boundOrgOf(caller) !== undefined) {
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
      }
      const decision = await inner.authorize(caller, check);
      if (decision.kind !== "allow") {
        return decision;
      }
      // Last, and only on an allow: the rule can only refuse, and a
      // refusal must never tell an outsider the target exists.
      let refusal: AuthzRefusal | undefined;
      try {
        refusal = await binding.signInRefusalOn(caller, target);
      } catch (error) {
        return {
          kind: "unavailable",
          cause: error instanceof Error ? error : new Error(String(error)),
        };
      }
      return refusal === undefined
        ? decision
        : { kind: "deny", reason: refusal.message, refusal };
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
      const narrowed = await binding.narrowIds(caller, kind, live, CAN_VIEW);
      return binding.narrowSignInIds(caller, kind, narrowed, CAN_VIEW);
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
      let candidates: ReadonlyArray<ListEntryMeta> = live;
      if (boundOrgOf(caller) !== undefined) {
        const kept = await Promise.all(
          live.map((entry) => binding.keepsEntry(caller, kind, entry)),
        );
        candidates = live.filter((_, index) => kept[index] === true);
      }
      const visible = await inner.restrictListEntries(caller, kind, candidates);
      return withoutSignInRefusedEntries(caller, kind, candidates, visible);
    },
  };

  /**
   * The entries a person may keep in a list after the sign-in rule: an
   * entry inside an organization that refuses them is dropped, by the
   * organization it carries. An organization's own row is kept, so the
   * person still sees that it exists; reaching into it answers the refusal.
   */
  async function withoutSignInRefusedEntries(
    caller: CallerIdentity,
    kind: ApiResourceKind,
    entries: ReadonlyArray<ListEntryMeta>,
    visible: ReadonlySet<string>,
  ): Promise<ReadonlySet<string>> {
    if (
      visible.size === 0 ||
      kind === ApiResourceKind.organization ||
      !belongsToAnOrganization(kind) ||
      !(await binding.signInRuleApplies(caller))
    ) {
      return visible;
    }
    const shown = entries.filter((entry) => visible.has(entry.id));
    const refused = await Promise.all(
      shown.map(
        async (entry) =>
          (await binding.signInRefusal(caller, entry.org)) !== undefined,
      ),
    );
    return new Set(
      shown.filter((_, index) => refused[index] !== true).map((entry) => entry.id),
    );
  }


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

/** Whether rows of `kind` belong to one organization: organization-scoped, or scoped to a parent that is. */
export function belongsToAnOrganization(kind: ApiResourceKind): boolean {
  const scope = getKindMeta(kind).authorization?.scopeType;
  return (
    scope === AuthorizationScopeType.ORGANIZATION ||
    scope === AuthorizationScopeType.PARENT
  );
}

function isSharedVisibility(visibility: ApiResourceVisibility): boolean {
  return visibility === ApiResourceVisibility.visibility_child_orgs;
}
