// Conformance suite for the Vault domain.
// Domain: agentic / vault — the logins (by a tool's address) and secrets (by
// name) that runs use.
//
// Drives VaultCommandController + VaultQueryController through the raw proto
// stubs and asserts the contract:
//   - a shared vault is created by name, owned by its organization, empty and
//     private; create names no person and no entries;
//   - a person's My vault exists only after their first entry write naming
//     `mine` (getMine answers NOT_FOUND before it), is one per person per
//     organization, and is never org-visible;
//   - values are write-only for everyone: no RPC returns a secret's value, a
//     connection's token or a sign-in's refresh token;
//   - connection addresses are normalized by one rule, and input that names
//     no address is refused with the rule in the sentence;
//   - update changes name, description and external id, and keeps the stored
//     owner and entries; an external id is unique per organization and freed
//     by the vault's delete;
//   - on the enforcing lane, a person never reaches a teammate's My vault (an
//     admin included), a member cannot create a shared vault, and the list
//     never shows another person's My vault.
import { Code, ConnectError } from "@connectrpc/connect";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { expectGrpcCode } from "../contract/errors";
import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { uniqueName } from "../support/naming";
import { makeSession } from "../support/sessions";
import {
  VAULT_API_VERSION,
  VAULT_KIND,
  makeSharedVault,
  myVaultTarget,
  removeConnectionsInput,
  removeSecretsInput,
  setConnectionInput,
  setSecretsInput,
  vaultTarget,
} from "../support/vaults";
import { createTarget, enforcingLaneOf, type TargetProfile } from "../targets";

// The redaction marker a client may never send as a value.
const REDACTED_MARKER = "***REDACTED***";

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

async function createShared(
  org: string,
  name = uniqueName("vault"),
  opts: { description?: string; externalId?: string } = {},
  as: ConformanceClients = clients,
): Promise<Vault> {
  const vault = await as.vaultCommand.create(makeSharedVault({ org, name, ...opts }));
  fixtures.defer(() => as.vaultCommand.delete({ resourceId: vault.metadata!.id }));
  return vault;
}

/** Writes a secret into the caller's My vault, creating it, and defers its delete. */
async function seedMine(org: string, as: ConformanceClients = clients): Promise<Vault> {
  const mine = await as.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), { SEED_KEY: "seed-value" }));
  fixtures.defer(() => as.vaultCommand.delete({ resourceId: mine.metadata!.id }));
  return mine;
}

/** Every value, token and refresh token a vault shows, which must all be empty. */
function shownValues(vault: Vault): string[] {
  const values: string[] = [];
  for (const secret of Object.values(vault.spec?.secrets ?? {})) {
    values.push(secret.value);
  }
  for (const connection of Object.values(vault.spec?.connections ?? {})) {
    values.push(connection.token, connection.signIn?.refreshToken ?? "");
  }
  return values.filter((value) => value !== "");
}

/** Expects one of the given codes: a person reaching another's vault is told nothing, by either answer. */
async function expectRefused(fn: () => Promise<unknown>, codes: Code[], label: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    const code = ConnectError.from(error).code;
    expect(codes, `${label}: refused with ${Code[code]}`).toContain(code);
    return;
  }
  throw new Error(`${label}: expected a refusal, but the call succeeded`);
}

describe("Vault conformance — shared vaults", () => {
  it("[rpc:VaultCommandController.create] create makes an empty, private shared vault owned by its organization", async () => {
    const { org } = await target.provisionTenancy();
    const name = uniqueName("support-tools");

    const created = await createShared(org, name, { description: "the support team's keys", externalId: `cust-${name}` });

    expect(created.metadata?.id).toMatch(/^vlt_[0-9a-z]+$/);
    expect(created.metadata?.name).toBe(name);
    expect(created.metadata?.org).toBe(org);
    expect(created.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
    expect(created.spec?.owner.case).toBe("org");
    expect(created.spec?.owner.value).toBe(org);
    expect(created.spec?.description).toBe("the support team's keys");
    expect(created.spec?.externalId).toBe(`cust-${name}`);
    expect(Object.keys(created.spec?.secrets ?? {})).toEqual([]);
    expect(Object.keys(created.spec?.connections ?? {})).toEqual([]);
    expect(created.status?.audit?.specAudit?.event).toBe("created");
  });

  it("[rpc:VaultCommandController.create] create refuses a person as owner, entries in the request, and My vault's slug prefix", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () =>
        clients.vaultCommand.create({
          ...makeSharedVault({ org, name: uniqueName("vault") }),
          spec: { owner: { case: "person", value: "someone" } },
        }),
      Code.InvalidArgument,
      "create naming a person",
    );
    await expectGrpcCode(
      () =>
        clients.vaultCommand.create({
          ...makeSharedVault({ org, name: uniqueName("vault") }),
          spec: { secrets: { KEY: { value: "v", description: "" } } },
        }),
      Code.InvalidArgument,
      "create carrying entries",
    );
    await expectGrpcCode(
      () => clients.vaultCommand.create(makeSharedVault({ org, name: "My Vault Copy" })),
      Code.InvalidArgument,
      "create with My vault's slug prefix",
    );
  });

  it("[rpc:VaultQueryController.get] get and getByReference return the vault; a missing one is NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createShared(org);

    const byId = await clients.vaultQuery.get({ value: created.metadata!.id });
    expect(byId.metadata?.id).toBe(created.metadata?.id);
    await expectGrpcCode(() => clients.vaultQuery.get({ value: "vlt_doesnotexist" }), Code.NotFound, "get missing id");
  });

  it("[rpc:VaultQueryController.getByReference] getByReference resolves org and slug", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createShared(org);

    const byRef = await clients.vaultQuery.getByReference({ org, slug: created.metadata!.slug, kind: ApiResourceKind.vault });
    expect(byRef.metadata?.id).toBe(created.metadata?.id);
    await expectGrpcCode(
      () => clients.vaultQuery.getByReference({ org, slug: "does-not-exist", kind: ApiResourceKind.vault }),
      Code.NotFound,
      "getByReference unknown slug",
    );
  });

  it("[rpc:VaultCommandController.update] update changes name, description and external id, and keeps the stored entries", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createShared(org);
    const target_ = vaultTarget(org, created.metadata!.id);
    await clients.vaultCommand.setSecrets(setSecretsInput(target_, { ZENDESK_API_KEY: "zd-1" }));
    const read = await clients.vaultQuery.get({ value: created.metadata!.id });

    const renamed = uniqueName("renamed");
    const updated = await clients.vaultCommand.update({
      apiVersion: VAULT_API_VERSION,
      kind: VAULT_KIND,
      metadata: { ...read.metadata!, name: renamed },
      // Sending back what a read showed (every value blank), or nothing at
      // all, never touches the stored entries.
      spec: { description: "after", externalId: `ext-${renamed}`, secrets: {} },
    });

    expect(updated.metadata?.id).toBe(created.metadata?.id);
    expect(updated.metadata?.slug).toBe(created.metadata?.slug);
    expect(updated.metadata?.name).toBe(renamed);
    expect(updated.spec?.description).toBe("after");
    expect(updated.spec?.externalId).toBe(`ext-${renamed}`);
    expect(Object.keys(updated.spec?.secrets ?? {})).toEqual(["ZENDESK_API_KEY"]);
    expect(updated.spec?.owner.case).toBe("org");
  });

  it("[rpc:VaultCommandController.update] update refuses another owner", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createShared(org);
    await expectGrpcCode(
      () =>
        clients.vaultCommand.update({
          apiVersion: VAULT_API_VERSION,
          kind: VAULT_KIND,
          metadata: created.metadata!,
          spec: { owner: { case: "person", value: "someone" } },
        }),
      Code.InvalidArgument,
      "update moving the vault to a person",
    );
  });

  it("[rpc:VaultCommandController.updateVisibility] a shared vault may be shared with its organization, never beyond", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createShared(org);

    const widened = await clients.vaultCommand.updateVisibility({
      resourceId: created.metadata!.id,
      visibility: ApiResourceVisibility.visibility_org,
    });
    expect(widened.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);

    await expectGrpcCode(
      () =>
        clients.vaultCommand.updateVisibility({
          resourceId: created.metadata!.id,
          visibility: ApiResourceVisibility.visibility_child_orgs,
        }),
      Code.InvalidArgument,
      "share a vault with child organizations",
    );
  });

  it("[rpc:VaultQueryController.getByExternalId] getByExternalId finds the vault; an id is unique per organization and freed by delete", async () => {
    const { org } = await target.provisionTenancy();
    const externalId = uniqueName("customer");
    const created = await clients.vaultCommand.create(makeSharedVault({ org, name: uniqueName("cust"), externalId }));

    const found = await clients.vaultQuery.getByExternalId({ org, externalId });
    expect(found.metadata?.id).toBe(created.metadata?.id);

    await expectGrpcCode(
      () => clients.vaultCommand.create(makeSharedVault({ org, name: uniqueName("cust"), externalId })),
      Code.AlreadyExists,
      "a second vault with the same external id",
    );

    await clients.vaultCommand.delete({ resourceId: created.metadata!.id });
    await expectGrpcCode(
      () => clients.vaultQuery.getByExternalId({ org, externalId }),
      Code.NotFound,
      "getByExternalId after delete",
    );
    // The id is free again.
    await createShared(org, uniqueName("cust"), { externalId });
  });

  it("[rpc:VaultCommandController.delete] delete returns the vault and a later get is NotFound", async () => {
    const { org } = await target.provisionTenancy();
    const created = await clients.vaultCommand.create(makeSharedVault({ org, name: uniqueName("vault") }));
    await clients.vaultCommand.setSecrets(setSecretsInput(vaultTarget(org, created.metadata!.id), { KEY: "value" }));

    const deleted = await clients.vaultCommand.delete({ resourceId: created.metadata!.id });
    expect(deleted.metadata?.id).toBe(created.metadata?.id);
    expect(shownValues(deleted), "even a parting response shows no value").toEqual([]);
    await expectGrpcCode(() => clients.vaultQuery.get({ value: created.metadata!.id }), Code.NotFound, "get after delete");
  });
});

describe("Vault conformance — My vault", () => {
  it("[rpc:VaultQueryController.getMine] getMine is NotFound before the first write; the first write naming mine creates it", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(() => clients.vaultQuery.getMine({ org }), Code.NotFound, "getMine before any write");

    const mine = await seedMine(org);
    expect(mine.metadata?.name).toBe("My vault");
    expect(mine.spec?.owner.case).toBe("person");
    expect(mine.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);

    const again = await clients.vaultQuery.getMine({ org });
    expect(again.metadata?.id, "getMine answers the vault the first write made").toBe(mine.metadata?.id);

    const second = await clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), { OTHER_KEY: "other" }));
    expect(second.metadata?.id, "a later write naming mine reaches the same vault").toBe(mine.metadata?.id);
    expect(Object.keys(second.spec?.secrets ?? {}).sort()).toEqual(["OTHER_KEY", "SEED_KEY"]);
  });

  it("[rpc:VaultCommandController.updateVisibility] My vault is never shared with the organization", async () => {
    const { org } = await target.provisionTenancy();
    const mine = await seedMine(org);
    await expectGrpcCode(
      () =>
        clients.vaultCommand.updateVisibility({
          resourceId: mine.metadata!.id,
          visibility: ApiResourceVisibility.visibility_org,
        }),
      Code.FailedPrecondition,
      "share My vault with the organization",
    );
  });

  it("[rpc:VaultCommandController.removeSecrets] removing from a My vault that does not exist yet is NotFound", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.vaultCommand.removeSecrets(removeSecretsInput(myVaultTarget(org), ["NOPE"])),
      Code.NotFound,
      "remove from an absent My vault",
    );
  });
});

describe("Vault conformance — values are write-only", () => {
  it("[rpc:VaultCommandController.setSecrets] no read shows a saved secret's value, its owner included", async () => {
    const { org } = await target.provisionTenancy();
    const saved = await clients.vaultCommand.setSecrets(
      setSecretsInput(myVaultTarget(org), { OPENAI_API_KEY: "sk-conformance-secret" }),
    );
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: saved.metadata!.id }));
    expect(Object.keys(saved.spec?.secrets ?? {})).toEqual(["OPENAI_API_KEY"]);
    expect(saved.spec?.secrets.OPENAI_API_KEY?.savedAt, "the server stamps when it was saved").toBeDefined();

    const reads = [
      saved,
      await clients.vaultQuery.getMine({ org }),
      await clients.vaultQuery.get({ value: saved.metadata!.id }),
      ...(await clients.vaultQuery.list({ org })).items,
    ];
    for (const read of reads) {
      expect(shownValues(read), "a read shows names, never values").toEqual([]);
    }
  });

  it("[rpc:VaultCommandController.setConnection] a login is saved at its normalized address and its token is never shown", async () => {
    const { org } = await target.provisionTenancy();
    const saved = await clients.vaultCommand.setConnection(
      setConnectionInput(myVaultTarget(org), "https://MCP.Example.com:443/mcp/?ref=docs#top", "tok-conformance"),
    );
    fixtures.defer(() => clients.vaultCommand.delete({ resourceId: saved.metadata!.id }));

    expect(Object.keys(saved.spec?.connections ?? {})).toEqual(["https://mcp.example.com/mcp"]);
    expect(saved.spec?.connections["https://mcp.example.com/mcp"]?.token).toBe("");

    const git = await clients.vaultCommand.setConnection(setConnectionInput(myVaultTarget(org), "GitHub.com", "ghp-conformance"));
    expect(Object.keys(git.spec?.connections ?? {}).sort()).toEqual(["github.com", "https://mcp.example.com/mcp"]);
    expect(shownValues(await clients.vaultQuery.getMine({ org }))).toEqual([]);
  });

  it("[rpc:VaultCommandController.setConnection] input that names no address is refused with the rule", async () => {
    const { org } = await target.provisionTenancy();
    for (const address of ["ftp://files.example.com", "https://${HOST}/mcp", "not a host"]) {
      const err = await expectGrpcCode(
        () => clients.vaultCommand.setConnection(setConnectionInput(myVaultTarget(org), address, "tok")),
        Code.InvalidArgument,
        `address ${address}`,
      );
      expect(err.rawMessage).toContain("an address is a tool's URL");
    }
  });

  it("[rpc:VaultCommandController.setSecrets] the redaction marker and server-shaped ciphertext are not values", async () => {
    const { org } = await target.provisionTenancy();
    await expectGrpcCode(
      () => clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), { KEY: REDACTED_MARKER })),
      Code.InvalidArgument,
      "the marker as a value",
    );
    await expectGrpcCode(
      () => clients.vaultCommand.setSecrets(setSecretsInput(myVaultTarget(org), { KEY: "enc:v1:Zm9yZ2Vk" })),
      Code.InvalidArgument,
      "ciphertext-shaped input",
    );
  });

  it("[rpc:VaultCommandController.removeConnections] removing entries removes only what was named; unknown names are ignored", async () => {
    const { org } = await target.provisionTenancy();
    const created = await createShared(org);
    const at = vaultTarget(org, created.metadata!.id);
    await clients.vaultCommand.setSecrets(setSecretsInput(at, { A: "1", B: "2" }));
    await clients.vaultCommand.setConnection(setConnectionInput(at, "https://mcp.linear.app/mcp", "lin"));
    await clients.vaultCommand.setConnection(setConnectionInput(at, "github.com", "gh"));

    const afterSecrets = await clients.vaultCommand.removeSecrets(removeSecretsInput(at, ["A", "NOT_SAVED"]));
    expect(Object.keys(afterSecrets.spec?.secrets ?? {})).toEqual(["B"]);

    const afterConnections = await clients.vaultCommand.removeConnections(
      removeConnectionsInput(at, ["https://MCP.linear.app/mcp/", "https://not-saved.example.com"]),
    );
    expect(Object.keys(afterConnections.spec?.connections ?? {})).toEqual(["github.com"]);
  });

  it("[rpc:VaultCommandController.setSecrets] a vault of another organization named by id is NotFound", async () => {
    const a = await target.provisionTenancy();
    const b = await target.provisionTenancy();
    const inA = await createShared(a.org);
    await expectGrpcCode(
      () => clients.vaultCommand.setSecrets(setSecretsInput(vaultTarget(b.org, inA.metadata!.id), { KEY: "v" })),
      Code.NotFound,
      "a vault named under the wrong organization",
    );
  });
});

describe("[rpc:VaultQueryController.list] Vault conformance — list", () => {
  it("lists the organization's shared vaults and the caller's own My vault", async () => {
    const { org } = await target.provisionTenancy();
    const shared = await createShared(org);
    const mine = await seedMine(org);
    const other = await target.provisionTenancy();
    await createShared(other.org);

    const listed = await clients.vaultQuery.list({ org });
    const ids = listed.items.map((vault) => vault.metadata?.id).sort();
    expect(ids).toEqual([shared.metadata!.id, mine.metadata!.id].sort());
    expect(listed.totalCount).toBe(2);
  });

  it("rejects a list with no org (InvalidArgument)", () =>
    expectGrpcCode(() => clients.vaultQuery.list({ org: "" }), Code.InvalidArgument, "list without org"));
});

// Two people in one organization: a My vault is its person's alone, an admin
// included; only admins create shared vaults; nobody's list shows another
// person's My vault. Runs on the enforcing lane, where authorization is
// evaluated; skipped visibly elsewhere.
describe("Vault conformance — a person's own vault, between people", () => {
  it("[rpc:VaultCommandController.setSecrets] a member keeps their own My vault beside the founder's and reaches nothing of theirs", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const tenancy = await lane.provisionTenancy();
    const member = await lane.provisionMember(tenancy);

    const founders = await seedMine(tenancy.org, lane.clients);
    const members = await seedMine(tenancy.org, member);
    expect(members.metadata?.id, "each person has their own My vault").not.toBe(founders.metadata?.id);

    // The member reaches nothing of the founder's own vault.
    await expectRefused(
      () => member.vaultQuery.get({ value: founders.metadata!.id }),
      [Code.PermissionDenied, Code.NotFound],
      "a member reading the founder's My vault",
    );
    await expectRefused(
      () => member.vaultCommand.setSecrets(setSecretsInput(vaultTarget(tenancy.org, founders.metadata!.id), { X: "y" })),
      [Code.PermissionDenied, Code.NotFound],
      "a member writing into the founder's My vault",
    );
    // The founder administers the organization and still reaches nothing of the member's.
    await expectRefused(
      () => lane.clients.vaultQuery.get({ value: members.metadata!.id }),
      [Code.PermissionDenied, Code.NotFound],
      "an admin reading a member's My vault",
    );
    await expectRefused(
      () => lane.clients.vaultCommand.delete({ resourceId: members.metadata!.id }),
      [Code.PermissionDenied, Code.NotFound],
      "an admin deleting a member's My vault",
    );

    const membersList = await member.vaultQuery.list({ org: tenancy.org });
    expect(membersList.items.map((vault) => vault.metadata?.id)).toEqual([members.metadata!.id]);
    const foundersList = await lane.clients.vaultQuery.list({ org: tenancy.org });
    expect(foundersList.items.map((vault) => vault.metadata?.id)).toEqual([founders.metadata!.id]);
  });

  it("[rpc:VaultCommandController.create] a member cannot create a shared vault; an admin can, and org visibility lets the member use it", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const tenancy = await lane.provisionTenancy();
    const member = await lane.provisionMember(tenancy);

    await expectGrpcCode(
      () => member.vaultCommand.create(makeSharedVault({ org: tenancy.org, name: uniqueName("team") })),
      Code.PermissionDenied,
      "a member creating a shared vault",
    );

    const team = await createShared(tenancy.org, uniqueName("team"), {}, lane.clients);
    await expectRefused(
      () => member.vaultQuery.get({ value: team.metadata!.id }),
      [Code.PermissionDenied, Code.NotFound],
      "a member reading a private shared vault",
    );
    await lane.clients.vaultCommand.updateVisibility({
      resourceId: team.metadata!.id,
      visibility: ApiResourceVisibility.visibility_org,
    });
    const seen = await member.vaultQuery.get({ value: team.metadata!.id });
    expect(seen.metadata?.id).toBe(team.metadata?.id);
    // Using is not editing: the member may not change the team's entries.
    await expectRefused(
      () => member.vaultCommand.setSecrets(setSecretsInput(vaultTarget(tenancy.org, team.metadata!.id), { X: "y" })),
      [Code.PermissionDenied],
      "a member writing into a shared vault",
    );
  });

  it("[rpc:SessionCommandController.create] a member's conversation cannot list a shared vault they may not use", async (ctx) => {
    const enforcing = await enforcingLaneOf(target);
    if (enforcing.lane === undefined) return ctx.skip(enforcing.reason);
    const lane = enforcing.lane;
    const tenancy = await lane.provisionTenancy();
    const member = await lane.provisionMember(tenancy);
    const team = await createShared(tenancy.org, uniqueName("private-team"), {}, lane.clients);

    const input = makeSession({ org: tenancy.org, name: uniqueName("listing-session"), vaults: [team.metadata!.slug] });
    await expectGrpcCode(
      () => member.sessionCommand.create(input),
      Code.PermissionDenied,
      "a member listing a private shared vault on their conversation",
    );

    // Once the organization may use it, the member may list it.
    await lane.clients.vaultCommand.updateVisibility({
      resourceId: team.metadata!.id,
      visibility: ApiResourceVisibility.visibility_org,
    });
    const session = await member.sessionCommand.create(input);
    fixtures.defer(() => member.sessionCommand.delete({ value: session.metadata!.id }));
    const attachers = session.status?.vaultAttachers ?? {};
    expect(Object.keys(attachers), "the server records who attached the vault").toEqual([team.metadata!.id]);
  });
});
