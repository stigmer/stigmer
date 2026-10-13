/**
 * The permission history on the self-hosted Enterprise server, composed and
 * driven end to end over real Postgres: no unit registers a policy store,
 * so the library's own keeps the history, and the edition the license
 * unit declares is what opens it to. Every entry is read raw from the
 * library's `iam_policy_history` table (no reader exists yet).
 *
 * The story, as an organization lives it:
 *   - Alice founds Acme: her owner role is recorded as the organization's
 *     creation;
 *   - Bob redeems Alice's invitation: his role is recorded as Alice's grant,
 *     the server acting for her, never as Bob granting himself a role;
 *   - Raj is a member and an editor of Alice's agent, then removed: his
 *     role is recorded as removed, and the agent grant as swept when he
 *     left;
 *   - Mia moves her access to the account Acme's SSO provider signs her in
 *     as: every change is recorded as moved, acting for her new account;
 *   - Acme is deleted: every row it held is recorded as removed with the
 *     organization, and its history outlives the purge.
 * A server with no key is open source and keeps no history, whatever its
 * people do.
 *
 * Postgres comes from TEST_DATABASE_URL (unset: skipped by name outside a
 * test gate); each boot gets a fresh database.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";
import { IdentityProviderSchema } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/api_pb";
import { IdentityProviderCommandController } from "@stigmer/protos/ai/stigmer/iam/identityprovider/v1/command_pb";
import { InvitationCommandController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/command_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import type { Pool } from "pg";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../__test-utils__/enterprise-postgres.js";
import { startLoopbackIssuer, type LoopbackIssuer } from "../../__test-utils__/loopback-issuer.js";
import { newTestSigner, writeTicket } from "../../license/__tests__/test-tickets.js";
import {
  bootEnterprise,
  createOrganization,
  federatedToken,
  grant,
  licenseClaims,
  providerRequest,
  ref,
  signIn,
  testClock,
  transportTo,
  type BootedServer,
  type Person,
} from "./enterprise-harness.js";

const ISSUED = new Date("2026-10-01T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;
const OKTA = "acme-okta";

/** One entry, the columns the story reads. */
interface Entry {
  readonly sequence: number;
  readonly change: string;
  readonly cause: string;
  readonly actorId: string;
  readonly actorClass: string;
  readonly principalId: string;
  readonly relation: string;
  readonly resourceKind: string;
  readonly resourceId: string;
}

/** The organization's entries in order, read raw from the library's table. */
async function historyOf(pool: Pool, org: string): Promise<Entry[]> {
  const result = await pool.query<{
    sequence: string;
    change: string;
    cause: string;
    actor_id: string;
    actor_class: string;
    principal_id: string;
    relation: string;
    resource_kind: string;
    resource_id: string;
  }>(
    `SELECT sequence, change, cause, actor_id, actor_class, principal_id, relation, resource_kind, resource_id
     FROM public.iam_policy_history WHERE org = $1 ORDER BY sequence`,
    [org],
  );
  return result.rows.map((row) => ({
    sequence: Number(row.sequence),
    change: row.change,
    cause: row.cause,
    actorId: row.actor_id,
    actorClass: row.actor_class,
    principalId: row.principal_id,
    relation: row.relation,
    resourceKind: row.resource_kind,
    resourceId: row.resource_id,
  }));
}

async function countHistory(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM public.iam_policy_history`);
  return Number(result.rows[0]?.count ?? 0);
}

describe.skipIf(TEST_DATABASE_URL === undefined)("the permission history on a licensed server", () => {
  const signer = newTestSigner();
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;
  let alice: Person;
  let acme = "";

  beforeAll(async () => {
    issuer = await startLoopbackIssuer();
    db = await provisionEnterpriseDatabase();
    booted = await bootEnterprise({
      egress: "relaxed",
      issuer,
      licenseKey: writeTicket(signer, licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 })),
      ring: signer.ring,
      clock: testClock(new Date(ISSUED.getTime() + DAY_MS)).read,
      databaseUrl: db.databaseUrl,
      pool: db.pool,
      dialer: issuer.fetch,
    });
    alice = await signIn(booted, issuer, "operator|alice");
    acme = await createOrganization(alice, "acme");
  }, 120_000);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
    await issuer?.close();
  });

  /** The entries after `from`, the ones a step added. */
  async function entriesSince(from: number): Promise<Entry[]> {
    return (await historyOf(db.pool, acme)).filter((entry) => entry.sequence > from);
  }

  async function newest(): Promise<number> {
    return (await historyOf(db.pool, acme)).at(-1)?.sequence ?? 0;
  }

  it("records the founder's owner role as the organization's creation", async () => {
    const entries = await historyOf(db.pool, acme);
    expect(entries.map((entry) => entry.sequence)).toEqual(entries.map((_, n) => n + 1));
    expect(entries).toContainEqual(
      expect.objectContaining({
        change: "granted",
        cause: "organization_created",
        principalId: alice.accountId,
        relation: "owner",
        resourceKind: "organization",
        resourceId: acme,
      }),
    );
  });

  it("records an invitation's role as the inviter's grant, the server acting for her", async () => {
    const from = await newest();
    const bob = await signIn(booted, issuer, "operator|bob");
    const invitation = await createClient(InvitationCommandController, alice.transport).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "Invitation",
      metadata: { name: "bob", org: acme },
      spec: { role: IamRole.viewer, maxRedemptions: 1, expiresAt: timestampFromDate(new Date(Date.now() + DAY_MS)) },
    });
    await createClient(InvitationCommandController, bob.transport).redeem({ token: invitation.status?.token ?? "" });

    expect(await entriesSince(from)).toContainEqual(
      expect.objectContaining({
        change: "granted",
        cause: "grant",
        actorId: alice.accountId,
        actorClass: "internal",
        principalId: bob.accountId,
        relation: "viewer",
        resourceId: acme,
      }),
    );
  });

  it("records a removed member's role as removed and what he held on its resources as swept", async () => {
    const raj = await signIn(booted, issuer, "operator|raj");
    const policies = createClient(IamPolicyCommandController, alice.transport);
    await policies.create(grant(ref("identity_account", raj.accountId), "member", ref("organization", acme)));
    const agent = await createClient(AgentCommandController, alice.transport).create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "reviewer", org: acme, visibility: ApiResourceVisibility.visibility_private },
      spec: { description: "reviewer", instructions: "You review." },
    });
    const agentId = agent.metadata?.id ?? "";
    await policies.create(grant(ref("identity_account", raj.accountId), "editor", ref("agent", agentId)));
    const from = await newest();

    await policies.revokeOrgAccess({ identityAccountId: raj.accountId, org: acme });

    const removed = await entriesSince(from);
    expect(removed).toEqual([
      expect.objectContaining({
        change: "revoked",
        cause: "organization_access_revoked",
        actorId: alice.accountId,
        actorClass: "user",
        principalId: raj.accountId,
        relation: "member",
        resourceId: acme,
      }),
      expect.objectContaining({
        change: "revoked",
        cause: "left_organization",
        actorId: alice.accountId,
        principalId: raj.accountId,
        relation: "editor",
        resourceKind: "agent",
        resourceId: agentId,
      }),
    ]);
  });

  it("records an access move as moved, acting for the account that received it", async () => {
    const mia = await signIn(booted, issuer, "operator|mia");
    await createClient(IamPolicyCommandController, alice.transport).create(
      grant(ref("identity_account", mia.accountId), "member", ref("organization", acme)),
    );
    const request = create(IdentityProviderSchema, providerRequest(issuer, acme, OKTA, { displayName: "Acme Okta" }));
    if (request.spec !== undefined) {
      request.spec.isSsoProvider = true;
      request.spec.oidcClientId = "acme-client";
    }
    await createClient(IdentityProviderCommandController, alice.transport).create(request);
    const miaOkta = transportTo(booted.port, federatedToken(issuer, OKTA, "okta|mia", "mia@acme.example"));
    const miaOktaId = (await createClient(IdentityAccountQueryController, miaOkta).whoAmI({})).metadata?.id ?? "";
    const from = await newest();

    const ticket = await createClient(IdentityProviderCommandController, mia.transport).createAccessMove({ org: acme });
    await createClient(IdentityProviderCommandController, miaOkta).redeemAccessMove({ ticket: ticket.ticket });

    const moved = await entriesSince(from);
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.every((entry) => entry.cause === "access_moved" && entry.actorId === miaOktaId)).toBe(true);
    expect(moved).toContainEqual(
      expect.objectContaining({ change: "granted", principalId: miaOktaId, relation: "member", resourceId: acme }),
    );
    expect(moved).toContainEqual(
      expect.objectContaining({ change: "revoked", principalId: mia.accountId, relation: "member", resourceId: acme }),
    );
  });

  it("records every row the organization's delete removes, and keeps its history after the purge", async () => {
    const from = await newest();
    await createClient(OrganizationCommandController, alice.transport).delete({ value: acme });
    await vi.waitFor(
      async () => {
        await booted.server.organizationPurge.runPass();
        expect(await booted.server.store.organizationDeletions.isDeleting(acme)).toBe(false);
      },
      { timeout: 30_000 },
    );

    const deleted = await entriesSince(from);
    expect(deleted.length).toBeGreaterThan(0);
    expect(deleted.every((entry) => entry.change === "revoked" && entry.cause === "resource_deleted")).toBe(true);
    expect(deleted).toContainEqual(
      expect.objectContaining({ principalId: alice.accountId, relation: "owner", resourceId: acme }),
    );
    const all = await historyOf(db.pool, acme);
    expect(all.map((entry) => entry.sequence)).toEqual(all.map((_, n) => n + 1));
    expect(all.length).toBeGreaterThan(deleted.length);
  });
});

describe.skipIf(TEST_DATABASE_URL === undefined)("a server with no key keeps no permission history", () => {
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;

  beforeAll(async () => {
    issuer = await startLoopbackIssuer();
    db = await provisionEnterpriseDatabase({ migrate: false });
    booted = await bootEnterprise({ issuer, databaseUrl: db.databaseUrl });
  }, 120_000);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
    await issuer?.close();
  });

  it("grants its people their roles and records none of them", async () => {
    await signIn(booted, issuer, "operator|olga");
    await signIn(booted, issuer, "operator|oscar");
    expect(await booted.server.store.listResources(ApiResourceKind.iam_policy)).not.toEqual([]);
    expect(await countHistory(db.pool)).toBe(0);
  });
});
