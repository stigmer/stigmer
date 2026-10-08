/**
 * Pins the vault RPCs end to end on a composed server whose Authorizer is
 * this file's table (a person may edit and view their own My vault; the
 * organization's admin manages its shared vaults; one member is granted a
 * shared vault's use), so every permission arm answers exactly:
 *
 *   - create makes a shared vault owned by its organization, empty and
 *     private, or shared with the organization when created so; it refuses
 *     a person owner (with any visibility), entries, My vault's slug
 *     prefix, and a caller without can_create_shared_vault;
 *   - update keeps the stored owner and entries and refuses an owner
 *     change; My vault takes no external id;
 *   - external ids are claimed (ALREADY_EXISTS when taken), moved on
 *     change, freed on clear and on delete, and found by getByExternalId,
 *     which asks the organization first and answers NOT_FOUND for a vault
 *     the caller may not view, so it never tells which ids exist;
 *   - updateVisibility shares a shared vault and refuses My vault;
 *   - the entry RPCs: `mine` asks can_create_vault and creates My vault on
 *     the first write; an id asks can_edit; another organization's vault
 *     named under this one is NOT_FOUND;
 *   - a first write refused for its entries (a reserved name, an address
 *     that breaks the rule) creates no My vault;
 *   - getMine is NOT_FOUND before the first write; list shows the caller's
 *     own My vault and the shared vaults, never another person's My vault;
 *   - a login's token shaped like server ciphertext (any enc:v<N>:) is
 *     refused before anything is written;
 *   - an update that carries a secret's value and a login's token stores
 *     neither: the row's entries stay byte-identical;
 *   - no response carries a value, token or sign-in refresh token,
 *     updateVisibility's and getByExternalId's included;
 *   - on a composition with no Authorizer (every check allowed), an
 *     unknown id with a level the kind refuses is NOT_FOUND, not
 *     INVALID_ARGUMENT: the vault is loaded before the level is judged.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, toBinary } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import type { Vault } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { VaultQueryController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/query_pb";
import {
  VaultConnectionSchema,
  VaultConnectionSource,
  VaultSecretSchema,
  VaultSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/vault/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import { IamPermission } from "@stigmer/protos/ai/stigmer/iam/v1/enum_pb";
import { OrganizationCommandController } from "@stigmer/protos/ai/stigmer/tenancy/organization/v1/command_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import type { Authorizer, AuthzDecision } from "../../../extensions/authorizer.js";
import {
  baseConfig,
  fakeJwt,
  fakeVerifier,
  silentLogger,
  transportFor,
} from "../../../extensions/__tests__/composed-support.js";
import type { ServerExtension } from "../../../extensions/registry.js";
import { ResourceNotFoundError } from "../../../store/interface.js";

import {
  MY_VAULT_SLUG_REFUSAL,
  OWNER_IMMUTABLE_REFUSAL,
  forgedCiphertextMessage,
} from "../constants.js";
import { decodeVaultRows } from "../list-index.js";
import { personOf } from "../service.js";

const ADMIN = "fake|admin";
const ANA = "fake|ana";
const BEN = "fake|ben";
const GUEST = "fake|guest";
/** Sees nothing in the organization: no member, no grant. */
const OUTSIDER = "fake|outsider";
/** The external id of a vault whose every authorization check fails. */
const OUTAGE_EXTERNAL_ID = "customer-outage";
const ORG = "vault-org";
const OTHER_ORG = "vault-other-org";

let dir: string;
let server: ComposedServer;
let port: number;
let orgId: string;

/** The model's answer, as a table over the stored rows (bound after boot). */
const tableAuthorizer: Authorizer = {
  async authorize(caller, check): Promise<AuthzDecision> {
    const who = caller.identityId;
    const allow: AuthzDecision = { kind: "allow" };
    const deny: AuthzDecision = { kind: "deny", reason: "the table says no" };
    if (check.resourceKind === ApiResourceKind.organization) {
      switch (check.permission) {
        case IamPermission.can_create_shared_vault:
          return who === ADMIN ? allow : deny;
        case IamPermission.can_create_vault:
          return who === GUEST ? deny : allow;
        case IamPermission.can_view:
          return who === OUTSIDER ? deny : allow;
        default:
          return allow;
      }
    }
    if (check.resourceKind !== ApiResourceKind.vault) {
      return allow;
    }
    let vault: Vault;
    try {
      vault = await server.store.getResource(
        ApiResourceKind.vault,
        check.resourceId,
        VaultSchema,
      );
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return { kind: "not-found" };
      }
      throw error;
    }
    if (vault.spec?.externalId === OUTAGE_EXTERNAL_ID) {
      throw new Error("the authorization store is down");
    }
    const person = personOf(vault);
    if (person !== undefined) {
      return person === who ? allow : deny;
    }
    if (who === ADMIN) {
      return allow;
    }
    const granted =
      who === BEN &&
      (check.permission === IamPermission.can_view ||
        check.permission === IamPermission.can_use);
    return granted ? allow : deny;
  },
};

function as(sub: string): Transport {
  return transportFor(port, fakeJwt(sub, `${sub.replace("fake|", "")}@example.com`));
}

function commands(sub: string): Client<typeof VaultCommandController> {
  return createClient(VaultCommandController, as(sub));
}

function queries(sub: string): Client<typeof VaultQueryController> {
  return createClient(VaultQueryController, as(sub));
}

async function failureOf(promise: Promise<unknown>): Promise<ConnectError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
  throw new Error("expected a refusal");
}

let counter = 0;
function sharedInput(extra: { externalId?: string; slug?: string; org?: string } = {}) {
  counter += 1;
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Vault",
    metadata: {
      name: `Support tools ${counter}`,
      org: extra.org ?? ORG,
      ...(extra.slug === undefined ? {} : { slug: extra.slug }),
    },
    spec: {
      description: "the support team's keys",
      ...(extra.externalId === undefined ? {} : { externalId: extra.externalId }),
    },
  };
}

/** No value in any vault a response carries. */
function expectNoValues(vault: Vault | undefined): void {
  for (const secret of Object.values(vault?.spec?.secrets ?? {})) {
    expect(secret.value).toBe("");
  }
  for (const connection of Object.values(vault?.spec?.connections ?? {})) {
    expect(connection.token).toBe("");
    expect(connection.signIn?.refreshToken ?? "").toBe("");
  }
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "vault-controller-"));
  const unit: ServerExtension = {
    name: "vault-table-authorizer",
    requireAuthentication: true,
    identityVerifiers: [fakeVerifier],
    authorizer: tableAuthorizer,
  };
  server = await composeServer({
    config: loadConfig(baseConfig(dir)),
    logger: silentLogger,
    extensions: [unit],
    portOverride: 0,
    host: "127.0.0.1",
  });
  port = await server.start();
  for (const slug of [ORG, OTHER_ORG]) {
    const created = await createClient(OrganizationCommandController, as(ADMIN)).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: slug, slug, org: "" },
      spec: { description: slug },
    });
    if (slug === ORG) {
      orgId = created.metadata!.id;
    }
  }
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
});

describe("create", () => {
  it("makes a shared vault owned by its organization, empty and private", async () => {
    const created = await commands(ADMIN).create(sharedInput());
    expect(created.metadata?.id).toMatch(/^vlt_/);
    expect(created.spec?.owner).toEqual({ case: "org", value: orgId });
    expect(created.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
    expect(created.spec?.secrets).toEqual({});
  });

  it("an admin may create it shared with the organization; a vault naming a person is refused, shared or not", async () => {
    const shared = await commands(ADMIN).create({
      ...sharedInput(),
      metadata: { ...sharedInput().metadata, visibility: ApiResourceVisibility.visibility_org },
    });
    expect(shared.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    expect(shared.spec?.owner).toEqual({ case: "org", value: orgId });

    const withPerson = sharedInput();
    const personOwned = await failureOf(
      commands(ADMIN).create({
        ...withPerson,
        metadata: { ...withPerson.metadata, visibility: ApiResourceVisibility.visibility_org },
        spec: { ...withPerson.spec, owner: { case: "person", value: ADMIN } },
      }),
    );
    expect(personOwned.code).toBe(Code.InvalidArgument);
  });

  it("refuses a person owner, entries, My vault's slug prefix, and a member", async () => {
    const withPerson = sharedInput();
    const personOwned = await failureOf(
      commands(ADMIN).create({
        ...withPerson,
        spec: { ...withPerson.spec, owner: { case: "person", value: ADMIN } },
      }),
    );
    expect(personOwned.code).toBe(Code.InvalidArgument);

    const withEntries = sharedInput();
    const entries = await failureOf(
      commands(ADMIN).create({
        ...withEntries,
        spec: { ...withEntries.spec, secrets: { API_KEY: { value: "sk" } } },
      }),
    );
    expect(entries.code).toBe(Code.InvalidArgument);

    const slug = await failureOf(
      commands(ADMIN).create(sharedInput({ slug: "my-vault-team" })),
    );
    expect(slug.code).toBe(Code.InvalidArgument);
    expect(slug.rawMessage).toBe(MY_VAULT_SLUG_REFUSAL);

    const member = await failureOf(commands(ANA).create(sharedInput()));
    expect(member.code).toBe(Code.PermissionDenied);
  });
});

describe("update", () => {
  it("keeps the stored owner and entries, and refuses an owner change", async () => {
    const created = await commands(ADMIN).create(sharedInput());
    const id = created.metadata!.id;
    await commands(ADMIN).setSecrets({
      vault: { org: ORG, vault: { case: "id", value: id } },
      secrets: { API_KEY: { value: "sk-1", description: "" } },
    });
    const updated = await commands(ADMIN).update({
      ...created,
      metadata: { ...created.metadata!, name: "Renamed" },
      spec: { ...created.spec!, description: "new words", secrets: {} },
    });
    expect(updated.metadata?.name).toBe("Renamed");
    expect(updated.spec?.description).toBe("new words");
    expect(Object.keys(updated.spec?.secrets ?? {})).toEqual(["API_KEY"]);
    expectNoValues(updated);

    const moved = await failureOf(
      commands(ADMIN).update({
        ...created,
        spec: { ...created.spec!, owner: { case: "person", value: ADMIN } },
      }),
    );
    expect(moved.code).toBe(Code.InvalidArgument);
    expect(moved.rawMessage).toBe(OWNER_IMMUTABLE_REFUSAL);
  });
});

describe("external ids", () => {
  it("are claimed, refused when taken, moved on change, freed on clear and on delete, and found", async () => {
    const first = await commands(ADMIN).create(sharedInput({ externalId: "customer-1" }));
    const taken = await failureOf(
      commands(ADMIN).create(sharedInput({ externalId: "customer-1" })),
    );
    expect(taken.code).toBe(Code.AlreadyExists);
    expect(taken.rawMessage).toContain(first.metadata!.id);

    expect(
      (await queries(ADMIN).getByExternalId({ org: ORG, externalId: "customer-1" }))
        .metadata?.id,
    ).toBe(first.metadata!.id);

    // Moved: the new id finds it and the old one is free again.
    await commands(ADMIN).update({
      ...first,
      spec: { ...first.spec!, externalId: "customer-2" },
    });
    expect(
      (await queries(ADMIN).getByExternalId({ org: ORG, externalId: "customer-2" }))
        .metadata?.id,
    ).toBe(first.metadata!.id);
    const reuse = await commands(ADMIN).create(sharedInput({ externalId: "customer-1" }));

    // Cleared, then deleted: both ids are free.
    await commands(ADMIN).update({ ...first, spec: { ...first.spec!, externalId: "" } });
    await commands(ADMIN).create(sharedInput({ externalId: "customer-2" }));
    await commands(ADMIN).delete({ resourceId: reuse.metadata!.id });
    await commands(ADMIN).create(sharedInput({ externalId: "customer-1" }));

    const unknown = await failureOf(
      queries(ADMIN).getByExternalId({ org: ORG, externalId: "nobody" }),
    );
    expect(unknown.code).toBe(Code.NotFound);
  });

  it("tell a caller nothing about an external id they may not see: NOT_FOUND for a vault they may not view, PERMISSION_DENIED for an organization they cannot see", async () => {
    await commands(ADMIN).create(sharedInput({ externalId: "customer-private" }));
    expect(
      (await queries(BEN).getByExternalId({ org: ORG, externalId: "customer-private" })).spec?.externalId,
    ).toBe("customer-private");

    const held = await failureOf(
      queries(ANA).getByExternalId({ org: ORG, externalId: "customer-private" }),
    );
    const free = await failureOf(
      queries(ANA).getByExternalId({ org: ORG, externalId: "customer-nobody" }),
    );
    expect([held.code, free.code]).toEqual([Code.NotFound, Code.NotFound]);
    expect(held.rawMessage.replace("customer-private", "<id>")).toBe(
      free.rawMessage.replace("customer-nobody", "<id>"),
    );

    for (const externalId of ["customer-private", "customer-nobody"]) {
      const outside = await failureOf(queries(OUTSIDER).getByExternalId({ org: ORG, externalId }));
      expect(outside.code).toBe(Code.PermissionDenied);
      expect(outside.rawMessage).toBe("unauthorized to get vault");
    }

    await commands(ADMIN).create(sharedInput({ externalId: OUTAGE_EXTERNAL_ID }));
    const outage = await failureOf(
      queries(ADMIN).getByExternalId({ org: ORG, externalId: OUTAGE_EXTERNAL_ID }),
    );
    expect(outage.code).toBe(Code.Internal);
  });
});

describe("entries, My vault and visibility", () => {
  it("`mine` creates My vault on the first write; getMine is NOT_FOUND before it", async () => {
    const before = await failureOf(queries(ANA).getMine({ org: ORG }));
    expect(before.code).toBe(Code.NotFound);

    const written = await commands(ANA).setSecrets({
      vault: { org: ORG, vault: { case: "mine", value: true } },
      secrets: { OPENAI_API_KEY: { value: "sk-ana", description: "" } },
    });
    expect(personOf(written)).toBe(ANA);
    expectNoValues(written);

    const mine = await queries(ANA).getMine({ org: ORG });
    expect(mine.metadata?.id).toBe(written.metadata?.id);
    expect(Object.keys(mine.spec?.secrets ?? {})).toEqual(["OPENAI_API_KEY"]);
    expectNoValues(mine);

    // A login by address, normalized; no value comes back.
    const withLogin = await commands(ANA).setConnection({
      vault: { org: ORG, vault: { case: "mine", value: true } },
      address: "https://MCP.Linear.app/mcp/",
      token: "lin-ana",
      description: "",
    });
    expect(Object.keys(withLogin.spec?.connections ?? {})).toEqual([
      "https://mcp.linear.app/mcp",
    ]);
    expectNoValues(withLogin);
  });

  it("refuses `mine` to a caller who may keep no My vault in the organization", async () => {
    const guest = await failureOf(
      commands(GUEST).setSecrets({
        vault: { org: ORG, vault: { case: "mine", value: true } },
        secrets: { K: { value: "v", description: "" } },
      }),
    );
    expect(guest.code).toBe(Code.PermissionDenied);
  });

  it("an id asks can_edit: the admin writes a shared vault, a user of it may not", async () => {
    const shared = await commands(ADMIN).create(sharedInput());
    const target = { org: ORG, vault: { case: "id" as const, value: shared.metadata!.id } };
    await commands(ADMIN).setSecrets({
      vault: target,
      secrets: { ZENDESK_KEY: { value: "zd", description: "" } },
    });
    const ben = await failureOf(
      commands(BEN).setSecrets({
        vault: target,
        secrets: { ZENDESK_KEY: { value: "mine-now", description: "" } },
      }),
    );
    expect(ben.code).toBe(Code.PermissionDenied);
    const anaEditsBens = await failureOf(
      commands(ANA).removeSecrets({ vault: target, names: ["ZENDESK_KEY"] }),
    );
    expect(anaEditsBens.code).toBe(Code.PermissionDenied);
  });

  it("another organization's vault named under this one is NOT_FOUND", async () => {
    const elsewhere = await commands(ADMIN).create(sharedInput({ org: OTHER_ORG }));
    const failure = await failureOf(
      commands(ADMIN).setSecrets({
        vault: { org: ORG, vault: { case: "id", value: elsewhere.metadata!.id } },
        secrets: { K: { value: "v", description: "" } },
      }),
    );
    expect(failure.code).toBe(Code.NotFound);
  });

  it("an address that breaks the rule is INVALID_ARGUMENT, and so is the redaction marker as a value", async () => {
    const badAddress = await failureOf(
      commands(ANA).setConnection({
        vault: { org: ORG, vault: { case: "mine", value: true } },
        address: "ftp://files.example.com",
        token: "t",
        description: "",
      }),
    );
    expect(badAddress.code).toBe(Code.InvalidArgument);
    const marker = await failureOf(
      commands(ANA).setSecrets({
        vault: { org: ORG, vault: { case: "mine", value: true } },
        secrets: { K: { value: "***REDACTED***", description: "" } },
      }),
    );
    expect(marker.code).toBe(Code.InvalidArgument);
  });

  it("updateVisibility shares a shared vault and refuses My vault", async () => {
    const shared = await commands(ADMIN).create(sharedInput());
    const widened = await commands(ADMIN).updateVisibility({
      resourceId: shared.metadata!.id,
      visibility: ApiResourceVisibility.visibility_org,
    });
    expect(widened.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);

    const mine = await queries(ANA).getMine({ org: ORG });
    const refused = await failureOf(
      commands(ANA).updateVisibility({
        resourceId: mine.metadata!.id,
        visibility: ApiResourceVisibility.visibility_org,
      }),
    );
    expect(refused.code).toBe(Code.FailedPrecondition);
  });

  it("My vault takes no external id", async () => {
    const mine = await queries(ANA).getMine({ org: ORG });
    const refused = await failureOf(
      commands(ANA).update({ ...mine, spec: { ...mine.spec!, externalId: "x" } }),
    );
    expect(refused.code).toBe(Code.InvalidArgument);
  });
});

describe("list", () => {
  it("shows the caller's own My vault and the shared vaults, never another person's My vault, and no values", async () => {
    await commands(BEN).setSecrets({
      vault: { org: ORG, vault: { case: "mine", value: true } },
      secrets: { BEN_ONLY: { value: "b", description: "" } },
    });
    const anaMine = await queries(ANA).getMine({ org: ORG });
    const benMine = await queries(BEN).getMine({ org: ORG });

    const anas = await queries(ANA).list({ org: ORG });
    const ids = anas.items.map((vault) => vault.metadata?.id);
    expect(ids).toContain(anaMine.metadata?.id);
    expect(ids).not.toContain(benMine.metadata?.id);
    expect(anas.items.some((vault) => personOf(vault) === undefined)).toBe(true);
    for (const vault of anas.items) {
      expectNoValues(vault);
    }
    expect(anas.totalCount).toBe(anas.items.length);
  });

  it("nobody reads another person's My vault by id, an admin included", async () => {
    const anaMine = await queries(ANA).getMine({ org: ORG });
    const failure = await failureOf(queries(ADMIN).get({ value: anaMine.metadata!.id }));
    expect(failure.code).toBe(Code.PermissionDenied);
  });
});

describe("reads and refusals at the edges", () => {
  const CARA = "fake|cara";

  it("get and getByReference answer a vault the caller may view, with no values", async () => {
    const created = await commands(ADMIN).create(sharedInput());
    const id = created.metadata!.id;
    await commands(ADMIN).setSecrets({
      vault: { org: ORG, vault: { case: "id", value: id } },
      secrets: { API_KEY: { value: "sk-read", description: "" } },
    });
    const byId = await queries(ADMIN).get({ value: id });
    expect(byId.metadata?.id).toBe(id);
    expectNoValues(byId);
    const byRef = await queries(ADMIN).getByReference({
      org: ORG,
      kind: ApiResourceKind.vault,
      slug: created.metadata!.slug,
    });
    expect(byRef.metadata?.id).toBe(id);
    expect(Object.keys(byRef.spec?.secrets ?? {})).toEqual(["API_KEY"]);
    expectNoValues(byRef);
  });

  it("removing from My vault before its first write is NOT_FOUND", async () => {
    const mine = { org: ORG, vault: { case: "mine" as const, value: true } };
    const secrets = await failureOf(commands(CARA).removeSecrets({ vault: mine, names: ["X"] }));
    expect(secrets.code).toBe(Code.NotFound);
    const logins = await failureOf(
      commands(CARA).removeConnections({ vault: mine, addresses: ["github.com"] }),
    );
    expect(logins.code).toBe(Code.NotFound);
  });

  it("a refused first write creates no My vault", async () => {
    const DANA = "fake|dana";
    const mine = { org: ORG, vault: { case: "mine" as const, value: true } };
    const reserved = await failureOf(
      commands(DANA).setSecrets({
        vault: mine,
        secrets: { constructor: { value: "v", description: "" } },
      }),
    );
    expect(reserved.code).toBe(Code.InvalidArgument);
    const badAddress = await failureOf(
      commands(DANA).setConnection({
        vault: mine,
        address: "ftp://files.example.com",
        token: "t",
        description: "",
      }),
    );
    expect(badAddress.code).toBe(Code.InvalidArgument);
    const none = await failureOf(queries(DANA).getMine({ org: ORG }));
    expect(none.code).toBe(Code.NotFound);
  });

  it("refuses an empty vault id, server-shaped values and an unknown vault", async () => {
    const empty = await failureOf(
      commands(ADMIN).setSecrets({
        vault: { org: ORG, vault: { case: "id", value: "" } },
        secrets: { API_KEY: { value: "sk", description: "" } },
      }),
    );
    expect(empty.code).toBe(Code.InvalidArgument);

    const forged = await failureOf(
      commands(ANA).setSecrets({
        vault: { org: ORG, vault: { case: "mine", value: true } },
        secrets: { API_KEY: { value: "enc:v1:Zm9yZ2Vk", description: "" } },
      }),
    );
    expect(forged.code).toBe(Code.InvalidArgument);

    const unknown = await failureOf(
      commands(ADMIN).removeConnections({
        vault: { org: ORG, vault: { case: "id", value: "vlt_nope" } },
        addresses: ["github.com"],
      }),
    );
    expect(unknown.code).toBe(Code.NotFound);
  });

  it("refuses moving an external id onto one another vault holds", async () => {
    await commands(ADMIN).create(sharedInput({ externalId: "taken-by-first" }));
    const second = await commands(ADMIN).create(sharedInput({ externalId: "second-own" }));
    const moved = await failureOf(
      commands(ADMIN).update({
        ...second,
        spec: { ...second.spec!, externalId: "taken-by-first" },
      }),
    );
    expect(moved.code).toBe(Code.AlreadyExists);
    // The second vault still answers to its own id.
    const found = await queries(ADMIN).getByExternalId({ org: ORG, externalId: "second-own" });
    expect(found.metadata?.id).toBe(second.metadata?.id);
  });

  it("narrows a shared vault back to private", async () => {
    const created = await commands(ADMIN).create(sharedInput());
    const id = created.metadata!.id;
    await commands(ADMIN).updateVisibility({
      resourceId: id,
      visibility: ApiResourceVisibility.visibility_org,
    });
    const narrowed = await commands(ADMIN).updateVisibility({
      resourceId: id,
      visibility: ApiResourceVisibility.visibility_private,
    });
    expect(narrowed.metadata?.visibility).toBe(ApiResourceVisibility.visibility_private);
  });
});

describe("values from a request, and values in a response", () => {
  /** The stored row's entries as bytes: every secret and login exactly as the row holds it. */
  async function storedEntries(id: string): Promise<Uint8Array> {
    const row = await server.store.getResource(ApiResourceKind.vault, id, VaultSchema);
    return toBinary(
      VaultSpecSchema,
      create(VaultSpecSchema, {
        secrets: row.spec?.secrets ?? {},
        connections: row.spec?.connections ?? {},
      }),
    );
  }

  it("setConnection refuses a token shaped like server ciphertext, enc:v1: and enc:v2: alike, before anything is written", async () => {
    const ERIN = "fake|erin";
    for (const token of ["enc:v1:Zm9yZ2Vk", "enc:v2:Zm9yZ2VkLXYy"]) {
      const forged = await failureOf(
        commands(ERIN).setConnection({
          vault: { org: ORG, vault: { case: "mine", value: true } },
          address: "https://mcp.linear.app/mcp",
          token,
          description: "",
        }),
      );
      expect(forged.code).toBe(Code.InvalidArgument);
      expect(forged.rawMessage).toBe(forgedCiphertextMessage("the login's token"));
    }
    const none = await failureOf(queries(ERIN).getMine({ org: ORG }));
    expect(none.code).toBe(Code.NotFound);
  });

  it("an update carrying a secret's value and a login's token stores neither: the entries stay byte-identical", async () => {
    const created = await commands(ADMIN).create(sharedInput());
    const id = created.metadata!.id;
    const target = { org: ORG, vault: { case: "id" as const, value: id } };
    await commands(ADMIN).setSecrets({
      vault: target,
      secrets: { API_KEY: { value: "sk-saved", description: "" } },
    });
    await commands(ADMIN).setConnection({
      vault: target,
      address: "https://mcp.linear.app/mcp",
      token: "lin-saved",
      description: "",
    });
    const before = await storedEntries(id);

    const updated = await commands(ADMIN).update({
      ...created,
      metadata: { ...created.metadata!, name: "Renamed with values" },
      spec: {
        ...created.spec!,
        // A message spread keeps its type, so the entries are messages too.
        secrets: {
          API_KEY: create(VaultSecretSchema, { value: "sk-from-update" }),
          NEW_KEY: create(VaultSecretSchema, { value: "new-from-update" }),
        },
        connections: {
          "https://mcp.linear.app/mcp": create(VaultConnectionSchema, { token: "lin-from-update" }),
          "github.com": create(VaultConnectionSchema, { token: "gh-from-update" }),
        },
      },
    });
    expect(updated.metadata?.name).toBe("Renamed with values");
    expectNoValues(updated);
    expect(await storedEntries(id)).toEqual(before);
    const row = JSON.stringify(
      await server.store.getResource(ApiResourceKind.vault, id, VaultSchema),
      (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
    );
    for (const sent of ["sk-from-update", "new-from-update", "lin-from-update", "gh-from-update"]) {
      expect(row).not.toContain(sent);
    }
  });

  it("updateVisibility and getByExternalId answer a vault holding a secret and a sign-in with no value, token or refresh token", async () => {
    const created = await commands(ADMIN).create(sharedInput({ externalId: "redaction-1" }));
    const id = created.metadata!.id;
    const sent = ["sk-redact", "signin-access", "signin-refresh"];
    await server.store.updateResource(ApiResourceKind.vault, id, VaultSchema, (row) => {
      const spec = row.spec!;
      spec.secrets["API_KEY"] = create(VaultSecretSchema, { value: "sk-redact" });
      spec.connections["https://mcp.linear.app/mcp"] = create(VaultConnectionSchema, {
        token: "signin-access",
        source: VaultConnectionSource.sign_in,
        signIn: {
          expiresAt: 1n,
          clientId: "c",
          authMethod: "mcp_oauth",
          tokenEndpoint: "https://linear.example/token",
          refreshToken: "signin-refresh",
          mcpServerId: "mcp_linear",
        },
      });
    });
    const answered = (vault: Vault): string =>
      JSON.stringify(vault, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      );

    const widened = await commands(ADMIN).updateVisibility({
      resourceId: id,
      visibility: ApiResourceVisibility.visibility_org,
    });
    expect(widened.metadata?.visibility).toBe(ApiResourceVisibility.visibility_org);
    expect(Object.keys(widened.spec?.connections ?? {})).toEqual(["https://mcp.linear.app/mcp"]);
    expect(widened.spec?.connections["https://mcp.linear.app/mcp"]?.signIn?.clientId).toBe("c");
    expectNoValues(widened);

    const found = await queries(ADMIN).getByExternalId({ org: ORG, externalId: "redaction-1" });
    expect(found.metadata?.id).toBe(id);
    expect(found.spec?.connections["https://mcp.linear.app/mcp"]?.signIn?.clientId).toBe("c");
    expectNoValues(found);

    for (const vault of [widened, found]) {
      for (const value of sent) {
        expect(answered(vault)).not.toContain(value);
      }
    }
    // The row still holds them: the responses were redacted, not the vault emptied.
    const row = await server.store.getResource(ApiResourceKind.vault, id, VaultSchema);
    expect(row.spec?.secrets["API_KEY"]?.value).toBe("sk-redact");
    expect(row.spec?.connections["https://mcp.linear.app/mcp"]?.signIn?.refreshToken).toBe(
      "signin-refresh",
    );
  });
});

describe("updateVisibility on a composition with no Authorizer", () => {
  let openDir: string;
  let open: ComposedServer;
  let openPort: number;

  beforeAll(async () => {
    openDir = mkdtempSync(path.join(tmpdir(), "vault-controller-open-"));
    open = await composeServer({
      config: loadConfig(baseConfig(openDir)),
      logger: silentLogger,
      portOverride: 0,
      host: "127.0.0.1",
    });
    openPort = await open.start();
    await createClient(OrganizationCommandController, transportFor(openPort)).create({
      apiVersion: "tenancy.stigmer.ai/v1",
      kind: "Organization",
      metadata: { name: ORG, slug: ORG, org: "" },
      spec: { description: ORG },
    });
  });

  afterAll(async () => {
    await open.shutdown();
    rmSync(openDir, { recursive: true, force: true });
  });

  it("an unknown id with a level the kind refuses is NOT_FOUND; a known one is INVALID_ARGUMENT", async () => {
    const openCommands = createClient(VaultCommandController, transportFor(openPort));
    const known = await openCommands.create(sharedInput());
    for (const visibility of [
      ApiResourceVisibility.visibility_public,
      ApiResourceVisibility.visibility_child_orgs,
    ]) {
      const refused = await failureOf(
        openCommands.updateVisibility({ resourceId: known.metadata!.id, visibility }),
      );
      expect(refused.code).toBe(Code.InvalidArgument);

      const unknown = await failureOf(
        openCommands.updateVisibility({ resourceId: "vlt_does_not_exist", visibility }),
      );
      expect(unknown.code).toBe(Code.NotFound);
    }
  });
});

describe("decodeVaultRows", () => {
  it("skips a row that does not decode", () => {
    const good = toBinary(VaultSchema, create(VaultSchema, { metadata: { id: "vlt_ok" } }));
    const vaults = decodeVaultRows([{ data: new Uint8Array([0xff, 0xff, 0xff]) }, { data: good }]);
    expect(vaults.map((vault) => vault.metadata?.id)).toEqual(["vlt_ok"]);
  });
});
