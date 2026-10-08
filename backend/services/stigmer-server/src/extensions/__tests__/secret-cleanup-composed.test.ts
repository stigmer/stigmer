/**
 * Pins the secret-cleanup wiring END TO END: a composed server with an
 * extension-registered fake "v9"
 * codec (write version v9, so every sealed value has recordable backing
 * state) proves, through real gRPC calls, that:
 *
 *   - the three delete chains (vault, oauthapp, channelapp) destroy
 *     exactly the doomed resource's sealed values;
 *   - the vault's entry removals destroy the removed entries and ignore
 *     unknown ones, while a replaced secret or login keeps its backing
 *     state (a codec keyed by entry keeps the replacement in the same
 *     place; superseded versions age out under its retention);
 *   - the session update chain destroys ONLY the session's own values it
 *     drops: a replaced value and a marker-preserved one are untouched;
 *   - a destroy failure NEVER fails the request (best-effort after the
 *     store write);
 *   - the composed facade rides ComposedServer.secrets
 *     — the same instance the domains sealed with.
 *
 * The v1-only default arm (cleanup as a silent no-op) is pinned by the
 * conformance rosters; the unit-level contract lives in
 * pipeline/steps/__tests__/secret-cleanup.test.ts.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppCommandController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/command_pb";
import { SessionSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { SessionCommandController } from "@stigmer/protos/ai/stigmer/agentic/session/v1/command_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { VaultCommandController } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/command_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { OAuthAppSchema } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/api_pb";
import { OAuthAppCommandController } from "@stigmer/protos/ai/stigmer/iam/oauthapp/v1/command_pb";

import { loadConfig } from "../../boot/config.js";
import { composeServer } from "../../boot/compose.js";
import type { ComposedServer } from "../../boot/compose.js";
import { createLogger } from "../../boot/logger.js";
import type { SecretCodec } from "../../encryption/codec.js";
import type { EncryptionScope } from "../../encryption/encryption.js";
import { REDACTED_MARKER } from "../../encryption/encryption.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import { seedOrganizations } from "../../domain/organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const TEST_KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const ORG = "acme";

/** The recordable backing state: delete() logs calls; failNext arms throws. */
class RecordingCodec implements SecretCodec {
  readonly version = "v9";
  readonly deleted: string[] = [];
  readonly failNext: Error[] = [];

  async encrypt(plaintext: string, _scope: EncryptionScope): Promise<string> {
    return `enc:v9:${Buffer.from(plaintext, "utf8").toString("base64")}`;
  }

  async decrypt(encrypted: string): Promise<string> {
    return Buffer.from(encrypted.slice("enc:v9:".length), "base64").toString(
      "utf8",
    );
  }

  async delete(storedValue: string): Promise<void> {
    const failure = this.failNext.shift();
    if (failure !== undefined) {
      throw failure;
    }
    this.deleted.push(storedValue);
  }
}

const codec = new RecordingCodec();

let server: ComposedServer;
let dir: string;
let vaultCommand: Client<typeof VaultCommandController>;
let sessionCommand: Client<typeof SessionCommandController>;
let oauthCommand: Client<typeof OAuthAppCommandController>;
let channelCommand: Client<typeof ChannelAppCommandController>;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "secret-cleanup-composed-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", TEST_KEY_B64);
  // The composition posture under test: extension codec v9 IS the write
  // version, so freshly sealed values carry recordable backing state.
  vi.stubEnv("STIGMER_ENCRYPTION_WRITE_VERSION", "v9");
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      STORAGE_PATH: path.join(dir, "storage"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    extensions: [
      {
        name: "fake-secret-codecs",
        drivers: {
          secretCodecs: new Map<string, SecretCodec>([["v9", codec]]),
        },
      },
    ],
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  await seedOrganizations(transport, [ORG]);
  vaultCommand = createClient(VaultCommandController, transport);
  sessionCommand = createClient(SessionCommandController, transport);
  oauthCommand = createClient(OAuthAppCommandController, transport);
  channelCommand = createClient(ChannelAppCommandController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

beforeEach(() => {
  codec.deleted.length = 0;
  codec.failNext.length = 0;
});

let counter = 0;

/** A shared vault holding the given secrets, and its id. */
async function vaultWith(secrets: Record<string, string>): Promise<string> {
  counter += 1;
  const created = await vaultCommand.create({
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Vault",
    metadata: { name: `Cleanup Vault ${counter}`, org: ORG },
    spec: { description: "secret-cleanup composed pin" },
  });
  const id = created.metadata!.id;
  if (Object.keys(secrets).length > 0) {
    await vaultCommand.setSecrets({
      vault: { org: ORG, vault: { case: "id", value: id } },
      secrets: Object.fromEntries(
        Object.entries(secrets).map(([name, value]) => [
          name,
          { value, description: "" },
        ]),
      ),
    });
  }
  return id;
}

async function storedVaultSecrets(id: string): Promise<Record<string, string>> {
  const vault = await server.store.getResource(
    ApiResourceKind.vault,
    id,
    VaultSchema,
  );
  return Object.fromEntries(
    Object.entries(vault.spec?.secrets ?? {}).map(([k, v]) => [k, v.value]),
  );
}

describe("the composed facade exposure", () => {
  it("ComposedServer.secrets is the instance the domains sealed with", async () => {
    const id = await vaultWith({ TOKEN: "open-sesame" });
    const stored = await storedVaultSecrets(id);
    expect(stored["TOKEN"]).toMatch(/^enc:v9:/);
    expect(await server.secrets.decrypt(stored["TOKEN"]!)).toBe("open-sesame");
  });
});

describe("delete chains destroy sealed backing state", () => {
  it("vault delete destroys every sealed value, secrets and logins alike", async () => {
    const id = await vaultWith({ FIRST: "secret-one", SECOND: "secret-two" });
    await vaultCommand.setConnection({
      vault: { org: ORG, vault: { case: "id", value: id } },
      address: "https://mcp.example.com/mcp",
      token: "login-token",
      description: "",
    });
    const vault = await server.store.getResource(
      ApiResourceKind.vault,
      id,
      VaultSchema,
    );
    const sealed = [
      vault.spec!.secrets["FIRST"]!.value,
      vault.spec!.secrets["SECOND"]!.value,
      vault.spec!.connections["https://mcp.example.com/mcp"]!.token,
    ];

    await vaultCommand.delete({ resourceId: id });

    expect([...codec.deleted].sort()).toEqual([...sealed].sort());
  });

  it("oauthapp delete destroys the sealed client secret", async () => {
    counter += 1;
    const created = await oauthCommand.create({
      apiVersion: "iam.stigmer.ai/v1",
      kind: "OAuthApp",
      metadata: { name: `Cleanup Vendor ${counter}`, org: ORG },
      spec: {
        provider: "TestVendor",
        clientId: "client-id",
        clientSecret: "vendor-client-secret",
        authorizationUrl: "https://vendor.example.com/oauth/authorize",
        tokenUrl: "https://vendor.example.com/oauth/token",
        scopes: ["read"],
      },
    });
    const storedApp = await server.store.getResource(
      ApiResourceKind.oauth_app,
      created.metadata!.id,
      OAuthAppSchema,
    );
    const sealed = storedApp.spec!.clientSecret;
    expect(sealed).toMatch(/^enc:v9:/);

    await oauthCommand.delete({ resourceId: created.metadata!.id });

    expect(codec.deleted).toEqual([sealed]);
  });

  it("channelapp delete destroys the provider arm's sealed fields", async () => {
    counter += 1;
    const created = await channelCommand.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "ChannelApp",
      metadata: { name: `Cleanup Slack ${counter}`, org: ORG },
      spec: {
        providerConfig: {
          case: "slack" as const,
          value: {
            clientId: "1234.5678",
            clientSecret: "shh-client-secret",
            signingSecret: "shh-signing-secret",
          },
        },
      },
    });
    const storedApp = await server.store.getResource(
      ApiResourceKind.channel_app,
      created.metadata!.id,
      ChannelAppSchema,
    );
    const slack =
      storedApp.spec?.providerConfig.case === "slack"
        ? storedApp.spec.providerConfig.value
        : undefined;
    expect(slack).toBeDefined();

    await channelCommand.delete({ resourceId: created.metadata!.id });

    expect([...codec.deleted].sort()).toEqual(
      [slack!.clientSecret, slack!.signingSecret].sort(),
    );
  });

  it("a destroy failure never fails the delete (best-effort after the row is gone)", async () => {
    const id = await vaultWith({ DOOMED: "secret" });
    codec.failNext.push(new Error("vault is down"));

    await expect(vaultCommand.delete({ resourceId: id })).resolves.toBeDefined();

    await expect(
      server.store.getResource(ApiResourceKind.vault, id, VaultSchema),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(codec.deleted).toEqual([]);
  });
});

describe("vault entry writes", () => {
  it("removeSecrets destroys the removed secrets, ignoring unknown names", async () => {
    const id = await vaultWith({ REMOVED: "goes-away", SURVIVOR: "stays" });
    const before = await storedVaultSecrets(id);

    await vaultCommand.removeSecrets({
      vault: { org: ORG, vault: { case: "id", value: id } },
      names: ["REMOVED", "GHOST"],
    });

    expect(codec.deleted).toEqual([before["REMOVED"]!]);
    const after = await storedVaultSecrets(id);
    expect(after["SURVIVOR"]).toBe(before["SURVIVOR"]);
    expect(after["REMOVED"]).toBeUndefined();
  });

  it("a replaced secret keeps its backing state", async () => {
    const id = await vaultWith({ KEY: "old-secret" });

    await vaultCommand.setSecrets({
      vault: { org: ORG, vault: { case: "id", value: id } },
      secrets: { KEY: { value: "rotated", description: "" } },
    });

    expect(codec.deleted).toEqual([]);
    const after = await storedVaultSecrets(id);
    expect(await server.secrets.decrypt(after["KEY"]!)).toBe("rotated");
  });

  it("removeConnections destroys the removed login's token", async () => {
    const id = await vaultWith({});
    const target = { org: ORG, vault: { case: "id" as const, value: id } };
    await vaultCommand.setConnection({
      vault: target,
      address: "https://mcp.example.com/mcp",
      token: "login-token",
      description: "",
    });
    const vault = await server.store.getResource(
      ApiResourceKind.vault,
      id,
      VaultSchema,
    );
    const sealed = vault.spec!.connections["https://mcp.example.com/mcp"]!.token;

    await vaultCommand.removeConnections({
      vault: target,
      addresses: ["https://MCP.example.com/mcp/"],
    });

    expect(codec.deleted).toEqual([sealed]);
  });
});

describe("a session's own values", () => {
  it("an update destroys ONLY the values it drops: replaced and marker-preserved ones are untouched", async () => {
    counter += 1;
    const created = await sessionCommand.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: { name: `Cleanup Session ${counter}`, org: ORG },
      spec: {
        secrets: { DROPPED: "goes-away", KEPT: "stays", ROTATED: "old" },
      },
    });
    const id = created.metadata!.id;
    const stored = await server.store.getResource(
      ApiResourceKind.session,
      id,
      SessionSchema,
    );
    const before = stored.spec!.secrets;
    expect(before["KEPT"]).toMatch(/^enc:v9:/);

    await sessionCommand.update({
      ...created,
      spec: {
        ...created.spec!,
        secrets: { KEPT: REDACTED_MARKER, ROTATED: "new" },
      },
    });

    expect(codec.deleted).toEqual([before["DROPPED"]!]);
    const after = await server.store.getResource(
      ApiResourceKind.session,
      id,
      SessionSchema,
    );
    expect(after.spec!.secrets["KEPT"]).toBe(before["KEPT"]);
    expect(await server.secrets.decrypt(after.spec!.secrets["ROTATED"]!)).toBe(
      "new",
    );
  });

  it("a session delete destroys every value it held", async () => {
    counter += 1;
    const created = await sessionCommand.create({
      apiVersion: "agentic.stigmer.ai/v1",
      kind: "Session",
      metadata: { name: `Cleanup Session ${counter}`, org: ORG },
      spec: { secrets: { ONE: "first" }, connections: { "github.com": "tok" } },
    });
    const stored = await server.store.getResource(
      ApiResourceKind.session,
      created.metadata!.id,
      SessionSchema,
    );
    const sealed = [
      stored.spec!.secrets["ONE"]!,
      stored.spec!.connections["github.com"]!,
    ];

    await sessionCommand.delete({ value: created.metadata!.id });

    expect([...codec.deleted].sort()).toEqual([...sealed].sort());
  });
});
