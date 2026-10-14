/**
 * Sharing a resource stays inside its organization on the self-hosted
 * Enterprise server, composed and driven over the wire on real Postgres.
 * This server authorizes with open source's own evaluator, which derives a
 * resource's organization from its row and stores no scope link, so the
 * grant gate (iam/team/grant-gate.ts) finds the organization through the
 * composition's `resourceOrganizations` (stigmer#2305):
 *
 *   - Alice shares her agent with Vic, who holds no role in Acme: refused
 *     FAILED_PRECONDITION, naming Acme by its slug, and no row is written;
 *   - once Vic is a member of Acme, the same share is admitted.
 *
 * Postgres comes from TEST_DATABASE_URL (unset: skipped by name outside a
 * test gate); the boot gets a fresh database.
 */
import { Code, createClient } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { GrantCommandController } from "@stigmer/protos/ai/stigmer/iam/grant/v1/command_pb";
import { GrantQueryController } from "@stigmer/protos/ai/stigmer/iam/grant/v1/query_pb";

import {
  provisionEnterpriseDatabase,
  TEST_DATABASE_URL,
  type ProvisionedEnterpriseDatabase,
} from "../../__test-utils__/enterprise-postgres.js";
import { startLoopbackIssuer, type LoopbackIssuer } from "../../__test-utils__/loopback-issuer.js";
import { licenseClaims, newTestSigner, writeTicket } from "../../license/__tests__/test-tickets.js";
import {
  bootEnterprise,
  createOrganization,
  grant,
  ref,
  refusalOf,
  signIn,
  testClock,
  type BootedServer,
  type Person,
} from "./enterprise-harness.js";

const ISSUED = new Date("2026-10-01T00:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

describe.skipIf(TEST_DATABASE_URL === undefined)("sharing on a licensed server stays inside the organization", () => {
  const signer = newTestSigner();
  let issuer: LoopbackIssuer;
  let db: ProvisionedEnterpriseDatabase;
  let booted: BootedServer;
  let alice: Person;
  let vic: Person;
  let acme = "";
  let agentId = "";

  beforeAll(async () => {
    issuer = await startLoopbackIssuer();
    db = await provisionEnterpriseDatabase();
    booted = await bootEnterprise({
      issuer,
      licenseKey: writeTicket(signer, licenseClaims({ issuedAt: ISSUED, days: 365, graceDays: 30 })),
      ring: signer.ring,
      clock: testClock(new Date(ISSUED.getTime() + DAY_MS)).read,
      databaseUrl: db.databaseUrl,
      pool: db.pool,
    });
    alice = await signIn(booted, issuer, "operator|alice");
    acme = await createOrganization(alice, "acme");
    const agent = await createClient(AgentCommandController, alice.transport).create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Agent",
      metadata: { name: "billing-helper", org: acme, visibility: ApiResourceVisibility.visibility_private },
      spec: { description: "billing", instructions: "You help with billing." },
    });
    agentId = agent.metadata?.id ?? "";
    vic = await signIn(booted, issuer, "operator|vic");
  });

  afterAll(async () => {
    await booted?.close();
    await db?.drop();
    await issuer?.close();
  });

  it("refuses a share with someone outside the organization, naming it by its slug, and writes nothing; admits it once they are a member", async () => {
    const grants = createClient(GrantCommandController, alice.transport);
    const share = grant(ref("identity_account", vic.accountId), "viewer", ref("agent", agentId));

    const refused = await refusalOf(grants.create(share));
    expect(refused.code).toBe(Code.FailedPrecondition);
    expect(refused.rawMessage).toBe(
      `identity account '${vic.accountId}' is not a member of organization 'acme'; add them to the organization before sharing its resources with them`,
    );
    const roles = createClient(GrantQueryController, alice.transport);
    const held = async (): Promise<string[]> =>
      (
        await roles.getPrincipalResourceRoles({
          principal: ref("identity_account", vic.accountId),
          resource: ref("agent", agentId),
        })
      ).roles.map((role) => role.code);
    expect(await held()).toEqual([]);

    await grants.create(grant(ref("identity_account", vic.accountId), "member", ref("organization", acme)));
    await grants.create(share);
    expect(await held()).toEqual(["viewer"]);
  });
});
