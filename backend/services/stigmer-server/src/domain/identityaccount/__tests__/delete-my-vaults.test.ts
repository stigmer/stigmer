/**
 * Pins what an account's deletion does to the person's My vaults, through
 * a composed OSS server whose extension codec "v9" is the write version,
 * so every sealed value has backing state a destroy is recorded against:
 *
 *   - deleting an account deletes the person's My vault in every
 *     organization, each sealed value destroyed, and leaves a teammate's;
 *   - the My vaults go before the account row: a failure deleting them
 *     fails the delete and leaves the account and its vaults in place, so
 *     the same delete, retried, finishes the job instead of leaving sealed
 *     values behind an account that no longer exists.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { IdentityAccountCommandController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/command_pb";
import { IdentityAccountQueryController } from "@stigmer/protos/ai/stigmer/iam/identityaccount/v1/query_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import type { SecretCodec } from "../../../encryption/codec.js";
import type { EncryptionScope } from "../../../encryption/encryption.js";
import { testCallerIdentity } from "../../../pipeline/__tests__/support.js";
import {
  resetOperatorIdentityForTests,
  setOperatorIdentity,
} from "../../../pipeline/steps/defaults.js";
import type { Store } from "../../../store/interface.js";
import { seedOrganizations, organizationId } from "../../organization/__tests__/support.js";
import type { OrganizationIds } from "../../organization/__tests__/support.js";
import { vaultListIndex } from "../../vault/list-index.js";
import { newVaultService } from "../../vault/service.js";
import type { VaultService } from "../../vault/service.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");

/** Sealed values read `enc:v9:<base64>`; every destroy is recorded. */
class RecordingCodec implements SecretCodec {
  readonly version = "v9";
  readonly deleted: string[] = [];
  async encrypt(plaintext: string, _scope: EncryptionScope): Promise<string> {
    return `enc:v9:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  }
  async decrypt(encrypted: string): Promise<string> {
    return Buffer.from(encrypted.slice("enc:v9:".length), "base64").toString("utf8");
  }
  async delete(storedValue: string): Promise<void> {
    this.deleted.push(storedValue);
  }
}

const codec = new RecordingCodec();

let dir: string;
let server: ComposedServer;
let command: Client<typeof IdentityAccountCommandController>;
let query: Client<typeof IdentityAccountQueryController>;
let platform: Client<typeof IdentityAccountCommandController>;
let vaults: VaultService;
let orgs: OrganizationIds;
let seq = 0;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "identityaccount-delete-my-vaults-"));
  setOperatorIdentity("operator@example.com", "The Operator");
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", TEST_KEY_B64);
  vi.stubEnv("STIGMER_ENCRYPTION_WRITE_VERSION", "v9");
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
      STIGMER_OPERATOR_EMAIL: "operator@example.com",
      STIGMER_OPERATOR_NAME: "The Operator",
    }),
    logger: silentLogger,
    extensions: [
      {
        name: "recording-secret-codec",
        drivers: { secretCodecs: new Map<string, SecretCodec>([["v9", codec]]) },
      },
    ],
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({ baseUrl: `http://127.0.0.1:${port}` });
  command = createClient(IdentityAccountCommandController, transport);
  query = createClient(IdentityAccountQueryController, transport);
  platform = createClient(IdentityAccountCommandController, server.inProcessTransport);
  orgs = await seedOrganizations(transport, ["acme", "globex"]);
  vaults = newVaultService({
    store: server.store,
    logger: silentLogger,
    secretService: server.secrets,
    authorizationLifecycle: undefined,
  });
});

afterAll(async () => {
  await server.shutdown();
  resetOperatorIdentityForTests();
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  codec.deleted.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A new account, created the way the platform's own pipelines create one; its id. */
async function newAccount(): Promise<string> {
  seq += 1;
  const created = await platform.create({
    apiVersion: "iam.stigmer.ai/v1",
    kind: "IdentityAccount",
    metadata: { name: `vault-holder${seq}@example.com` },
    spec: {
      idpId: `auth0|vault-holder${seq}`,
      email: `vault-holder${seq}@example.com`,
      firstName: "Vault",
      lastName: `Holder${seq}`,
    },
  });
  return created.metadata?.id ?? "";
}

/** The person's My vault in `slug`, holding one secret; the secret's sealed value. */
async function myVaultWithSecret(person: string, slug: string): Promise<string> {
  const caller = testCallerIdentity({ identityId: person });
  const mine = await vaults.ensureMine(organizationId(orgs, slug), caller);
  const written = await vaults.setSecrets(
    mine.metadata?.id ?? "",
    { API_KEY: { value: `sk-${slug}-${person}`, description: "" } },
    caller,
  );
  const sealed = written.spec?.secrets["API_KEY"]?.value ?? "";
  expect(sealed).toMatch(/^enc:v9:/);
  return sealed;
}

describe("deleting an account deletes the person's My vaults", () => {
  it("in every organization, each sealed value destroyed, and leaves a teammate's", async () => {
    const person = await newAccount();
    const teammate = await newAccount();
    const sealed = [
      await myVaultWithSecret(person, "acme"),
      await myVaultWithSecret(person, "globex"),
    ];
    const teammates = await myVaultWithSecret(teammate, "acme");

    await command.delete({ value: person });

    for (const slug of ["acme", "globex"]) {
      expect(await vaults.findMine(organizationId(orgs, slug), person), slug).toBeUndefined();
    }
    expect([...codec.deleted].sort()).toEqual([...sealed].sort());
    expect(codec.deleted).not.toContain(teammates);
    expect(await vaults.findMine(organizationId(orgs, "acme"), teammate)).toBeDefined();
  });

  it("before the account row: a failure fails the delete and keeps both, and a retry finishes", async () => {
    const person = await newAccount();
    const sealed = await myVaultWithSecret(person, "acme");

    const queryResources = server.store.queryResources.bind(server.store);
    vi.spyOn(server.store, "queryResources").mockImplementation(((declaration, request) => {
      if (declaration === vaultListIndex) {
        return Promise.reject(new Error("vault index unavailable"));
      }
      return queryResources(declaration, request);
    }) as Store["queryResources"]);

    const failure = await command.delete({ value: person }).then(
      () => undefined,
      (error: unknown) => ConnectError.from(error),
    );
    expect(failure?.code).toBe(Code.Internal);
    // Nothing is gone: the account answers, and its vault still holds its value.
    expect((await query.get({ value: person })).metadata?.id).toBe(person);
    expect(await vaults.findMine(organizationId(orgs, "acme"), person)).toBeDefined();
    expect(codec.deleted).toEqual([]);

    vi.restoreAllMocks();
    await command.delete({ value: person });
    expect(await vaults.findMine(organizationId(orgs, "acme"), person)).toBeUndefined();
    expect(codec.deleted).toEqual([sealed]);
  });
});
