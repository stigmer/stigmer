/**
 * Pins the open-source membership rules (T01_0_plan.md §3a
 * "membership.ts"; T01_1_review.md Q-OR-6b and Q-OR-6c) over a seeded
 * generic store, a fake account port and the real grant path:
 *
 *   onAccountCreated(account, caller), per organization the account holds
 *   no row on:
 *   - `owner` when the account's subject (its idp_id) or its id is the
 *     organization's own creator;
 *   - `admin` when it created any BLUEPRINT in that organization (and only
 *     a blueprint: a session's creator stays a member — DD-002 rule 2
 *     keeps personal things by created_by with no role);
 *   - `admin` when the organization has ZERO role rows and no PERSON other
 *     than this account created the organization or any blueprint in it
 *     (slice 4 ruling Q-S4-7: the founder's stamp counts) — the
 *     fresh-install and the trusted-local-turned-OIDC first caller. "Zero
 *     rows", never "no admin now": revoking every admin of a bootstrapped
 *     organization must not hand it to the next stranger;
 *   - `admin` when the account's email is STIGMER_OPERATOR_EMAIL (and that
 *     email is configured — an empty one matches nobody);
 *   - `member` otherwise;
 *   - nothing for a non-`user` caller class; nothing on an organization
 *     the account already holds a row on (idempotent by construction), so
 *     a run that faulted midway converges on the next.
 *
 *   ensureOperatorOwnership(operator): `owner` on every organization that
 *   has NO owner row (Q-S4-3: a boot-time write never overrides a recorded
 *   human grant); a second boot writes nothing; the row's audit actor is
 *   the operator's account — id, email and display name — like every
 *   other trusted-local write.
 *
 * The creator stamps the rules read are `status.audit.spec_audit.created_by
 * .id`, which for a legacy self-host is the raw issuer subject and for a
 * provisioned caller is the account id (P1 gate Q2c; 2a handoff 2), so
 * both spellings are seeded and both must match. A stamp is a PERSON when
 * it is non-empty and not the unconfigured laptop's "system" placeholder;
 * the rules classify stamps by shape and consult no account store.
 *
 * The rules read policy rows through the IamPolicyStore PORT (`policies`,
 * the same instance the grant path writes through), never around it.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { create } from "@bufbuild/protobuf";
import { TimestampSchema } from "@bufbuild/protobuf/wkt";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import type { IdentityAccount } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountSchema } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/api_pb";
import { IdentityAccountProvisioningMode } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/enum_pb";
import { OrganizationSchema } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/api_pb";

import type { CallerIdentity } from "../../../extensions/identity.js";
import { tempStore } from "../../../store/sqlite/__tests__/support.js";
import type { Store } from "../../../store/interface.js";
import { accountIdFor } from "../../identityaccount/constants.js";
import { BLUEPRINT_KINDS } from "../constants.js";
import { newIamPolicyGrantPath } from "../grant-path.js";
import type { IamPolicyGrantPath } from "../grant-path.js";
import { CREATOR_SCAN_SCHEMAS, newMembershipRules } from "../membership.js";
import type { MembershipRules } from "../membership.js";
import type { IamPolicyStore } from "../store.js";
import { fakeIamPolicyStore } from "./support.js";
import type { FakeIamPolicyStore } from "./support.js";

const OPERATOR_EMAIL = "operator@example.com";
const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function userCaller(identityId: string, email?: string): CallerIdentity {
  return {
    identityId,
    callerClass: "user",
    issuer: "https://issuer.example.com",
    rawToken: "",
    email,
  };
}

function account(sub: string, email: string): IdentityAccount {
  return create(IdentityAccountSchema, {
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: { id: accountIdFor(sub), name: email },
    spec: {
      idpId: sub,
      email,
      provisioningMode: IdentityAccountProvisioningMode.direct,
    },
  });
}

describe("membership rules", () => {
  let temp: ReturnType<typeof tempStore>;
  let store: Store;
  let policies: FakeIamPolicyStore;
  let grantPath: IamPolicyGrantPath;
  let rules: MembershipRules;

  /** Rules over the shared store and a policy port of the test's choosing (the grant path is built over the same port). */
  function rulesOver(
    port: IamPolicyStore,
    operatorEmail: string = OPERATOR_EMAIL,
  ): MembershipRules {
    return newMembershipRules({
      grantPath: newIamPolicyGrantPath({
        policies: port,
        lifecycle: undefined,
        logger: silentLogger,
      }),
      policies: port,
      store,
      operatorEmail,
    });
  }

  beforeEach(() => {
    temp = tempStore();
    store = temp.store;
    policies = fakeIamPolicyStore();
    grantPath = newIamPolicyGrantPath({
      policies,
      lifecycle: undefined,
      logger: silentLogger,
    });
    rules = newMembershipRules({
      grantPath,
      policies,
      store,
      operatorEmail: OPERATOR_EMAIL,
    });
  });

  afterEach(async () => {
    await temp.cleanup();
  });

  /** Seeds an organization row whose creator stamp is `createdBy` (a subject or an account id). */
  async function seedOrg(slug: string, createdBy: string): Promise<void> {
    const org = create(OrganizationSchema, {
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { id: slug, slug, name: slug },
      spec: { description: slug },
      status: {
        audit: {
          specAudit: {
            createdBy: { id: createdBy },
            createdAt: create(TimestampSchema),
          },
        },
      },
    });
    await store.saveResource(
      ApiResourceKind.organization,
      slug,
      OrganizationSchema,
      org,
    );
  }

  async function seedAgent(
    id: string,
    org: string,
    createdBy: string,
  ): Promise<void> {
    const agent = create(AgentSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { id, org, name: id, slug: id },
      status: {
        audit: {
          specAudit: {
            createdBy: { id: createdBy },
            createdAt: create(TimestampSchema),
          },
        },
      },
    });
    await store.saveResource(ApiResourceKind.agent, id, AgentSchema, agent);
  }

  async function seedSession(
    id: string,
    org: string,
    createdBy: string,
  ): Promise<void> {
    const session = create(SessionSchema, {
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: { id, org, name: id },
      status: {
        audit: {
          specAudit: {
            createdBy: { id: createdBy },
            createdAt: create(TimestampSchema),
          },
        },
      },
    });
    await store.saveResource(
      ApiResourceKind.session,
      id,
      SessionSchema,
      session,
    );
  }

  function rolesOf(accountId: string): ReadonlyArray<string> {
    return [...policies.rows.values()]
      .filter((p) => p.spec?.principal?.id === accountId)
      .map((p) => `${p.spec?.relation}@${p.spec?.resource?.id}`)
      .sort();
  }

  describe("onAccountCreated", () => {
    it("the organization's creator, stamped by raw subject before provisioning, becomes its owner", async () => {
      await seedOrg("acme", "auth0|alice");
      const alice = account("auth0|alice", "alice@example.com");
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      expect(rolesOf(alice.metadata!.id)).toEqual(["owner@acme"]);
    });

    it("the organization's creator, stamped by account id, becomes its owner too", async () => {
      const alice = account("auth0|alice", "alice@example.com");
      await seedOrg("acme", alice.metadata!.id);
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      expect(rolesOf(alice.metadata!.id)).toEqual(["owner@acme"]);
    });

    it("a blueprint's creator in someone else's organization becomes admin there; a session's creator does not", async () => {
      await seedOrg("acme", "auth0|alice");
      await seedAgent("agt_bob", "acme", "auth0|bob");
      await seedOrg("globex", "auth0|alice");
      await seedSession("ses_bob", "globex", "auth0|bob");
      const alice = account("auth0|alice", "alice@example.com");
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      const bob = account("auth0|bob", "bob@example.com");

      await rules.onAccountCreated(bob, userCaller(bob.metadata!.id));

      expect(rolesOf(bob.metadata!.id)).toEqual([
        "admin@acme",
        "member@globex",
      ]);
    });

    it("an organization with zero role rows and no other user-class blueprint creator makes the first caller admin (the trusted-local-turned-OIDC install)", async () => {
      await seedOrg("acme", "system");
      await seedAgent("agt_1", "acme", "system");
      const carol = account("auth0|carol", "carol@example.com");

      await rules.onAccountCreated(carol, userCaller(carol.metadata!.id));

      expect(rolesOf(carol.metadata!.id)).toEqual(["admin@acme"]);
    });

    it("an organization whose rows were all revoked is NOT handed to the next stranger — zero rows, never no-admin-now", async () => {
      await seedOrg("acme", "auth0|alice");
      const alice = account("auth0|alice", "alice@example.com");
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      // The organization was bootstrapped; its owner is then revoked.
      await grantPath.revokeOrgAccess(alice.metadata!.id, "acme");
      expect(policies.rows.size).toBe(0);
      // A second creator stamp keeps the "no other person created anything here" arm from firing on its own.
      await seedAgent("agt_alice", "acme", alice.metadata!.id);
      const mallory = account("auth0|mallory", "mallory@example.com");

      await rules.onAccountCreated(mallory, userCaller(mallory.metadata!.id));

      expect(rolesOf(mallory.metadata!.id)).toEqual(["member@acme"]);
    });

    it("the founder's own stamp counts as another person — a revoked founder's empty organization is NOT handed to the next stranger (Q-S4-7)", async () => {
      await seedOrg("acme", "auth0|alice");
      const alice = account("auth0|alice", "alice@example.com");
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      await grantPath.revokeOrgAccess(alice.metadata!.id, "acme");
      expect(policies.rows.size).toBe(0);
      // No blueprint at all: only the organization's own creator stamp stands between mallory and admin.
      const mallory = account("auth0|mallory", "mallory@example.com");

      await rules.onAccountCreated(mallory, userCaller(mallory.metadata!.id));

      expect(rolesOf(mallory.metadata!.id)).toEqual(["member@acme"]);
    });

    it("an unconfigured operator email matches nobody — an account with an empty email is a member, never admin", async () => {
      await seedOrg("acme", "auth0|alice");
      const alice = account("auth0|alice", "alice@example.com");
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      const unconfigured = rulesOver(policies, "");
      const nobody = account("auth0|nobody", "");

      await unconfigured.onAccountCreated(
        nobody,
        userCaller(nobody.metadata!.id, ""),
      );

      expect(rolesOf(nobody.metadata!.id)).toEqual(["member@acme"]);
    });

    it("a store fault mid-scan propagates, and the next run converges with no duplicate row", async () => {
      await seedOrg("acme", "auth0|alice");
      await seedOrg("globex", "auth0|alice");
      let faultsLeft = 1;
      const healthy = fakeIamPolicyStore();
      const flaky: IamPolicyStore = {
        ...healthy,
        async save(policy) {
          // The first organization's row lands; the second save fails once.
          if (healthy.rows.size === 1 && faultsLeft > 0) {
            faultsLeft -= 1;
            throw new Error("disk full");
          }
          await healthy.save(policy);
        },
      };
      const flakyRules = rulesOver(flaky);
      const dave = account("auth0|dave", "dave@example.com");

      await expect(
        flakyRules.onAccountCreated(dave, userCaller(dave.metadata!.id)),
      ).rejects.toThrow("disk full");
      expect(healthy.rows.size).toBe(1);

      await flakyRules.onAccountCreated(dave, userCaller(dave.metadata!.id));

      expect(
        [...healthy.rows.values()]
          .map((p) => `${p.spec?.relation}@${p.spec?.resource?.id}`)
          .sort(),
      ).toEqual(["member@acme", "member@globex"]);
    });

    it("the operator email becomes admin of every organization it does not own", async () => {
      await seedOrg("acme", "auth0|alice");
      await seedOrg("globex", "auth0|alice");
      const alice = account("auth0|alice", "alice@example.com");
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      const operator = account("auth0|operator", OPERATOR_EMAIL);

      await rules.onAccountCreated(
        operator,
        userCaller(operator.metadata!.id, OPERATOR_EMAIL),
      );

      expect(rolesOf(operator.metadata!.id)).toEqual([
        "admin@acme",
        "admin@globex",
      ]);
    });

    it("everyone else is a member of every existing organization", async () => {
      await seedOrg("acme", "auth0|alice");
      await seedOrg("globex", "auth0|alice");
      const alice = account("auth0|alice", "alice@example.com");
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      const dave = account("auth0|dave", "dave@example.com");

      await rules.onAccountCreated(dave, userCaller(dave.metadata!.id));

      expect(rolesOf(dave.metadata!.id)).toEqual([
        "member@acme",
        "member@globex",
      ]);
    });

    it("with no organization yet, writes nothing — the creator rule runs when the organization is created", async () => {
      const alice = account("auth0|alice", "alice@example.com");
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      expect(policies.rows.size).toBe(0);
    });

    it("never grants a runner, machine or internal caller a role", async () => {
      await seedOrg("acme", "system");
      const bot = account("@clients|bot", "");
      for (const callerClass of ["runner", "machine", "internal"] as const) {
        await rules.onAccountCreated(bot, {
          ...userCaller(bot.metadata!.id),
          callerClass,
        });
      }
      expect(policies.rows.size).toBe(0);
    });

    it("skips an organization the account already holds a row on — a second run writes nothing new", async () => {
      await seedOrg("acme", "auth0|alice");
      const alice = account("auth0|alice", "alice@example.com");
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      const before = [...policies.rows.keys()];

      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));

      expect([...policies.rows.keys()]).toEqual(before);
    });
  });

  describe("ensureOperatorOwnership", () => {
    it("makes the operator owner of every organization, and a second boot writes nothing", async () => {
      await seedOrg("acme", "system");
      await seedOrg("globex", OPERATOR_EMAIL);
      const operator = account(`local|${OPERATOR_EMAIL}`, OPERATOR_EMAIL);
      const operatorId = operator.metadata!.id;

      await rules.ensureOperatorOwnership(operator);
      const after = [...policies.rows.keys()].sort();
      await rules.ensureOperatorOwnership(operator);

      expect(rolesOf(operatorId)).toEqual(["owner@acme", "owner@globex"]);
      expect([...policies.rows.keys()].sort()).toEqual(after);
    });

    it("leaves an organization that already has an owner alone", async () => {
      await seedOrg("acme", "auth0|alice");
      const alice = account("auth0|alice", "alice@example.com");
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      const operator = account("local|system", "");

      await rules.ensureOperatorOwnership(operator);

      expect(rolesOf(operator.metadata!.id)).toEqual([]);
    });

    it("stamps the owner row's audit actor as the operator's account — id, email and display name, like every other trusted-local write", async () => {
      await seedOrg("acme", "system");
      const operator = account(`local|${OPERATOR_EMAIL}`, OPERATOR_EMAIL);
      operator.metadata!.name = "The Operator";

      await rules.ensureOperatorOwnership(operator);

      const [row] = [...policies.rows.values()];
      const actor = row?.status?.audit?.specAudit?.createdBy;
      expect(actor?.id).toBe(operator.metadata!.id);
      expect(actor?.email).toBe(OPERATOR_EMAIL);
      expect(actor?.displayName).toBe("The Operator");
    });
  });

  describe("the creator scan", () => {
    it("decodes exactly the organization and BLUEPRINT_KINDS — a kind added to the constant without a schema fails here", () => {
      expect([...CREATOR_SCAN_SCHEMAS.keys()].sort()).toEqual(
        [ApiResourceKind.organization, ...BLUEPRINT_KINDS].sort(),
      );
    });
  });
});
