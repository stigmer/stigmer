/**
 * The open-source membership rules (20260913.01, T01_0_plan.md §3a;
 * T01_1_review.md Q-OR-6b, Q-OR-6c; slice 4 rulings Q-S4-2 to Q-S4-7):
 * how organization roles come to exist on a self-host that has no
 * administrator to grant them. Core code, installed only under the
 * built-in authorization posture (boot/compose.ts `builtInAuthorization`:
 * no unit registered an Authorizer); a composition with its own
 * Authorizer has its own onboarding and never constructs this.
 *
 * Three moments, one set of arms (`roleFor`, the pure function the first
 * and third share):
 *
 *   onAccountCreated(account, caller) — a person's FIRST provisioning, and
 *   only that (the identity-account domain's AccountCreatedHook, run by
 *   provisionMyAccount on the call whose `created` is true). For every
 *   organization the account holds no row on, in this order:
 *     1. `owner`  — the organization's creator stamp is this account (its
 *                   subject or its id): the founder, who founded it
 *                   idp-shaped before any row existed;
 *     2. `admin`  — this account created a blueprint in it (BLUEPRINT_KINDS,
 *                   constants.ts: the kinds an admin authors; sessions and
 *                   executions are personal and confer nothing, DD-002
 *                   rule 2);
 *     3. `admin`  — the account's email is the configured operator email
 *                   (an empty configuration matches nobody);
 *     4. `admin`  — the organization has ZERO role rows and no PERSON other
 *                   than this account created it or any blueprint in it:
 *                   the fresh install's first caller, and the
 *                   trusted-local-turned-OIDC laptop whose stamps are all
 *                   "system". "Zero rows", never "no admin now" — revoking
 *                   every admin of a bootstrapped organization must not
 *                   hand it to the next stranger (plan finding 2); and the
 *                   founder's own stamp counts as a person (Q-S4-7), so a
 *                   revoked founder's empty organization is not handed
 *                   over either;
 *     5. `member` — everyone else.
 *   Arms 3 and 4 both answer `admin`; 3 is checked first because it is a
 *   string compare and 4 reads the organization's rows. `user`-class
 *   callers only (Q-OR-6b): a runner, a machine or the in-process class
 *   never earns a role. Nothing on an organization the account already
 *   holds a row on, so a run that faulted midway converges on the next.
 *
 *   ensureOperatorOwnership(operator) — the trusted-local boot ensure
 *   (Q-OR-6c): the laptop's operator becomes `owner` of every organization
 *   that has NO owner row. "No owner row", not "no row of this operator"
 *   (Q-S4-3): a boot-time write never overrides a human grant recorded
 *   under an earlier OIDC life of the same database, and the permissive
 *   Authorizer admits the operator regardless. A second boot writes
 *   nothing. The row is granted AS the operator — the trusted-local
 *   identity shape (empty issuer and token) carrying the account's id,
 *   email and name — so its audit actor reads like every other write on
 *   that laptop.
 *
 *   ensureRolesForExistingAccounts() — the built-in posture's boot
 *   reconciliation, ONCE per database. The first moment runs only on the
 *   call that CREATES an account, so a self-host whose people were
 *   provisioned before the rules existed (3.15.x with OIDC on) holds
 *   accounts with no role rows, and under an enforcing authorizer every
 *   one of them would be an outsider on every organization with nobody
 *   able to grant a way back. At the first boot where the bootstrap-state
 *   marker (ROLES_RECONCILED_KEY) is absent, the arms above run for every
 *   PERSON account (`isPersonAccount`: not a machine account, the row-
 *   level twin of the `user`-class gate), acting as that account, in
 *   creation order — the order the sign-ins would have run the hook in,
 *   so arm 4 hands an unclaimed organization to its first sign-in and
 *   not to whoever sorts first by id — and the marker is written after
 *   the last account. A fault propagates and the boot fails loudly (the
 *   storage stage's posture) with the marker unset; the grant path is
 *   idempotent and an organization already held is skipped, so the next
 *   boot converges. The marker, not "zero rows", is what makes it
 *   one-shot: a database whose every role was revoked after the marker is
 *   never handed back to anyone by a reboot (plan finding 2's reason,
 *   applied to the whole store). Accounts are read through the generic
 *   Store as the organizations and blueprints are (Q-S4-5) — the account
 *   port carries no enumeration, by its own rule that a port does not
 *   carry a method only one edition calls, and this act is open source's.
 *
 * What a creator stamp is. The rules read `status.audit.spec_audit
 * .created_by.id` off organizations and blueprints. That stamp is the
 * caller's identityId at the time: a provisioned caller's ACCOUNT id, an
 * unprovisioned caller's raw issuer SUBJECT, and — under the trusted-local
 * posture — the operator's EMAIL or the "system" placeholder
 * (pipeline/interceptors/auth.ts trustedLocalIdentityFor). So "mine" is
 * "equals my subject or my id" (an email stamp is nobody's by this rule;
 * the operator is covered by arm 3 and by ensureOperatorOwnership), and a
 * stamp is a PERSON when it is non-empty and not the "system" placeholder
 * (SYSTEM_OPERATOR_IDENTITY_ID, the one home of that word — Q-S4-6). The
 * rules classify stamps by shape and consult no account store (Q-S4-5).
 *
 * Reads. Policy rows through the IamPolicyStore PORT (`policies`, the
 * same instance the grant path writes through) — never around it
 * (Q-S4-5). Organizations and blueprints through the generic Store,
 * decoded with each kind's own schema (CREATOR_SCAN_SCHEMAS; Q-S4-2: the
 * envelope shares its field numbers but each status carries its audit
 * under its own, so no generic decode exists). Cost, measured in the
 * entry's execution record: one scan of each of seven kinds and one row
 * read per organization, once per account creation.
 *
 * The window this design accepts (Q-S4-4). A store fault after the
 * account row persisted fails the request INTERNAL (the controller's
 * mapping) with the account in place; later calls answer `created:
 * false`, so the rules never run again for that person. The writes ride
 * the idempotent grant path, so a partial run leaves only correct rows,
 * and the recovery is an administrator's grant — or, on a fresh install,
 * arm 3 at the operator's own sign-in. An account created through the
 * `create` RPC (the platform's own pipelines, cloud#393) never reaches
 * this hook either: the rules are about a person signing in.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { fromBinary } from "@bufbuild/protobuf";

import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { McpServerSchema } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ScheduleSchema } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { SkillSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/api_pb";
import { WorkflowSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { CallerIdentity } from "../../extensions/identity.js";
import { kindEnumName } from "../../pipeline/apiresource-meta.js";
import { SYSTEM_OPERATOR_IDENTITY_ID } from "../../pipeline/interceptors/auth.js";
import { auditOf } from "../../pipeline/steps/defaults.js";
import { metadataOf } from "../../pipeline/steps/shapes.js";
import type { Store } from "../../store/interface.js";
import { rfc3339Seconds } from "../../store/rfc3339.js";
import { accountAsCaller } from "../identityaccount/actor.js";
import type { AccountCreatedHook } from "../identityaccount/provisioning.js";
import { BLUEPRINT_KINDS, ROLES_RECONCILED_KEY } from "./constants.js";
import type { IamPolicyGrantPath } from "./grant-path.js";
import { organizationRole, relationOf } from "./specs.js";
import type { IamPolicyStore } from "./store.js";

export interface MembershipRulesDeps {
  readonly grantPath: IamPolicyGrantPath;
  /** The port the grant path writes through — read here for "holds a row", "zero rows", "has an owner". */
  readonly policies: IamPolicyStore;
  readonly store: Store;
  /** STIGMER_OPERATOR_EMAIL as the operator seam holds it; "" when unconfigured. */
  readonly operatorEmail: string;
}

export interface MembershipRules extends AccountCreatedHook {
  /** The trusted-local boot ensure: `owner` wherever no owner row exists. */
  ensureOperatorOwnership(operator: IdentityAccount): Promise<void>;
  /** The built-in posture's boot reconciliation: the arms for every person provisioned before the rules existed, once per database. */
  ensureRolesForExistingAccounts(): Promise<void>;
}

/**
 * The schemas the creator scan decodes with: the organization and every
 * BLUEPRINT_KINDS member. Pinned equal to that set by the domain's tests,
 * so a kind added to the constant without a schema fails loudly instead
 * of being skipped.
 */
export const CREATOR_SCAN_SCHEMAS: ReadonlyMap<ApiResourceKind, DescMessage> =
  new Map<ApiResourceKind, DescMessage>([
    [ApiResourceKind.organization, OrganizationSchema],
    [ApiResourceKind.agent, AgentSchema],
    [ApiResourceKind.workflow, WorkflowSchema],
    [ApiResourceKind.skill, SkillSchema],
    [ApiResourceKind.mcp_server, McpServerSchema],
    [ApiResourceKind.environment, EnvironmentSchema],
    [ApiResourceKind.schedule, ScheduleSchema],
  ]);

const ORGANIZATION = kindEnumName(ApiResourceKind.organization);
const IDENTITY_ACCOUNT = kindEnumName(ApiResourceKind.identity_account);

/** What the scan keeps of a resource: its id, its organization (blueprints), its creator stamp. */
export interface ScannedResource {
  readonly id: string;
  readonly org: string;
  readonly createdBy: string;
}

/**
 * A creator stamp that names a person: non-empty and not the unconfigured
 * laptop's placeholder. Exported for the built-in authorizer's derivation
 * (authorization/derived-tuples.ts), which turns a stamp into an owner or
 * creator tuple only when this says the stamp is somebody's — the one
 * predicate, read from the module that owns the doctrine above.
 */
export function isPersonStamp(stamp: string): boolean {
  return stamp !== "" && stamp !== SYSTEM_OPERATOR_IDENTITY_ID;
}

/**
 * An account row that is a person's — the row-level twin of the hook's
 * `user`-class gate, for the reconciliation, which has a row and no
 * caller. A machine account (`is_machine_account`, or the `machine`
 * provisioning mode) earns no role, exactly as a `machine`-class caller
 * earns none at the hook. Nor does a platform-client end user: it is a
 * person on its platform's product, not on this install — the mint grants
 * it exactly its client's auto-grant role on the owning organization and
 * never runs these rules, and the reconciliation must not either, or every
 * product user would become a member of every organization (and the
 * operator-email arm would read an email the platform asserted).
 */
export function isPersonAccount(account: IdentityAccount): boolean {
  const spec = account.spec;
  return (
    spec !== undefined &&
    !spec.isMachineAccount &&
    spec.provisioningMode !== IdentityAccountProvisioningMode.machine &&
    spec.provisioningMode !== IdentityAccountProvisioningMode.platform_client
  );
}

/** One organization's question for one account: everything the five arms read, resolved by the caller. */
export interface RoleQuestion {
  readonly accountId: string;
  /** The account's issuer subject (`spec.idp_id`); a stamp equal to it is the account's own (the alias rule). */
  readonly subject: string;
  readonly email: string;
  /** STIGMER_OPERATOR_EMAIL as configured; "" matches nobody. */
  readonly operatorEmail: string;
  readonly organization: ScannedResource;
  readonly blueprintsInOrganization: ReadonlyArray<ScannedResource>;
  /** Whether ANY role row exists on the organization — arm 4's "zero rows", read by the caller through the port. */
  readonly organizationHasRows: boolean;
}

/**
 * The five arms in their ruled order, as one pure function over what they
 * read — the one statement of "which role does this person get here",
 * shared by the first-sign-in hook and the boot reconciliation so the two
 * moments cannot drift. Arms 3 and 4 both answer `admin`; 3 comes first
 * because it is a string compare and 4 needs the rows read.
 */
export function roleFor(question: RoleQuestion): IamRole {
  const {
    accountId,
    subject,
    email,
    operatorEmail,
    organization,
    blueprintsInOrganization,
    organizationHasRows,
  } = question;
  const isMine = (stamp: string): boolean =>
    stamp !== "" && (stamp === subject || stamp === accountId);
  if (isMine(organization.createdBy)) {
    return IamRole.owner;
  }
  if (blueprintsInOrganization.some((b) => isMine(b.createdBy))) {
    return IamRole.admin;
  }
  if (operatorEmail !== "" && email === operatorEmail) {
    return IamRole.admin;
  }
  const anotherPersonStamped = [
    organization.createdBy,
    ...blueprintsInOrganization.map((b) => b.createdBy),
  ].some((stamp) => isPersonStamp(stamp) && !isMine(stamp));
  if (!anotherPersonStamped && !organizationHasRows) {
    return IamRole.admin;
  }
  return IamRole.member;
}

/** The world one pass of the arms reads: scanned ONCE by the caller, whether for one account or for all. */
interface ScannedWorld {
  readonly organizations: ReadonlyArray<ScannedResource>;
  readonly blueprints: ReadonlyArray<ScannedResource>;
}

/** `spec_audit.created_at` in epoch milliseconds; a row with no stamp sorts first (it is the oldest thing we know nothing about). */
function createdAtMillisOf(account: IdentityAccount): number {
  const stamp = account.status?.audit?.specAudit?.createdAt;
  if (stamp === undefined) {
    return Number.NEGATIVE_INFINITY;
  }
  return Number(stamp.seconds) * 1000 + Math.floor(stamp.nanos / 1_000_000);
}

export function newMembershipRules(deps: MembershipRulesDeps): MembershipRules {
  const { grantPath, policies, store, operatorEmail } = deps;

  async function scan(kind: ApiResourceKind): Promise<ScannedResource[]> {
    const schema = CREATOR_SCAN_SCHEMAS.get(kind);
    if (schema === undefined) {
      throw new Error(
        `no schema to decode ${kindEnumName(kind)} rows for the creator scan`,
      );
    }
    const rows = await store.listResources(kind);
    return rows.map((bytes) => {
      const resource = fromBinary(schema, bytes);
      const metadata = metadataOf(resource);
      return {
        id: metadata?.id ?? "",
        org: metadata?.org ?? "",
        createdBy: auditOf(schema, resource)?.specAudit?.createdBy?.id ?? "",
      };
    });
  }

  async function scanBlueprints(): Promise<ScannedResource[]> {
    const scanned: ScannedResource[] = [];
    for (const kind of BLUEPRINT_KINDS) {
      scanned.push(...(await scan(kind)));
    }
    return scanned;
  }

  /** The organizations `accountId` already holds any row on — the idempotency set. */
  async function organizationsHeldBy(
    accountId: string,
  ): Promise<ReadonlySet<string>> {
    const rows = await policies.findByPrincipal(IDENTITY_ACCOUNT, accountId);
    return new Set(
      rows
        .filter((row) => row.spec?.resource?.kind === ORGANIZATION)
        .map((row) => row.spec?.resource?.id ?? ""),
    );
  }

  /** The whole world one pass reads, scanned once: every organization and every blueprint. */
  async function scanWorld(): Promise<ScannedWorld> {
    return {
      organizations: await scan(ApiResourceKind.organization),
      blueprints: await scanBlueprints(),
    };
  }

  /**
   * The arms for ONE account over a scanned world: a row on every
   * organization the account holds none on, granted as `caller`. Shared
   * by the hook (one account, the world scanned for it) and the
   * reconciliation (the world scanned once for every account).
   */
  async function applyRulesTo(
    account: IdentityAccount,
    caller: CallerIdentity,
    world: ScannedWorld,
  ): Promise<void> {
    const accountId = account.metadata?.id ?? "";
    if (accountId === "") {
      throw new Error("membership rules: the account carries no id");
    }
    const subject = account.spec?.idpId ?? "";
    const email = account.spec?.email ?? "";
    const held = await organizationsHeldBy(accountId);

    for (const organization of world.organizations) {
      if (held.has(organization.id)) {
        continue;
      }
      const blueprintsInOrganization = world.blueprints.filter(
        (blueprint) => blueprint.org === organization.id,
      );
      const role = roleFor({
        accountId,
        subject,
        email,
        operatorEmail,
        organization,
        blueprintsInOrganization,
        organizationHasRows:
          (await policies.findByResource(ORGANIZATION, organization.id))
            .length > 0,
      });
      await grantPath.grant(
        organizationRole(accountId, role, organization.id),
        caller,
      );
    }
  }

  /** Every person account the store holds, oldest first (creation stamp, then id) — the order their sign-ins ran in. */
  async function scanPersonAccounts(): Promise<IdentityAccount[]> {
    const rows = await store.listResources(ApiResourceKind.identity_account);
    return rows
      .map((bytes) => fromBinary(IdentityAccountSchema, bytes))
      .filter(isPersonAccount)
      .sort((a, b) => {
        const byCreation = createdAtMillisOf(a) - createdAtMillisOf(b);
        if (byCreation !== 0) {
          return byCreation;
        }
        return (a.metadata?.id ?? "").localeCompare(b.metadata?.id ?? "");
      });
  }

  return {
    async onAccountCreated(account, caller): Promise<void> {
      if (caller.callerClass !== "user") {
        return;
      }
      if ((account.metadata?.id ?? "") === "") {
        throw new Error(
          "membership rules: the provisioned account carries no id",
        );
      }
      const organizations = await scan(ApiResourceKind.organization);
      if (organizations.length === 0) {
        return;
      }
      await applyRulesTo(account, caller, {
        organizations,
        blueprints: await scanBlueprints(),
      });
    },

    async ensureRolesForExistingAccounts(): Promise<void> {
      if ((await store.bootstrapState.get(ROLES_RECONCILED_KEY)) !== "") {
        return;
      }
      const accounts = await scanPersonAccounts();
      if (accounts.length > 0) {
        const world = await scanWorld();
        for (const account of accounts) {
          // As the account itself (actor.ts, the one construction), so the
          // row's audit actor reads exactly as the person's own first
          // sign-in would have stamped it.
          await applyRulesTo(account, accountAsCaller(account), world);
        }
      }
      // After the last account, never before: a fault above leaves the
      // marker unset and the next boot converges (the grant path is
      // idempotent; an organization already held is skipped).
      await store.bootstrapState.set(
        ROLES_RECONCILED_KEY,
        rfc3339Seconds(new Date()),
      );
    },

    async ensureOperatorOwnership(operator): Promise<void> {
      const accountId = operator.metadata?.id ?? "";
      if (accountId === "") {
        throw new Error("membership rules: the operator account carries no id");
      }
      // The operator acting as its account (domain/identityaccount/actor.ts,
      // the one construction): the row's audit actor is the account,
      // named the way every other trusted-local write names it.
      const actor = accountAsCaller(operator);
      for (const organization of await scan(ApiResourceKind.organization)) {
        const owners = await policies.findByResourceWithRelations(
          ORGANIZATION,
          organization.id,
          [relationOf(IamRole.owner)],
        );
        if (owners.length > 0) {
          continue;
        }
        await grantPath.grant(
          organizationRole(accountId, IamRole.owner, organization.id),
          actor,
        );
      }
    },
  };
}
