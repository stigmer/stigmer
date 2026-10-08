// Conformance suite for deleting an organization: it is gone at once, and a
// purge removes what it owned before its slug is free again.
// Domain: tenancy / organization, and the kinds an organization owns.
//
// The contract under test, as a caller sees it on the wire: from the delete's
// answer on, the organization answers NOT_FOUND to every request that names
// it, by id or by slug, a second delete included; a row it owned answers
// NOT_FOUND by id; nothing new can be made inside it; its share links resolve
// nowhere, with the copy a missing share answers; a key limited to it reaches
// nothing, and the purge removes it; once the purge has run its slug can be
// taken, and the new holder
// sees none of the old organization's rows. A parent may be deleted once
// every child is being deleted, and every slug comes free.
//
// That no stored row names anything the organization owned is proven where
// the store can be read: the server's composed purge suites on both drivers
// (backend/services/stigmer-server, organization-purge*.test.ts) and each
// edition's own census.
import { Code } from "@connectrpc/connect";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode, grpcCodeOf } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { makeAgent } from "../support/agents";
import { makeAgentShare } from "../support/agentshares";
import { API_KEY_API_VERSION, API_KEY_KIND, plaintextKeyOf } from "../support/apikeys";
import { makeSharedVault, setSecretsInput, vaultTarget } from "../support/vaults";
import { uniqueName } from "../support/naming";
import { createChildOrganization, createOrganizationOnceReleased } from "../support/organizations";
import { createTarget, enforcingLaneOf, type TargetProfile } from "../targets";

const API_VERSION = "tenancy.stigmer.ai/v1";
const KIND = "Organization";

let target: TargetProfile;
let clients: ConformanceClients;
const fixtures = new FixtureTracker();

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
});

afterEach(async () => {
  await fixtures.cleanup();
});

afterAll(async () => {
  await target?.teardown();
});

/** An organization under `slug` holding an agent, a share of it and a shared vault with a secret. */
async function populated(slug: string, using: ConformanceClients = clients) {
  const org = await using.organizationCommand.create({ apiVersion: API_VERSION, kind: KIND, metadata: { name: slug, slug } });
  const id = org.metadata!.id;
  const agent = await using.agentCommand.create(makeAgent({ org: id, name: uniqueName("purge-agent") }));
  const share = await using.agentShareCommand.create(makeAgentShare(id, agent.metadata!.slug));
  const created = await using.vaultCommand.create(makeSharedVault({ org: id, name: uniqueName("purge-vault") }));
  const vault = await using.vaultCommand.setSecrets(setSecretsInput(vaultTarget(id, created.metadata!.id), { TOKEN: "purged" }));
  return { id, slug, agent, share, vault };
}

/** The slug's next organization, once the purge released it; deleted at the end of the arm. */
async function nextHolder(slug: string, using: ConformanceClients = clients) {
  const org = await createOrganizationOnceReleased(using.organizationCommand, slug);
  fixtures.defer(() => using.organizationCommand.delete({ value: org.metadata!.id }));
  return org;
}

describe("Organization purge conformance", () => {
  it("[rpc:OrganizationCommandController.delete] [rpc:OrganizationQueryController.get] a deleted organization answers not found at once, by id and by slug, a second delete included", async () => {
    const doomed = await populated(uniqueName("purge"));

    const answered = await clients.organizationCommand.delete({ value: doomed.id });
    expect(answered.metadata?.id, "the delete answers the organization as it stood").toBe(doomed.id);

    for (const value of [doomed.id, doomed.slug]) {
      await expectGrpcCode(() => clients.organizationQuery.get({ value }), Code.NotFound, `get by '${value}'`);
    }
    await expectGrpcCode(
      () => clients.organizationCommand.delete({ value: doomed.id }),
      Code.NotFound,
      "a second delete",
    );
    await nextHolder(doomed.slug);
  });

  it("[rpc:AgentQueryController.get] [rpc:VaultQueryController.get] [rpc:AgentCommandController.create] its rows answer not found, and nothing new is made inside it", async () => {
    const doomed = await populated(uniqueName("purge"));
    await clients.organizationCommand.delete({ value: doomed.id });

    // Each answer holds while the purge runs and after it: the deleting rule
    // first, then a row and an organization that are gone.
    await expectGrpcCode(
      () => clients.agentQuery.get({ value: doomed.agent.metadata!.id }),
      Code.NotFound,
      "an agent it owned, by id",
    );
    await expectGrpcCode(
      () => clients.vaultQuery.get({ value: doomed.vault.metadata!.id }),
      Code.NotFound,
      "a vault it owned, by id",
    );
    const refused = await expectGrpcCode(
      () => clients.agentCommand.create(makeAgent({ org: doomed.id, name: uniqueName("late-agent") })),
      Code.NotFound,
      "an agent created inside it",
    );
    expect(refused.rawMessage).toBe(`Organization not found: ${doomed.id}`);
    await nextHolder(doomed.slug);
  });

  it("[rpc:AgentShareQueryController.getSharedProfile] its share links resolve nowhere, with the copy a missing share answers", async () => {
    const doomed = await populated(uniqueName("purge"));
    await clients.agentShareQuery.getSharedProfile({ shareId: doomed.share.metadata!.id });
    await clients.organizationCommand.delete({ value: doomed.id });

    const link = await expectGrpcCode(
      () => clients.agentShareQuery.getSharedProfile({ shareId: doomed.share.metadata!.id }),
      Code.NotFound,
      "the deleted organization's share link",
    );
    expect(link.rawMessage).toBe(`Agent not found: ${doomed.share.metadata!.id}`);
    await nextHolder(doomed.slug);
  });

  it("[rpc:OrganizationCommandController.create] once the purge has run, its slug can be taken, and the new holder sees nothing it owned", async () => {
    const doomed = await populated(uniqueName("purge"));
    await clients.organizationCommand.delete({ value: doomed.id });

    const next = await nextHolder(doomed.slug);
    expect(next.metadata?.id, "a new organization").not.toBe(doomed.id);
    expect((await clients.vaultQuery.list({ org: doomed.slug })).items).toEqual([]);
    await expectGrpcCode(
      () => clients.vaultQuery.getByReference({ org: doomed.slug, slug: doomed.vault.metadata!.slug }),
      Code.NotFound,
      "the old organization's vault, through the slug's new holder",
    );
  });

  it("[rpc:OrganizationCommandController.delete] a parent whose children are all being deleted may be deleted, and every slug comes free", async () => {
    const parent = await populated(uniqueName("purge-parent"));
    const child = await createChildOrganization(clients.organizationCommand, parent.id, "purge child");

    await expectGrpcCode(
      () => clients.organizationCommand.delete({ value: parent.id }),
      Code.FailedPrecondition,
      "a parent whose child is live",
    );
    await clients.organizationCommand.delete({ value: child.id });
    await clients.organizationCommand.delete({ value: parent.id });

    await expectGrpcCode(() => clients.organizationQuery.get({ value: parent.id }), Code.NotFound, "the parent");
    await expectGrpcCode(() => clients.organizationQuery.get({ value: child.id }), Code.NotFound, "the child");
    await nextHolder(child.slug);
    await nextHolder(parent.slug);
  });

  it("[rpc:ApiKeyCommandController.create] [rpc:OrganizationQueryController.findMyOrganizations] a key limited to a deleted organization reaches nothing, and goes with it", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const doomed = await populated(uniqueName("purge"), lane.clients);
    const created = await lane.clients.apiKeyCommand.create({
      apiVersion: API_KEY_API_VERSION,
      kind: API_KEY_KIND,
      metadata: { name: uniqueName("purge-key") },
      spec: { boundOrg: doomed.id },
    });
    fixtures.defer(() => lane.clients.apiKeyCommand.delete({ value: created.metadata!.id }));
    const asKey = lane.clientsPresenting(plaintextKeyOf(created));
    expect((await asKey.organizationQuery.get({ value: doomed.id })).metadata?.id).toBe(doomed.id);

    await lane.clients.organizationCommand.delete({ value: doomed.id });

    // While the purge runs the key still verifies and finds nothing; once
    // the purge removed it with its organization, it is no key at all.
    const refusedWith = new Set([Code.NotFound, Code.Unauthenticated]);
    for (const [label, call] of [
      ["its organization", () => asKey.organizationQuery.get({ value: doomed.id })],
      ["a row its organization owned", () => asKey.agentQuery.get({ value: doomed.agent.metadata!.id })],
    ] as const) {
      const code = await grpcCodeOf(call, label);
      expect(refusedWith.has(code), `${label}: refused, got ${Code[code]}`).toBe(true);
    }
    await nextHolder(doomed.slug, lane.clients);
    await expectGrpcCode(
      () => asKey.organizationQuery.findMyOrganizations({}),
      Code.Unauthenticated,
      "the key, once the purge removed it",
    );
  });
});
