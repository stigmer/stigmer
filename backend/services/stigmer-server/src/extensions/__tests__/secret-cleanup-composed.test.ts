/**
 * Pins the secret-cleanup wiring END TO END: a composed server with an
 * extension-registered fake "v9"
 * codec (write version v9, so every sealed value has recordable backing
 * state) proves, through real gRPC calls, that:
 *
 *   - the three delete chains (credential, oauthapp, channelapp)
 *     destroy exactly the doomed resource's sealed values;
 *   - the credential update chain destroys ONLY dropped fields — a
 *     rotated field keeps its backing state (superseded versions age out
 *     via the store's retention, the Java posture), and marker-preserved
 *     fields are untouched;
 *   - removeFields destroys the removed fields and ignores unknowns;
 *     the setFields merge lane destroys nothing;
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
import { CredentialSchema } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import type { Credential } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/api_pb";
import { CredentialCommandController } from "@stigmer/protos/ai/stigmer/agentic/credential/v1/command_pb";
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
let credentialCommand: Client<typeof CredentialCommandController>;
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
  credentialCommand = createClient(CredentialCommandController, transport);
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
type FieldsInput = Record<string, { value: string; plain: boolean }>;

/** An organization's credential holding `fields` (the posture has one caller, so the organization owns it). */
function credentialInput(fields: FieldsInput) {
  counter += 1;
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Credential",
    metadata: { name: `Cleanup Credential ${counter}`, org: ORG },
    spec: {
      owner: { case: "org" as const, value: "" },
      description: "secret-cleanup composed pin",
      fields,
    },
  };
}

/** The same credential as `created`, its fields replaced by `fields`. */
function withFields(created: Credential, fields: FieldsInput) {
  return {
    apiVersion: created.apiVersion,
    kind: created.kind,
    metadata: created.metadata,
    spec: {
      owner: created.spec?.owner,
      description: created.spec?.description ?? "",
      fields,
    },
  };
}

async function storedFields(id: string): Promise<Record<string, string>> {
  const credential = await server.store.getResource(
    ApiResourceKind.credential,
    id,
    CredentialSchema,
  );
  return Object.fromEntries(
    Object.entries(credential.spec?.fields ?? {}).map(([k, v]) => [k, v.value]),
  );
}

describe("the composed facade exposure", () => {
  it("ComposedServer.secrets is the instance the domains sealed with", async () => {
    const created = await credentialCommand.create(
      credentialInput({ TOKEN: { value: "open-sesame", plain: false } }),
    );
    const stored = await storedFields(created.metadata!.id);
    expect(stored["TOKEN"]).toMatch(/^enc:v9:/);
    expect(await server.secrets.decrypt(stored["TOKEN"]!)).toBe("open-sesame");
  });
});

describe("delete chains destroy sealed backing state", () => {
  it("credential delete destroys every sealed value, never the plain ones", async () => {
    const created = await credentialCommand.create(
      credentialInput({
        FIRST: { value: "secret-one", plain: false },
        SECOND: { value: "secret-two", plain: false },
        PLAIN: { value: "visible", plain: true },
      }),
    );
    const stored = await storedFields(created.metadata!.id);

    await credentialCommand.delete({ resourceId: created.metadata!.id });

    expect([...codec.deleted].sort()).toEqual(
      [stored["FIRST"]!, stored["SECOND"]!].sort(),
    );
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
    const created = await credentialCommand.create(
      credentialInput({ DOOMED: { value: "secret", plain: false } }),
    );
    codec.failNext.push(new Error("vault is down"));

    await expect(
      credentialCommand.delete({ resourceId: created.metadata!.id }),
    ).resolves.toBeDefined();

    await expect(
      server.store.getResource(
        ApiResourceKind.credential,
        created.metadata!.id,
        CredentialSchema,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(codec.deleted).toEqual([]);
  });
});

describe("credential update and field lanes", () => {
  it("update destroys ONLY dropped fields; marker-preserved fields are untouched", async () => {
    const created = await credentialCommand.create(
      credentialInput({
        DROPPED: { value: "goes-away", plain: false },
        KEPT: { value: "stays", plain: false },
      }),
    );
    const before = await storedFields(created.metadata!.id);

    await credentialCommand.update(
      withFields(created, { KEPT: { value: REDACTED_MARKER, plain: false } }),
    );

    expect(codec.deleted).toEqual([before["DROPPED"]!]);
    const after = await storedFields(created.metadata!.id);
    expect(after["KEPT"]).toBe(before["KEPT"]);
    expect(after["DROPPED"]).toBeUndefined();
  });

  it("a rotated field is NOT a drop — its old backing state survives", async () => {
    const created = await credentialCommand.create(
      credentialInput({ KEY: { value: "old-secret", plain: false } }),
    );

    await credentialCommand.update(
      withFields(created, { KEY: { value: "new-secret", plain: false } }),
    );

    expect(codec.deleted).toEqual([]);
    const after = await storedFields(created.metadata!.id);
    expect(await server.secrets.decrypt(after["KEY"]!)).toBe("new-secret");
  });

  it("removeFields destroys the removed fields, ignoring unknown names", async () => {
    const created = await credentialCommand.create(
      credentialInput({
        REMOVED: { value: "goes-away", plain: false },
        SURVIVOR: { value: "stays", plain: false },
      }),
    );
    const before = await storedFields(created.metadata!.id);

    await credentialCommand.removeFields({
      credentialId: created.metadata!.id,
      fields: ["REMOVED", "GHOST"],
    });

    expect(codec.deleted).toEqual([before["REMOVED"]!]);
    const after = await storedFields(created.metadata!.id);
    expect(after["SURVIVOR"]).toBe(before["SURVIVOR"]);
  });

  it("the setFields merge lane destroys nothing (an overwrite keeps its path)", async () => {
    const created = await credentialCommand.create(
      credentialInput({ KEY: { value: "old-secret", plain: false } }),
    );

    await credentialCommand.setFields({
      credentialId: created.metadata!.id,
      fields: { KEY: { value: "rotated", plain: false } },
    });

    expect(codec.deleted).toEqual([]);
    const after = await storedFields(created.metadata!.id);
    expect(await server.secrets.decrypt(after["KEY"]!)).toBe("rotated");
  });
});
