/**
 * The access history read back on the self-hosted Enterprise server,
 * composed and driven end to end over real Postgres: the library's own
 * policy store keeps the history (enterprise-permission-history.postgres
 * .test.ts proves what it writes), and the edition the license unit
 * declares is what opens the reader too, with no Enterprise source of its
 * own. Everything here goes through `listAccessHistory` on the wire.
 *
 * The story, as an organization's security team reads it:
 *   - Alice founds Acme, invites Bob as an admin, makes Raj a member and
 *     an editor of her agent, then removes Raj: Bob reads it newest first,
 *     every person named, the invitation's grant shown as the server
 *     acting for Alice;
 *   - a tool follows the history oldest first a page at a time, and later
 *     asks only for what came after the last entry it holds: every entry
 *     once, numbered with no gap;
 *   - a member may see who has access but not read how it changed;
 *   - Acme's admins read its child organization's history, but only the
 *     entries about the child itself, never its private agent or who
 *     holds it; the child's own admin reads all of it, and its member
 *     none;
 *   - a deleted resource is named deleted (its slug empty), the
 *     organization's own entries still named. (Its rows are not removed
 *     with it on this posture yet, so its removal is not recorded:
 *     stigmer#2257.)
 *   - a license that has lapsed keeps its edition, so the history still
 *     reads.
 * A server with no key is open source: it keeps no history and says so.
 *
 * Postgres comes from TEST_DATABASE_URL (unset: skipped by name outside a
 * test gate); each boot gets a fresh database.
 */
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPolicyCommandController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/command_pb";
import type { AccessHistoryEntry } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { AccessChange, AccessChangeCause } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/io_pb";
import { IamPolicyQueryController } from "@stigmer/protos/ai/stigmer/iam/iampolicy/v1/query_pb";
import { InvitationCommandController } from "@stigmer/protos/ai/stigmer/iam/invitation/v1/command_pb";
import { IamRole } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";
import type { Transport } from "@connectrpc/connect";

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
  grant,
  licenseClaims,
  ref,
  signIn,
  testClock,
  type BootedServer,
  type Person,
  type TestClock,
} from "./enterprise-harness.js";

const ISSUED = new Date("2026-10-01T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** The history as `reader` reads it, newest first, every page. */
async function newestFirst(reader: Transport, org: string): Promise<AccessHistoryEntry[]> {
  const query = createClient(IamPolicyQueryController, reader);
  const entries: AccessHistoryEntry[] = [];
  let pageToken = "";
  do {
    const page = await query.listAccessHistory({ org, pageSize: 3, pageToken });
    entries.push(...page.entries);
    pageToken = page.nextPageToken;
  } while (pageToken !== "");
  return entries;
}

/** What a tool holding everything up to `after` reads next, oldest first, every page. */
async function follow(reader: Transport, org: string, after: bigint): Promise<AccessHistoryEntry[]> {
  const query = createClient(IamPolicyQueryController, reader);
  const entries: AccessHistoryEntry[] = [];
  let pageToken = "";
  do {
    const page = await query.listAccessHistory({ org, afterSequence: after, pageSize: 2, pageToken });
    entries.push(...page.entries);
    pageToken = page.nextPageToken;
  } while (pageToken !== "");
  return entries;
}

async function refusal(promise: Promise<unknown>): Promise<ConnectError> {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(ConnectError);
  return error as ConnectError;
}

describe.skipIf(TEST_DATABASE_URL === undefined)("the access history on a licensed server", () => {
  const signer = newTestSigner();
  const clock: TestClock = testClock(new Date(ISSUED.getTime() + DAY_MS));
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;
  let alice: Person;
  let bob: Person;
  let raj: Person;
  let mia: Person;
  let kim: Person;
  let lee: Person;
  let acme = "";
  let acmeEu = "";
  let agentId = "";
  let euSecretId = "";

  beforeAll(async () => {
    issuer = await startLoopbackIssuer();
    db = await provisionEnterpriseDatabase();
    booted = await bootEnterprise({
      egress: "relaxed",
      issuer,
      licenseKey: writeTicket(signer, licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 })),
      ring: signer.ring,
      clock: clock.read,
      databaseUrl: db.databaseUrl,
      pool: db.pool,
      dialer: issuer.fetch,
    });
    alice = await signIn(booted, issuer, "operator|alice");
    acme = await createOrganization(alice, "acme");
    const policies = createClient(IamPolicyCommandController, alice.transport);

    bob = await signIn(booted, issuer, "operator|bob");
    const invitation = await createClient(InvitationCommandController, alice.transport).create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "Invitation",
      metadata: { name: "bob", org: acme },
      spec: { role: IamRole.admin, maxRedemptions: 1, expiresAt: timestampFromDate(new Date(Date.now() + DAY_MS)) },
    });
    await createClient(InvitationCommandController, bob.transport).redeem({ token: invitation.status?.token ?? "" });

    raj = await signIn(booted, issuer, "operator|raj");
    await policies.create(grant(ref("identity_account", raj.accountId), "member", ref("organization", acme)));
    const agent = await createClient(AgentCommandController, alice.transport).create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "billing-helper", org: acme, visibility: ApiResourceVisibility.visibility_private },
      spec: { description: "billing", instructions: "You help with billing." },
    });
    agentId = agent.metadata?.id ?? "";
    await policies.create(grant(ref("identity_account", raj.accountId), "editor", ref("agent", agentId)));
    await policies.revokeOrgAccess({ identityAccountId: raj.accountId, org: acme });

    mia = await signIn(booted, issuer, "operator|mia");
    await policies.create(grant(ref("identity_account", mia.accountId), "member", ref("organization", acme)));

    const child = await createClient(OrganizationCommandController, alice.transport).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: "acme-eu", slug: "acme-eu", org: "" },
      spec: { description: "Acme's European arm", parentOrg: acme },
    });
    acmeEu = child.metadata?.id ?? "";
    kim = await signIn(booted, issuer, "operator|kim");
    // Kim administers the child; Lee is a member of it.
    await policies.create(grant(ref("identity_account", kim.accountId), "admin", ref("organization", acmeEu)));
    lee = await signIn(booted, issuer, "operator|lee");
    await policies.create(grant(ref("identity_account", lee.accountId), "member", ref("organization", acmeEu)));
    // Something the child holds that its parent's admins do not see: a
    // private agent, and Lee's role on it.
    const secret = await createClient(AgentCommandController, kim.transport).create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "eu-secret", org: acmeEu, visibility: ApiResourceVisibility.visibility_private },
      spec: { description: "eu", instructions: "You are private." },
    });
    euSecretId = secret.metadata?.id ?? "";
    await createClient(IamPolicyCommandController, kim.transport).create(
      grant(ref("identity_account", lee.accountId), "editor", ref("agent", euSecretId)),
    );
  }, 120_000);

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
    await issuer?.close();
  });

  it("an admin reads the story newest first, every person named and the server shown acting for its people", async () => {
    const entries = await newestFirst(bob.transport, acme);
    const numbers = entries.map((entry) => Number(entry.sequence));
    expect(numbers).toEqual(numbers.map((_, n) => numbers.length - n));

    expect(entries[0]).toMatchObject({
      change: AccessChange.granted,
      cause: AccessChangeCause.grant,
      principal: { id: mia.accountId },
      role: { code: "member" },
    });
    expect(entries[1]).toMatchObject({
      change: AccessChange.revoked,
      cause: AccessChangeCause.organization_access_revoked,
      actorClass: "user",
      actor: { kind: "identity_account", id: alice.accountId, email: "operator.alice@acme.example" },
      principal: { kind: "identity_account", id: raj.accountId, email: "operator.raj@acme.example" },
      role: { code: "member" },
      resource: { kind: ApiResourceKind.organization, id: acme, slug: "acme" },
    });
    expect(entries).toContainEqual(
      expect.objectContaining({
        change: AccessChange.granted,
        cause: AccessChangeCause.grant,
        role: expect.objectContaining({ code: "editor" }),
        principal: expect.objectContaining({ id: raj.accountId }),
        resource: expect.objectContaining({ kind: ApiResourceKind.agent, id: agentId, slug: "billing-helper" }),
      }),
    );
    expect(entries).toContainEqual(
      expect.objectContaining({
        cause: AccessChangeCause.grant,
        actorClass: "internal",
        actor: expect.objectContaining({ id: alice.accountId }),
        principal: expect.objectContaining({ id: bob.accountId }),
        role: expect.objectContaining({ code: "admin" }),
      }),
    );
    expect(entries.at(-1)).toMatchObject({
      sequence: 1n,
      cause: AccessChangeCause.organization_created,
      principal: { id: alice.accountId },
      role: { code: "owner" },
    });
    for (const entry of entries) {
      expect(entry.actor?.name, `entry ${entry.sequence}'s actor is named or carries its id`).toBeDefined();
      expect(entry.occurredAt).toBeDefined();
    }
  });

  it("a tool follows it oldest first with no gap, then reads exactly what came after the last entry it holds", async () => {
    const held = await follow(alice.transport, acme, 0n);
    expect(held.map((entry) => Number(entry.sequence))).toEqual(held.map((_, n) => n + 1));
    expect(held.map((entry) => entry.sequence)).toEqual(
      (await newestFirst(alice.transport, acme)).map((entry) => entry.sequence).reverse(),
    );

    const last = held.at(-1)?.sequence ?? 0n;
    expect(await follow(alice.transport, acme, last)).toEqual([]);
    await createClient(IamPolicyCommandController, alice.transport).create(
      grant(ref("identity_account", raj.accountId), "viewer", ref("organization", acme)),
    );
    const since = await follow(alice.transport, acme, last);
    expect(since).toHaveLength(1);
    expect(since[0]).toMatchObject({
      sequence: last + 1n,
      change: AccessChange.granted,
      principal: { id: raj.accountId },
      role: { code: "viewer" },
    });
  });

  it("a member may see who has access, but not read how it changed", async () => {
    const error = await refusal(
      createClient(IamPolicyQueryController, mia.transport).listAccessHistory({ org: acme }),
    );
    expect(error.code).toBe(Code.PermissionDenied);
  });

  it("the parent's admins read a child organization's history, and the child's member does not", async () => {
    const entries = await newestFirst(bob.transport, acmeEu);
    // Only the entries about the child itself: its private agent, and who
    // holds it, stay out of sight of the parent's admins.
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.resource, `entry ${entry.sequence}`).toMatchObject({
        kind: ApiResourceKind.organization,
        id: acmeEu,
      });
    }
    expect(entries.map((entry) => [entry.principal?.id, entry.role?.code])).toEqual([
      [lee.accountId, "member"],
      [kim.accountId, "admin"],
    ]);

    // The child's own admin reads the whole of it, the private agent included.
    const insider = await newestFirst(kim.transport, acmeEu);
    expect(insider[0]).toMatchObject({
      principal: { id: lee.accountId },
      role: { code: "editor" },
      resource: { kind: ApiResourceKind.agent, id: euSecretId, slug: "eu-secret" },
    });
    expect(insider.length).toBe(entries.length + 1);

    const member = await refusal(
      createClient(IamPolicyQueryController, lee.transport).listAccessHistory({ org: acmeEu }),
    );
    expect(member.code).toBe(Code.PermissionDenied);
    const upward = await refusal(
      createClient(IamPolicyQueryController, kim.transport).listAccessHistory({ org: acme }),
    );
    expect(upward.code).toBe(Code.PermissionDenied);
  });

  it("names a deleted resource deleted, and keeps the organization's own entries named", async () => {
    await createClient(AgentCommandController, alice.transport).delete({ value: agentId });
    const entries = await newestFirst(bob.transport, acme);
    const onAgent = entries.filter((entry) => entry.resource?.id === agentId);
    expect(onAgent.length).toBeGreaterThan(0);
    for (const entry of onAgent) {
      expect(entry.resource?.slug, `entry ${entry.sequence} names its agent deleted`).toBe("");
    }
    const onAcme = entries.filter((entry) => entry.resource?.id === acme);
    expect(onAcme.every((entry) => entry.resource?.slug === "acme")).toBe(true);
  });

  it("still reads once the license and its grace period have lapsed", async () => {
    clock.now = new Date(ISSUED.getTime() + 400 * DAY_MS);
    const entries = await newestFirst(bob.transport, acme);
    expect(entries.length).toBeGreaterThan(0);
  });
});

describe.skipIf(TEST_DATABASE_URL === undefined)("a server with no key serves no access history", () => {
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

  it("says it keeps none, to a person who may otherwise read it", async () => {
    // The server holds one organization, and its first person administers it.
    const olga = await signIn(booted, issuer, "operator|olga");
    const error = await refusal(
      createClient(IamPolicyQueryController, olga.transport).listAccessHistory({ org: "stigmer" }),
    );
    expect(error.code).toBe(Code.Unimplemented);
    expect(error.rawMessage).toBe("the access history is served by the Enterprise and Cloud editions");
  });
});
