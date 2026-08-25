/**
 * Pins the channelapp domain against Go's channelapp_test.go, case-for-case
 * — through the REAL stack: a composed server on an ephemeral port, a
 * native gRPC client, the full interceptor chain.
 *
 * The load-bearing pins the conformance suite CANNOT cover (it is a black
 * box; these need direct store access or key control):
 *   - secrets rest as enc:v1: CIPHERTEXT in the store and decrypt to the
 *     original plaintext — per provider arm, via the oneof-reflection
 *     tripwire (Go TestRedactAndEncryptCoverEveryProviderArm, the #324
 *     regression guard: a new provider arm fails this test until it gets
 *     redaction, encryption, and a case entry);
 *   - the marker round-trip preserves the stored ciphertext PER FIELD (one
 *     request rotates one secret while keeping the others);
 *   - the delete block fires for normalized AND pre-normalization
 *     (empty-org) app_refs, reading seeded store rows directly.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import type { ChannelApp } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { ChannelAppCommandController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/command_pb";
import { ChannelAppQueryController } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/query_pb";
import { ChannelAppSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { SecretService, isCiphertextShaped } from "../../../encryption/encryption.js";
import {
  PROVIDER_IMMUTABLE_MESSAGE,
  REDACTED_MARKER,
  deleteBlockedByChannelMessage,
  markerOnCreateMessage,
  noExistingSecretMessage,
  plaintextRequiredMessage,
} from "../constants.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

// A real 32-byte key so encrypt/redact round-trips are exercised for real
// (the Go harness posture); the same key decrypts stored values below.
const TEST_KEY = Buffer.alloc(32, 7);
const TEST_KEY_B64 = TEST_KEY.toString("base64");
const secrets = SecretService.create(TEST_KEY);

const API_VERSION = "agentic.stigmer.ai/v1";
const KIND = "ChannelApp";
const ORG = "acme";

type CommandClient = Client<typeof ChannelAppCommandController>;
type QueryClient = Client<typeof ChannelAppQueryController>;

let server: ComposedServer;
let command: CommandClient;
let query: QueryClient;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "channelapp-domain-test-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", TEST_KEY_B64);
  vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", Buffer.alloc(32, 8).toString("base64"));
  server = composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests: 127.0.0.1:1 is deterministically
      // closed, so boots fail the non-fatal connect fast and can never touch
      // a live local Temporal (the conformance CRUD harness does the same).
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  command = createClient(ChannelAppCommandController, transport);
  query = createClient(ChannelAppQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

let counter = 0;
function uniqueName(base: string): string {
  counter += 1;
  return `${base} ${counter}`;
}

function newSlackApp(name: string, org: string = ORG) {
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: { name, org },
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
  };
}

function newWhatsAppApp(name: string, org: string = ORG) {
  return {
    apiVersion: API_VERSION,
    kind: KIND,
    metadata: { name, org },
    spec: {
      providerConfig: {
        case: "whatsapp" as const,
        value: {
          appId: "108954",
          appSecret: "shh-app-secret",
          accessToken: "shh-access-token",
          verifyToken: "shh-verify-token",
        },
      },
    },
  };
}

async function readStored(id: string): Promise<ChannelApp> {
  return server.store.getResource(ApiResourceKind.channel_app, id, ChannelAppSchema);
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
    throw new Error("expected the call to fail");
  } catch (error) {
    if (error instanceof ConnectError) {
      return error;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// The provider-arm tripwire (Go TestRedactAndEncryptCoverEveryProviderArm).
// ---------------------------------------------------------------------------

describe("provider-arm redact/encrypt tripwire (#324 regression guard)", () => {
  // Per arm: an app builder whose secrets hold known plaintexts, and a
  // getter for every secret field so the assertions stay field-by-field.
  const cases: Record<
    string,
    {
      newApp: (name: string) => Parameters<CommandClient["create"]>[0];
      secretsOf: (app: ChannelApp) => Record<string, string>;
    }
  > = {
    slack: {
      newApp: (name) => newSlackApp(name),
      secretsOf: (app) => {
        const slack = app.spec?.providerConfig.case === "slack" ? app.spec.providerConfig.value : undefined;
        return {
          client_secret: slack?.clientSecret ?? "",
          signing_secret: slack?.signingSecret ?? "",
        };
      },
    },
    whatsapp: {
      newApp: (name) => newWhatsAppApp(name),
      secretsOf: (app) => {
        const wa = app.spec?.providerConfig.case === "whatsapp" ? app.spec.providerConfig.value : undefined;
        return {
          app_secret: wa?.appSecret ?? "",
          access_token: wa?.accessToken ?? "",
          verify_token: wa?.verifyToken ?? "",
        };
      },
    },
  };

  it("covers every oneof arm in the case table", () => {
    // The tripwire proper: the case table must cover every provider_config
    // arm. Adding a provider arm to the proto fails here until the arm has
    // redaction, encryption, and a case entry (the Go tripwire's posture).
    const oneof = ChannelAppSpecSchema.oneofs.find((o) => o.name === "provider_config");
    expect(oneof).toBeDefined();
    const armNames = oneof!.fields.map((f) => f.name);
    for (const arm of armNames) {
      expect(cases, `provider arm "${arm}" has no redaction/encryption coverage`).toHaveProperty(arm);
    }
    expect(Object.keys(cases).length, "remove stale case entries").toBe(armNames.length);
  });

  for (const [arm, tc] of Object.entries(cases)) {
    it(`${arm}: response redacted, stored ciphertext decrypts to the original`, async () => {
      const name = uniqueName(`Acme ${arm} App`);
      const plaintexts = tc.secretsOf(
        create(ChannelAppSchema, tc.newApp(name)),
      );

      const created = await command.create(tc.newApp(name));
      for (const [field, value] of Object.entries(tc.secretsOf(created))) {
        expect(value, `${field} must be redacted in the create response`).toBe(REDACTED_MARKER);
      }

      const stored = await readStored(created.metadata!.id);
      for (const [field, value] of Object.entries(tc.secretsOf(stored))) {
        expect(isCiphertextShaped(value), `stored ${field} must be encrypted`).toBe(true);
        expect(secrets.decrypt(value), `stored ${field} must decrypt to the original`).toBe(
          plaintexts[field],
        );
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Create (Go TestChannelAppController_CreateEncryptsAndRedacts + marker).
// ---------------------------------------------------------------------------

describe("channelapp create", () => {
  it("encrypts at rest, redacts the response, stamps the chapp id", async () => {
    const created = await command.create(newSlackApp(uniqueName("Acme Support App")));

    expect(created.metadata?.id).toMatch(/^chapp/);
    expect(created.spec?.providerConfig.case).toBe("slack");
    const slack = created.spec!.providerConfig.case === "slack" ? created.spec!.providerConfig.value : undefined;
    expect(slack?.clientSecret).toBe(REDACTED_MARKER);
    expect(slack?.signingSecret).toBe(REDACTED_MARKER);

    const stored = await readStored(created.metadata!.id);
    const storedSlack =
      stored.spec?.providerConfig.case === "slack" ? stored.spec.providerConfig.value : undefined;
    expect(isCiphertextShaped(storedSlack?.clientSecret ?? "")).toBe(true);
    expect(isCiphertextShaped(storedSlack?.signingSecret ?? "")).toBe(true);
    expect(secrets.decrypt(storedSlack!.clientSecret)).toBe("shh-client-secret");
  });

  it("refuses the redaction marker on create", async () => {
    const app = newSlackApp(uniqueName("Acme Support App"));
    app.spec.providerConfig.value.clientSecret = REDACTED_MARKER;

    const err = await grpcError(() => command.create(app));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(markerOnCreateMessage("client_secret"));
  });
});

// ---------------------------------------------------------------------------
// Ciphertext-shaped input (Go TestChannelAppController_RefusesCiphertextShapedSecrets).
// ---------------------------------------------------------------------------

describe("ciphertext-shaped secrets are refused (oss#395)", () => {
  it("slack create", async () => {
    const app = newSlackApp(uniqueName("Acme Slack App"));
    app.spec.providerConfig.value.clientSecret = "enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ=";

    const err = await grpcError(() => command.create(app));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(plaintextRequiredMessage("client_secret"));
  });

  it("whatsapp create refuses a FUTURE-version prefix too", async () => {
    const app = newWhatsAppApp(uniqueName("Acme WhatsApp App"));
    app.spec.providerConfig.value.accessToken = "enc:v2:ZnV0dXJlLXZlcnNpb24=";

    const err = await grpcError(() => command.create(app));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(plaintextRequiredMessage("access_token"));
  });

  it("slack update (marker for one field, forged ciphertext for the other)", async () => {
    const name = uniqueName("Acme Update App");
    const created = await command.create(newSlackApp(name));

    const update = newSlackApp(name);
    (update.metadata as Record<string, string>).id = created.metadata!.id;
    (update.metadata as Record<string, string>).slug = created.metadata!.slug;
    update.spec.providerConfig.value.clientSecret = REDACTED_MARKER;
    update.spec.providerConfig.value.signingSecret = "enc:v1:Zm9yZ2VkLWNpcGhlcnRleHQ=";

    const err = await grpcError(() => command.update(update));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(plaintextRequiredMessage("signing_secret"));
  });
});

// ---------------------------------------------------------------------------
// Per-field marker preservation (Go UpdateMarkerPreservesPerField, both arms).
// ---------------------------------------------------------------------------

describe("update marker preserves per field", () => {
  it("slack: rotates the signing secret, keeps the client secret", async () => {
    const name = uniqueName("Acme Support App");
    const created = await command.create(newSlackApp(name));

    const update = newSlackApp(name);
    (update.metadata as Record<string, string>).id = created.metadata!.id;
    (update.metadata as Record<string, string>).slug = created.metadata!.slug;
    update.spec.providerConfig.value.clientSecret = REDACTED_MARKER;
    update.spec.providerConfig.value.signingSecret = "rotated-signing-secret";
    await command.update(update);

    const stored = await readStored(created.metadata!.id);
    const slack = stored.spec?.providerConfig.case === "slack" ? stored.spec.providerConfig.value : undefined;
    expect(secrets.decrypt(slack!.clientSecret), "marker must preserve the ORIGINAL client_secret").toBe(
      "shh-client-secret",
    );
    expect(secrets.decrypt(slack!.signingSecret), "plaintext must rotate to the new value").toBe(
      "rotated-signing-secret",
    );
  });

  it("whatsapp: rotates the access token, keeps app_secret and verify_token", async () => {
    const name = uniqueName("Clinic Meta App");
    const created = await command.create(newWhatsAppApp(name));

    const update = newWhatsAppApp(name);
    (update.metadata as Record<string, string>).id = created.metadata!.id;
    (update.metadata as Record<string, string>).slug = created.metadata!.slug;
    update.spec.providerConfig.value.appSecret = REDACTED_MARKER;
    update.spec.providerConfig.value.accessToken = "rotated-access-token";
    update.spec.providerConfig.value.verifyToken = REDACTED_MARKER;
    await command.update(update);

    const stored = await readStored(created.metadata!.id);
    const wa = stored.spec?.providerConfig.case === "whatsapp" ? stored.spec.providerConfig.value : undefined;
    expect(secrets.decrypt(wa!.appSecret)).toBe("shh-app-secret");
    expect(secrets.decrypt(wa!.accessToken)).toBe("rotated-access-token");
    expect(secrets.decrypt(wa!.verifyToken)).toBe("shh-verify-token");
  });

  it("marker with no stored value is InvalidArgument (adversarial arm)", async () => {
    // A stored row with one empty secret can only exist via direct store
    // writes (the proto requires min_len=1 on the wire) — seeded here to
    // prove preserveExistingSecret fails closed instead of storing the
    // marker literal.
    const seeded = create(ChannelAppSchema, {
      apiVersion: API_VERSION,
      kind: KIND,
      metadata: {
        id: "chapp_seeded_empty",
        name: "Seeded Empty Secret",
        org: ORG,
        slug: "seeded-empty-secret",
      },
      spec: {
        providerConfig: {
          case: "slack",
          value: { clientId: "1.2", clientSecret: secrets.encrypt("x"), signingSecret: "" },
        },
      },
    });
    await server.store.saveResource(
      ApiResourceKind.channel_app,
      seeded.metadata!.id,
      ChannelAppSchema,
      seeded,
    );

    const update = newSlackApp("Seeded Empty Secret");
    (update.metadata as Record<string, string>).id = seeded.metadata!.id;
    (update.metadata as Record<string, string>).slug = seeded.metadata!.slug;
    update.spec.providerConfig.value.clientSecret = REDACTED_MARKER;
    update.spec.providerConfig.value.signingSecret = REDACTED_MARKER;

    const err = await grpcError(() => command.update(update));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(noExistingSecretMessage("signing_secret"));
  });
});

// ---------------------------------------------------------------------------
// Apply round-trip (Go TestChannelAppController_ApplyRoundTripsWithMarkers).
// ---------------------------------------------------------------------------

describe("apply round-trips with markers", () => {
  it("get → apply back verbatim preserves both stored secrets", async () => {
    const created = await command.apply(newSlackApp(uniqueName("Acme Support App")));

    const fetched = await query.get({ value: created.metadata!.id });
    await command.apply(fetched);

    const stored = await readStored(created.metadata!.id);
    const slack = stored.spec?.providerConfig.case === "slack" ? stored.spec.providerConfig.value : undefined;
    expect(secrets.decrypt(slack!.clientSecret)).toBe("shh-client-secret");
    expect(secrets.decrypt(slack!.signingSecret)).toBe("shh-signing-secret");
  });
});

// ---------------------------------------------------------------------------
// Query redaction (Go QueriesRedactSecrets + WhatsAppQueriesRedactSecrets).
// ---------------------------------------------------------------------------

describe("queries redact secrets", () => {
  it("slack: get, getByReference, and listByOrg redact; org filter holds", async () => {
    const org = "acme-slack-queries";
    const created = await command.create(newSlackApp(uniqueName("Acme Support App"), org));

    const fetched = await query.get({ value: created.metadata!.id });
    const fetchedSlack =
      fetched.spec?.providerConfig.case === "slack" ? fetched.spec.providerConfig.value : undefined;
    expect(fetchedSlack?.clientSecret).toBe(REDACTED_MARKER);
    expect(fetchedSlack?.signingSecret).toBe(REDACTED_MARKER);

    const byRef = await query.getByReference({
      org,
      kind: ApiResourceKind.channel_app,
      slug: created.metadata!.slug,
    });
    const byRefSlack =
      byRef.spec?.providerConfig.case === "slack" ? byRef.spec.providerConfig.value : undefined;
    expect(byRefSlack?.clientSecret).toBe(REDACTED_MARKER);

    const list = await query.listByOrg({ org });
    expect(list.entries).toHaveLength(1);
    const listSlack =
      list.entries[0]!.spec?.providerConfig.case === "slack"
        ? list.entries[0]!.spec!.providerConfig.value
        : undefined;
    expect(listSlack?.signingSecret).toBe(REDACTED_MARKER);

    const other = await query.listByOrg({ org: "some-other-org" });
    expect(other.entries).toHaveLength(0);
  });

  it("whatsapp: all three secrets redact; app_id is public and stays", async () => {
    const org = "acme-wa-queries";
    const created = await command.create(newWhatsAppApp(uniqueName("Clinic Meta App"), org));

    const fetched = await query.get({ value: created.metadata!.id });
    const wa = fetched.spec?.providerConfig.case === "whatsapp" ? fetched.spec.providerConfig.value : undefined;
    expect(wa?.appSecret).toBe(REDACTED_MARKER);
    expect(wa?.accessToken).toBe(REDACTED_MARKER);
    expect(wa?.verifyToken).toBe(REDACTED_MARKER);
    expect(wa?.appId, "app_id is public and must NOT be redacted").toBe("108954");

    const byRef = await query.getByReference({
      org,
      kind: ApiResourceKind.channel_app,
      slug: created.metadata!.slug,
    });
    const byRefWa = byRef.spec?.providerConfig.case === "whatsapp" ? byRef.spec.providerConfig.value : undefined;
    expect(byRefWa?.appSecret).toBe(REDACTED_MARKER);

    const list = await query.listByOrg({ org });
    expect(list.entries).toHaveLength(1);
    const listWa =
      list.entries[0]!.spec?.providerConfig.case === "whatsapp"
        ? list.entries[0]!.spec!.providerConfig.value
        : undefined;
    expect(listWa?.accessToken).toBe(REDACTED_MARKER);
  });
});

// ---------------------------------------------------------------------------
// Provider immutability (Go TestValidateProviderImmutableStep, on the wire).
// ---------------------------------------------------------------------------

describe("provider arm is immutable on update", () => {
  it("a slack app cannot become a whatsapp app — InvalidArgument by pinned contract", async () => {
    const name = uniqueName("Acme Support App");
    const created = await command.create(newSlackApp(name));

    const flip = newWhatsAppApp(name);
    (flip.metadata as Record<string, string>).id = created.metadata!.id;
    (flip.metadata as Record<string, string>).slug = created.metadata!.slug;

    const err = await grpcError(() => command.update(flip));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(PROVIDER_IMMUTABLE_MESSAGE);
  });

  it("an unchanged provider arm passes", async () => {
    const name = uniqueName("Acme Support App");
    const created = await command.create(newSlackApp(name));

    const update = newSlackApp(name);
    (update.metadata as Record<string, string>).id = created.metadata!.id;
    (update.metadata as Record<string, string>).slug = created.metadata!.slug;
    const updated = await command.update(update);
    expect(updated.metadata?.id).toBe(created.metadata!.id);
  });
});

// ---------------------------------------------------------------------------
// Referential delete block (Go DeleteBlockedByReferencingChannel + RelativeRef).
// ---------------------------------------------------------------------------

describe("delete is blocked while referenced", () => {
  it("names a referencing channel; deletion succeeds after unreferencing, redacted", async () => {
    const created = await command.create(newSlackApp(uniqueName("Acme Support App")));

    // Seed a referencing channel directly — the referential check reads
    // stored state, not the channel pipeline (the Go test's posture).
    const channel = create(AgentChannelSchema, {
      metadata: {
        id: "ach_01ref",
        name: "support-bot-slack",
        org: ORG,
        slug: "support-bot-slack",
      },
      spec: {
        appRef: {
          org: ORG,
          kind: ApiResourceKind.channel_app,
          slug: created.metadata!.slug,
        },
      },
    });
    await server.store.saveResource(
      ApiResourceKind.agent_channel,
      channel.metadata!.id,
      AgentChannelSchema,
      channel,
    );

    const err = await grpcError(() => command.delete({ resourceId: created.metadata!.id }));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(
      deleteBlockedByChannelMessage(ORG, created.metadata!.slug, "support-bot-slack"),
    );

    await server.store.deleteResource(ApiResourceKind.agent_channel, channel.metadata!.id);
    const deleted = await command.delete({ resourceId: created.metadata!.id });
    const slack =
      deleted.spec?.providerConfig.case === "slack" ? deleted.spec.providerConfig.value : undefined;
    expect(slack?.clientSecret, "the delete response must be redacted").toBe(REDACTED_MARKER);
  });

  it("a pre-normalization app_ref with no org still guards its app", async () => {
    const created = await command.create(newSlackApp(uniqueName("Acme Support App")));

    const channel = create(AgentChannelSchema, {
      metadata: {
        id: "ach_02rel",
        name: "relative-ref-channel",
        org: ORG,
        slug: "relative-ref-channel",
      },
      spec: {
        appRef: {
          kind: ApiResourceKind.channel_app,
          slug: created.metadata!.slug,
        },
      },
    });
    await server.store.saveResource(
      ApiResourceKind.agent_channel,
      channel.metadata!.id,
      AgentChannelSchema,
      channel,
    );

    const err = await grpcError(() => command.delete({ resourceId: created.metadata!.id }));
    expect(err.code).toBe(Code.FailedPrecondition);

    await server.store.deleteResource(ApiResourceKind.agent_channel, channel.metadata!.id);
  });
});
