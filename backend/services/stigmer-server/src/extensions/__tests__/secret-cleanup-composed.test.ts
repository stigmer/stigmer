/**
 * Pins the Q7 secret-cleanup wiring END TO END (convergence 20260830.04
 * Stage 3): a composed server with an extension-registered fake "v9"
 * codec (write version v9, so every sealed value has recordable backing
 * state) proves, through real gRPC calls, that:
 *
 *   - the three delete chains (environment, oauthapp, channelapp)
 *     destroy exactly the doomed resource's sealed values;
 *   - the environment update chain destroys ONLY dropped keys — a
 *     rotated key keeps its backing state (superseded versions age out
 *     via the store's retention, the Java posture), and marker-preserved
 *     keys are untouched;
 *   - removeVariables destroys the removed keys and ignores unknowns;
 *     the updateVariables merge lane destroys nothing;
 *   - a destroy failure NEVER fails the request (best-effort after the
 *     store write);
 *   - the composed facade rides ComposedServer.secrets (gate ruling G2)
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
import { EnvironmentSchema } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/api_pb";
import { EnvironmentCommandController } from "@stigmer/protos/ai/stigmer/agentic/environment/v1/command_pb";
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
let envCommand: Client<typeof EnvironmentCommandController>;
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
  envCommand = createClient(EnvironmentCommandController, transport);
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
function envInput(
  data: Record<string, { value: string; isSecret: boolean }>,
  name?: string,
) {
  counter += 1;
  return {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Environment",
    metadata: { name: name ?? `Cleanup Env ${counter}`, org: ORG },
    spec: { description: "secret-cleanup composed pin", data },
  };
}

async function storedEnvData(id: string): Promise<Record<string, string>> {
  const env = await server.store.getResource(
    ApiResourceKind.environment,
    id,
    EnvironmentSchema,
  );
  return Object.fromEntries(
    Object.entries(env.spec?.data ?? {}).map(([k, v]) => [k, v.value]),
  );
}

describe("the composed facade exposure (gate ruling G2)", () => {
  it("ComposedServer.secrets is the instance the domains sealed with", async () => {
    const created = await envCommand.create(
      envInput({ TOKEN: { value: "open-sesame", isSecret: true } }),
    );
    const stored = await storedEnvData(created.metadata!.id);
    expect(stored["TOKEN"]).toMatch(/^enc:v9:/);
    expect(await server.secrets.decrypt(stored["TOKEN"]!)).toBe("open-sesame");
  });
});

describe("delete chains destroy sealed backing state", () => {
  it("environment delete destroys every sealed value, never the plain ones", async () => {
    const created = await envCommand.create(
      envInput({
        FIRST: { value: "secret-one", isSecret: true },
        SECOND: { value: "secret-two", isSecret: true },
        PLAIN: { value: "visible", isSecret: false },
      }),
    );
    const stored = await storedEnvData(created.metadata!.id);

    await envCommand.delete({ resourceId: created.metadata!.id });

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
    const created = await envCommand.create(
      envInput({ DOOMED: { value: "secret", isSecret: true } }),
    );
    codec.failNext.push(new Error("vault is down"));

    await expect(
      envCommand.delete({ resourceId: created.metadata!.id }),
    ).resolves.toBeDefined();

    await expect(
      server.store.getResource(
        ApiResourceKind.environment,
        created.metadata!.id,
        EnvironmentSchema,
      ),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
    expect(codec.deleted).toEqual([]);
  });
});

describe("environment update and variable lanes", () => {
  it("update destroys ONLY dropped keys; marker-preserved keys are untouched", async () => {
    const name = `Cleanup Env Drop ${++counter}`;
    const created = await envCommand.create(
      envInput(
        {
          DROPPED: { value: "goes-away", isSecret: true },
          KEPT: { value: "stays", isSecret: true },
        },
        name,
      ),
    );
    const before = await storedEnvData(created.metadata!.id);

    await envCommand.update(
      envInput({ KEPT: { value: REDACTED_MARKER, isSecret: true } }, name),
    );

    expect(codec.deleted).toEqual([before["DROPPED"]!]);
    const after = await storedEnvData(created.metadata!.id);
    expect(after["KEPT"]).toBe(before["KEPT"]);
    expect(after["DROPPED"]).toBeUndefined();
  });

  it("a rotated key is NOT a drop — its old backing state survives", async () => {
    const name = `Cleanup Env Rotate ${++counter}`;
    const created = await envCommand.create(
      envInput({ KEY: { value: "old-secret", isSecret: true } }, name),
    );

    await envCommand.update(
      envInput({ KEY: { value: "new-secret", isSecret: true } }, name),
    );

    expect(codec.deleted).toEqual([]);
    const after = await storedEnvData(created.metadata!.id);
    expect(await server.secrets.decrypt(after["KEY"]!)).toBe("new-secret");
  });

  it("removeVariables destroys the removed keys, ignoring unknown keys", async () => {
    const created = await envCommand.create(
      envInput({
        REMOVED: { value: "goes-away", isSecret: true },
        SURVIVOR: { value: "stays", isSecret: true },
      }),
    );
    const before = await storedEnvData(created.metadata!.id);

    await envCommand.removeVariables({
      environmentId: created.metadata!.id,
      keys: ["REMOVED", "GHOST"],
    });

    expect(codec.deleted).toEqual([before["REMOVED"]!]);
    const after = await storedEnvData(created.metadata!.id);
    expect(after["SURVIVOR"]).toBe(before["SURVIVOR"]);
  });

  it("the updateVariables merge lane destroys nothing (an overwrite keeps its path)", async () => {
    const created = await envCommand.create(
      envInput({ KEY: { value: "old-secret", isSecret: true } }),
    );

    await envCommand.updateVariables({
      environmentId: created.metadata!.id,
      variables: { KEY: { value: "rotated", isSecret: true } },
    });

    expect(codec.deleted).toEqual([]);
    const after = await storedEnvData(created.metadata!.id);
    expect(await server.secrets.decrypt(after["KEY"]!)).toBe("rotated");
  });
});
