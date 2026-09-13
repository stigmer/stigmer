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
 *   - `admin` when the organization has ZERO role rows and no user-class
 *     blueprint creator other than this account — the fresh-install and
 *     the trusted-local-turned-OIDC first caller. "Zero rows", never "no
 *     admin now": revoking every admin of a bootstrapped organization must
 *     not hand it to the next stranger;
 *   - `admin` when the account's email is STIGMER_OPERATOR_EMAIL;
 *   - `member` otherwise;
 *   - nothing for a non-`user` caller class; nothing on an organization
 *     the account already holds a row on (idempotent by construction).
 *
 *   ensureOperatorOwnership(operatorAccountId): `owner` on every
 *   organization, create-if-absent; a second boot writes nothing.
 *
 * The creator stamps the rules read are `status.audit.spec_audit.created_by
 * .id`, which for a legacy self-host is the raw issuer subject and for a
 * provisioned caller is the account id (P1 gate Q2c; 2a handoff 2), so
 * both spellings are seeded and both must match.
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
import { fakeIdentityAccountStore } from "../../identityaccount/__tests__/support.js";
import { newIamPolicyGrantPath } from "../grant-path.js";
import { newMembershipRules } from "../membership.js";
import type { MembershipRules } from "../membership.js";
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
  let rules: MembershipRules;
  const accounts = fakeIdentityAccountStore();

  beforeEach(() => {
    temp = tempStore();
    store = temp.store;
    policies = fakeIamPolicyStore();
    const grantPath = newIamPolicyGrantPath({
      policies,
      lifecycle: undefined,
      logger: silentLogger,
    });
    rules = newMembershipRules({
      grantPath,
      store,
      accounts,
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
      const grantPath = newIamPolicyGrantPath({
        policies,
        lifecycle: undefined,
        logger: silentLogger,
      });
      await grantPath.revokeOrgAccess(alice.metadata!.id, "acme");
      expect(policies.rows.size).toBe(0);
      // A second creator stamp keeps the "no other user-class creator" arm from firing on its own.
      await seedAgent("agt_alice", "acme", alice.metadata!.id);
      const mallory = account("auth0|mallory", "mallory@example.com");

      await rules.onAccountCreated(mallory, userCaller(mallory.metadata!.id));

      expect(rolesOf(mallory.metadata!.id)).toEqual(["member@acme"]);
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
      const operatorId = accountIdFor(`local|${OPERATOR_EMAIL}`);

      await rules.ensureOperatorOwnership(operatorId);
      const after = [...policies.rows.keys()].sort();
      await rules.ensureOperatorOwnership(operatorId);

      expect(rolesOf(operatorId)).toEqual(["owner@acme", "owner@globex"]);
      expect([...policies.rows.keys()].sort()).toEqual(after);
    });

    it("leaves an organization that already has an owner alone", async () => {
      await seedOrg("acme", "auth0|alice");
      const alice = account("auth0|alice", "alice@example.com");
      await rules.onAccountCreated(alice, userCaller(alice.metadata!.id));
      const operatorId = accountIdFor("local|system");

      await rules.ensureOperatorOwnership(operatorId);

      expect(rolesOf(operatorId)).toEqual([]);
    });
  });
});
