/**
 * Pins the Channel domain's Slack and WhatsApp types, and the rules every
 * type shares, through the REAL stack: a composed server on an ephemeral
 * port, native gRPC clients for all four registration blocks (channel
 * command/query, message, conversation), the full interceptor chain. The
 * cases began as Go's agentchannel_test.go, case-for-case, when these
 * connections were their own AgentChannel kind; the web channel's own
 * cases live in web-channel.test.ts.
 *
 * One deliberate adaptation from the Go file, a strengthening: Go pins
 * type immutability at the STEP level with a no-arm stand-in (the test
 * predates the WhatsApp arm); here real slack→whatsapp and web→slack
 * flips run through the wire and pin typeImmutableMessage. Go's
 * TestProviderFieldName ports as a seam-level pin of typeFieldName below —
 * the TS derivation resolves the PROTO field name through the schema
 * descriptor, because the oneof `case` is the camelCased localName and
 * would silently diverge from the pinned error copy on a future
 * snake_case arm.
 *
 * Beyond the Go file:
 *   - an update keeps a write that lands between its read and its write
 *     (pipeline/guarded-write.ts) — the lost swap reruns from a fresh
 *     read, so the stored channel and the answer carry both the landed
 *     visibility and the update's spec;
 *   - a nameless channel takes the slug `<agent slug>-<type>` and the name
 *     `<agent name> (<Type>)`, one rule for every type;
 *   - the type-shaped lanes refuse the other types: a web channel's
 *     install RPCs (INSTALL_NOT_APPLICABLE_MESSAGE), a Slack channel's
 *     rotateLink (ROTATE_LINK_NOT_APPLICABLE_MESSAGE) and both profile
 *     reads of a Slack channel (the uniform NotFound);
 *   - rename moves the slug, and the old slug still resolves for reading;
 *   - an update naming another organization's channel app is refused with
 *     the shared same-organization copy, as a create is, and the update
 *     step run by a chain that never loaded the channel throws as a broken
 *     invariant.
 *
 * Go tests run one store per test function; this file shares ONE server,
 * so count-sensitive assertions use dedicated orgs and every agent /
 * channel name is unique per test.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { MessageInitShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import {
  ChannelAudience,
  ChannelSpecSchema,
} from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import type {
  SlackChannelConfig,
  WhatsAppChannelConfig,
} from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import { ChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/command_pb";
import { ChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/query_pb";
import { ChannelMessageCommandController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/message_command_pb";
import { ChannelMessageQueryController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/message_query_pb";
import { ChannelConversationCommandController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/conversation_command_pb";
import { ChannelConversationQueryController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/conversation_query_pb";
import { ChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/status_pb";
import { ChannelAppSchema } from "@stigmer/protos/ai/stigmer/agentic/channelapp/v1/api_pb";
import { VaultSchema } from "@stigmer/protos/ai/stigmer/agentic/vault/v1/api_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";
import { ApiResourceVisibility } from "@stigmer/protos/ai/stigmer/commons/apiresource/enum_pb";
import type { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  visibilityWrite,
  writeLandsMidUpdate,
} from "../../../pipeline/__tests__/race-support.js";
import { linkNotFound, newValidateChannelUpdateStep, typeFieldName } from "../steps.js";
import type { ModelCatalogProvider } from "../../../modelcatalog/model-catalog-provider.js";
import { testCallerIdentity, untouchable } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import type { Store } from "../../../store/interface.js";
import {
  APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE,
  CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE,
  INSTALL_NOT_APPLICABLE_MESSAGE,
  INSTALL_UNAVAILABLE_MESSAGE,
  NO_DOWNLOADABLE_MEDIA_MESSAGE,
  PROACTIVE_MESSAGING_UNAVAILABLE_MESSAGE,
  ROTATE_LINK_NOT_APPLICABLE_MESSAGE,
  agentRefImmutableMessage,
  appRefFrozenWhileInstalledMessage,
  appRefSameOrgMessage,
  sameOrgInvariantMessage,
  typeImmutableMessage,
} from "../constants.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
// Requests name the organizations by slug, which the serving chain turns
// into the minted id; rows written straight to the store and what the
// server answers carry the id.
const ORG = "channel-test-org";
let ORG_ID: string;
let OTHER_ORG_ID: string;

let server: ComposedServer;
let channels: Client<typeof ChannelCommandController>;
let query: Client<typeof ChannelQueryController>;
let agents: Client<typeof AgentCommandController>;
let messageCommand: Client<typeof ChannelMessageCommandController>;
let messageQuery: Client<typeof ChannelMessageQueryController>;
let conversationCommand: Client<typeof ChannelConversationCommandController>;
let conversationQuery: Client<typeof ChannelConversationQueryController>;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "channel-domain-test-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv(
    "STIGMER_RUNNER_TOKEN_KEY",
    Buffer.alloc(32, 8).toString("base64"),
  );
  server = await composeServer({
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
  const organizationIds = await seedOrganizations(transport, [
    ORG,
    "acme",
    "channel-other-org",
    "channel-bystander-org",
    "channel-apply-org",
    "channel-list-org",
  ]);
  ORG_ID = organizationId(organizationIds, ORG);
  OTHER_ORG_ID = organizationId(organizationIds, "channel-other-org");
  channels = createClient(ChannelCommandController, transport);
  query = createClient(ChannelQueryController, transport);
  agents = createClient(AgentCommandController, transport);
  messageCommand = createClient(ChannelMessageCommandController, transport);
  messageQuery = createClient(ChannelMessageQueryController, transport);
  conversationCommand = createClient(
    ChannelConversationCommandController,
    transport,
  );
  conversationQuery = createClient(
    ChannelConversationQueryController,
    transport,
  );
  await seedReferencedRows();
});

/**
 * The shared vaults and channel apps the specs below reference, seeded as
 * rows so the write-time reference rule finds them: a reference to a row
 * that does not exist is refused at create, and these tests are about the
 * binding's shape, not about a missing target.
 */
async function seedReferencedRows(): Promise<void> {
  for (const slug of [
    "github-credentials",
    "search-credentials",
    "rotated-credentials",
  ]) {
    await namingSaves(server.store).saveResource(
      ApiResourceKind.vault,
      `vlt_${slug}`,
      VaultSchema,
      create(VaultSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Vault",
        metadata: {
          id: `vlt_${slug}`,
          name: slug,
          slug,
          org: ORG_ID,
          visibility: ApiResourceVisibility.visibility_org,
        },
        spec: { owner: { case: "org", value: ORG_ID } },
      }),
    );
  }
  for (const slug of [
    "acme-meta-app",
    "acme-support-app",
    "different-app",
    "first-app",
    "first-meta-app",
    "granted-app",
    "second-app",
    "second-meta-app",
  ]) {
    await namingSaves(server.store).saveResource(
      ApiResourceKind.channel_app,
      `chapp_${slug}`,
      ChannelAppSchema,
      create(ChannelAppSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "ChannelApp",
        metadata: {
          id: `chapp_${slug}`,
          name: slug,
          slug,
          org: ORG_ID,
          visibility: ApiResourceVisibility.visibility_org,
        },
      }),
    );
  }
}

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

async function createTestAgent(
  name: string,
  org: string = ORG,
): Promise<Agent> {
  return agents.create({
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name, org },
    spec: {
      description: "Agent for channel tests",
      instructions: "You are a helpful agent for channel verification.",
    },
  });
}

type ReferenceInit = MessageInitShape<typeof ApiResourceReferenceSchema>;

/**
 * A named Slack channel for an agent, bound to `appRef` when given. Most
 * cases name their channel (N per agent) for the generic derive-from-name
 * slug; an empty name leaves the channel nameless, which defaults its slug
 * to `<agent slug>-slack`.
 */
function channelFor(
  agent: Agent,
  name: string,
  enabled: boolean,
  appRef?: ReferenceInit,
) {
  return {
    apiVersion: API_VERSION,
    kind: "Channel",
    metadata: { name, org: agent.metadata!.org },
    spec: {
      agentRef: { kind: ApiResourceKind.agent, slug: agent.metadata!.slug },
      enabled,
      type: {
        case: "slack" as const,
        value: appRef === undefined ? {} : { appRef },
      },
    },
  };
}

/** The whatsapp variant — no app_ref unless given (the BYO-only arms test it). */
function whatsAppChannelFor(agent: Agent, name: string, appRef?: ReferenceInit) {
  return {
    apiVersion: API_VERSION,
    kind: "Channel",
    metadata: { name, org: agent.metadata!.org },
    spec: {
      agentRef: { kind: ApiResourceKind.agent, slug: agent.metadata!.slug },
      enabled: true,
      type: {
        case: "whatsapp" as const,
        value:
          appRef === undefined
            ? { phoneNumberId: "106540352242922" }
            : { phoneNumberId: "106540352242922", appRef },
      },
    },
  };
}

/** A named web channel (a chat link) for an agent. */
function webChannelFor(agent: Agent, name: string) {
  return {
    apiVersion: API_VERSION,
    kind: "Channel",
    metadata: { name, org: agent.metadata!.org },
    spec: {
      agentRef: { kind: ApiResourceKind.agent, slug: agent.metadata!.slug },
      enabled: true,
      type: {
        case: "web" as const,
        value: { audience: ChannelAudience.public },
      },
    },
  };
}

/** A channel's app-bearing settings; fails the case for a web channel. */
function appSettingsOf(channel: Channel): SlackChannelConfig | WhatsAppChannelConfig {
  const type = channel.spec?.type;
  if (type?.case !== "slack" && type?.case !== "whatsapp") {
    throw new Error(`expected a Slack or WhatsApp channel, got ${String(type?.case)}`);
  }
  return type.value;
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
// Model-pin existence (Go TestAgentChannelController_ModelPinExistence,
// stigmer/stigmer#774) — validated against the bundled registry.
// ---------------------------------------------------------------------------

describe("model-pin existence (oss#774)", () => {
  it("create refuses a pin unknown to every harness, with a did-you-mean", async () => {
    const agent = await createTestAgent(uniqueName("pin-agent"));
    const ch = channelFor(agent, uniqueName("typod-pin"), true);
    (ch.spec as Record<string, unknown>).runConfig = {
      modelName: "composr-2.5",
    };

    const err = await grpcError(() => channels.create(ch));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("not in the model registry (any harness)");
    expect(err.rawMessage).toContain("'composer-2.5'");
  });

  it("create accepts a pin valid under some harness", async () => {
    const agent = await createTestAgent(uniqueName("pin-agent"));
    const ch = channelFor(agent, uniqueName("valid-pin"), true);
    (ch.spec as Record<string, unknown>).runConfig = {
      modelName: "composer-2.5",
    };
    await channels.create(ch);
  });

  it("update refuses the same typo", async () => {
    const agent = await createTestAgent(uniqueName("pin-agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("update-pin-target"), true),
    );

    const update = channelFor(agent, created.metadata!.name, true);
    (update.metadata as Record<string, string>).id = created.metadata!.id;
    (update.metadata as Record<string, string>).slug = created.metadata!.slug;
    (update.spec as Record<string, unknown>).runConfig = {
      modelName: "composr-2.5",
    };

    const err = await grpcError(() => channels.update({ resource: update, updateMask: { paths: ["*"] } }));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("not in the model registry (any harness)");
  });
});

// ---------------------------------------------------------------------------
// Create (Go TestAgentChannelController_Create).
// ---------------------------------------------------------------------------

describe("channel create", () => {
  it("creates with chn_ prefix, normalized ref, pending_install", async () => {
    const agent = await createTestAgent(uniqueName("Create Basics Agent"));
    const channel = await channels.create(
      channelFor(agent, uniqueName("Slack Workspace"), true),
    );

    expect(channel.metadata?.id).toMatch(/^chn_/);
    expect(channel.spec?.agentRef?.org).toBe(agent.metadata!.org);
    expect(channel.status?.installState).toBe(
      ChannelInstallState.pending_install,
    );
  });

  it("no slug default from the agent — name derives the slug", async () => {
    const agent = await createTestAgent(uniqueName("Slug Discipline Agent"));
    const name = uniqueName("Team Slack");
    const channel = await channels.create(channelFor(agent, name, true));

    expect(channel.metadata?.slug).toBe(
      name.toLowerCase().replace(/\s+/g, "-"),
    );
    expect(channel.metadata?.slug).not.toBe(agent.metadata!.slug);
  });

  it("a nameless Slack channel takes the slug <agent slug>-slack and the name <agent name> (Slack)", async () => {
    const agent = await createTestAgent(uniqueName("No Name Agent"));
    const channel = await channels.create(channelFor(agent, "", true));
    expect(channel.metadata?.slug).toBe(`${agent.metadata!.slug}-slack`);
    expect(channel.metadata?.name).toBe(`${agent.metadata!.name} (Slack)`);

    // One nameless channel of a type per agent: a second is a duplicate.
    const err = await grpcError(() =>
      channels.create(channelFor(agent, "", true)),
    );
    expect(err.code).toBe(Code.AlreadyExists);
  });

  it("a nameless WhatsApp channel takes the slug <agent slug>-whatsapp and the name <agent name> (WhatsApp)", async () => {
    const agent = await createTestAgent(uniqueName("No Name WA Agent"));
    const channel = await channels.create(
      whatsAppChannelFor(agent, "", {
        kind: ApiResourceKind.channel_app,
        slug: "acme-meta-app",
      }),
    );
    expect(channel.metadata?.slug).toBe(`${agent.metadata!.slug}-whatsapp`);
    expect(channel.metadata?.name).toBe(`${agent.metadata!.name} (WhatsApp)`);
  });

  it("client-provided status is discarded, never trusted", async () => {
    const agent = await createTestAgent(uniqueName("Status Forgery Agent"));
    const created = await channels.create({
      ...channelFor(agent, uniqueName("Forged Status Slack"), true),
      status: { installState: ChannelInstallState.installed },
    });
    expect(created.status?.installState).toBe(
      ChannelInstallState.pending_install,
    );
  });

  it("missing org is INVALID_ARGUMENT with the shared copy", async () => {
    const agent = await createTestAgent(uniqueName("Orgless Channel Agent"));
    const ch = channelFor(agent, uniqueName("Orgless Slack"), true);
    ch.metadata.org = "";

    const err = await grpcError(() => channels.create(ch));
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("an agent_ref naming nothing is INVALID_ARGUMENT naming the field", async () => {
    const err = await grpcError(() =>
      channels.create({
        apiVersion: API_VERSION,
        kind: "Channel",
        metadata: { name: uniqueName("Refless Channel"), org: ORG },
        spec: {
          agentRef: { kind: ApiResourceKind.agent },
          enabled: true,
          type: { case: "slack" as const, value: {} },
        },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("spec.agent_ref");
    expect(err.rawMessage).toContain("a reference names its resource by id or by slug");
  });

  it("nonexistent agent is NOT_FOUND with the direct-lookup copy", async () => {
    const err = await grpcError(() =>
      channels.create({
        apiVersion: API_VERSION,
        kind: "Channel",
        metadata: { name: uniqueName("Ghost Channel"), org: ORG },
        spec: {
          agentRef: { kind: ApiResourceKind.agent, slug: "no-such-agent" },
          enabled: true,
          type: { case: "slack" as const, value: {} },
        },
      }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe("Agent not found: no-such-agent");
  });

  it("cross-org agent_ref is FAILED_PRECONDITION with the shared copy", async () => {
    const agent = await createTestAgent(
      uniqueName("Foreign Agent"),
      "channel-other-org",
    );
    const ch = channelFor(agent, uniqueName("Cross Org Channel"), true);
    ch.metadata.org = ORG;
    ch.spec.agentRef = {
      ...ch.spec.agentRef,
      org: "channel-other-org",
    } as never;

    const err = await grpcError(() => channels.create(ch));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(sameOrgInvariantMessage(OTHER_ORG_ID));
  });

  it("cross-org refusal precedes the agent load — no slug probing", async () => {
    // The referenced slug does NOT exist in the foreign org; the refusal
    // must still be FAILED_PRECONDITION, never NOT_FOUND — this path must
    // not disclose whether a foreign org's slug exists.
    const err = await grpcError(() =>
      channels.create({
        apiVersion: API_VERSION,
        kind: "Channel",
        metadata: { name: uniqueName("Probe Channel"), org: ORG },
        spec: {
          agentRef: {
            kind: ApiResourceKind.agent,
            org: "some-foreign-org",
            slug: "possibly-private-slug",
          },
          enabled: true,
          type: { case: "slack" as const, value: {} },
        },
      }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
  });

  it("duplicate org+slug is ALREADY_EXISTS", async () => {
    const agent = await createTestAgent(uniqueName("Duplicate Channel Agent"));
    const name = uniqueName("Duplicate Slack");
    await channels.create(channelFor(agent, name, true));

    const err = await grpcError(() =>
      channels.create(channelFor(agent, name, true)),
    );
    expect(err.code).toBe(Code.AlreadyExists);
  });

  it("missing type is INVALID_ARGUMENT (required oneof)", async () => {
    const agent = await createTestAgent(uniqueName("Providerless Agent"));
    const err = await grpcError(() =>
      channels.create({
        apiVersion: API_VERSION,
        kind: "Channel",
        metadata: { name: uniqueName("Providerless Channel"), org: ORG },
        spec: {
          agentRef: { kind: ApiResourceKind.agent, slug: agent.metadata!.slug },
          enabled: true,
        },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("two channels for one agent coexist under distinct slugs", async () => {
    const agent = await createTestAgent(uniqueName("Multi Channel Agent"));
    const first = await channels.create(
      channelFor(agent, uniqueName("Sales Slack"), true),
    );
    const second = await channels.create(
      channelFor(agent, uniqueName("Support Slack"), true),
    );
    expect(first.metadata?.slug).not.toBe(second.metadata?.slug);
  });
});

// ---------------------------------------------------------------------------
// Update (Go TestAgentChannelController_Update + type immutability).
// ---------------------------------------------------------------------------

describe("channel update", () => {
  it("disable is a config-preserving pause; status survives a status-less manifest", async () => {
    const agent = await createTestAgent(uniqueName("Pause Agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("Pausable Slack"), true),
    );

    created.spec!.enabled = false;
    created.status = undefined; // a manifest apply sends no status
    const updated = await channels.update({ resource: created, updateMask: { paths: ["*"] } });
    expect(updated.spec?.enabled).toBe(false);
    expect(updated.status?.installState).toBe(
      ChannelInstallState.pending_install,
    );
  });

  it("agent_ref is immutable with the shared copy", async () => {
    const agentA = await createTestAgent(uniqueName("Immutable Ref Agent A"));
    const agentB = await createTestAgent(uniqueName("Immutable Ref Agent B"));
    const created = await channels.create(
      channelFor(agentA, uniqueName("Repoint Slack"), true),
    );

    const repointed = channelFor(agentB, "ignored", true);
    (repointed.metadata as Record<string, string>).id = created.metadata!.id;
    (repointed.metadata as Record<string, string>).slug =
      created.metadata!.slug;
    (repointed.metadata as Record<string, string>).name =
      created.metadata!.name;
    repointed.spec.agentRef = {
      kind: ApiResourceKind.agent,
      org: agentB.metadata!.org,
      slug: agentB.metadata!.slug,
    } as never;

    const err = await grpcError(() => channels.update({ resource: repointed, updateMask: { paths: ["*"] } }));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(
      agentRefImmutableMessage(agentA.metadata!.org, agentA.metadata!.slug),
    );
  });

  it("relative agent_ref org normalizes before the immutability compare", async () => {
    const agent = await createTestAgent(uniqueName("Relative Ref Agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("Relative Ref Slack"), true),
    );

    // Same slug, empty org — means "the channel's own org"; must pass.
    const relative = channelFor(agent, created.metadata!.name, true);
    (relative.metadata as Record<string, string>).id = created.metadata!.id;
    (relative.metadata as Record<string, string>).slug = created.metadata!.slug;
    await channels.update({ resource: relative, updateMask: { paths: ["*"] } });
  });

  it("the update step run by a chain that never loaded the channel is a broken invariant and throws", async () => {
    const step = newValidateChannelUpdateStep(
      untouchable<Store>("store"),
      untouchable<ModelCatalogProvider>("registry"),
      undefined,
    );
    const ctx = new RequestContext(ChannelSchema, create(ChannelSchema), testCallerIdentity(), ApiResourceKind.channel);
    await expect(step.execute(ctx)).rejects.toThrow("existing channel not found in context");
  });

  it("typeFieldName derives the PROTO field name (Go TestProviderFieldName)", () => {
    // The error copy interpolates this; a camelCase/snake_case mismatch
    // with Go would be a silent cross-edition wire divergence.
    const slack = create(ChannelSpecSchema, {
      type: { case: "slack", value: {} },
    });
    expect(typeFieldName(slack)).toBe("slack");
    const web = create(ChannelSpecSchema, {
      type: { case: "web", value: {} },
    });
    expect(typeFieldName(web)).toBe("web");
    expect(typeFieldName(create(ChannelSpecSchema))).toBe("");
    expect(typeFieldName(undefined)).toBe("");
  });

  it("type is immutable — a real slack→whatsapp flip refuses with typeImmutableMessage", async () => {
    const agent = await createTestAgent(uniqueName("Provider Flip Agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("Prov Slack"), true),
    );

    const flipped = whatsAppChannelFor(agent, created.metadata!.name, {
      kind: ApiResourceKind.channel_app,
      slug: "acme-meta-app",
    });
    (flipped.metadata as Record<string, string>).id = created.metadata!.id;
    (flipped.metadata as Record<string, string>).slug = created.metadata!.slug;

    const err = await grpcError(() => channels.update({ resource: flipped, updateMask: { paths: ["*"] } }));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(typeImmutableMessage("slack"));
  });

  it("type is immutable — a web channel cannot become a Slack channel, and keeps its type", async () => {
    const agent = await createTestAgent(uniqueName("Web Flip Agent"));
    const created = await channels.create(
      webChannelFor(agent, uniqueName("Flip Web")),
    );

    const flipped = channelFor(agent, created.metadata!.name, true);
    (flipped.metadata as Record<string, string>).id = created.metadata!.id;
    (flipped.metadata as Record<string, string>).slug = created.metadata!.slug;

    const err = await grpcError(() => channels.update({ resource: flipped, updateMask: { paths: ["*"] } }));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(typeImmutableMessage("web"));
    const stored = await query.get({ value: created.metadata!.id });
    expect(stored.spec?.type.case).toBe("web");
  });

  it("an update keeps a write that lands between its read and its write", async () => {
    const agent = await createTestAgent(uniqueName("Race Agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("Race Slack"), true),
    );
    const id = created.metadata!.id;
    expect(created.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_private,
    );

    created.spec!.enabled = false;
    created.status = undefined;
    const { result: updated, writes } = await writeLandsMidUpdate(
      server.store,
      ApiResourceKind.channel,
      id,
      visibilityWrite(
        server.store,
        ApiResourceKind.channel,
        ChannelSchema,
        id,
        ApiResourceVisibility.visibility_org,
      ),
      () => channels.update({ resource: created, updateMask: { paths: ["*"] } }),
    );

    const stored = await server.store.getResource(
      ApiResourceKind.channel,
      id,
      ChannelSchema,
    );
    for (const channel of [updated, stored]) {
      expect(channel.metadata?.visibility).toBe(
        ApiResourceVisibility.visibility_org,
      );
      expect(channel.spec?.enabled).toBe(false);
    }
    expect(writes).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Apply (Go TestAgentChannelController_Apply) — dedicated org: the final
// List asserts an exact count.
// ---------------------------------------------------------------------------

describe("apply semantics", () => {
  it("apply creates (pending_install), re-apply updates in place preserving status", async () => {
    const org = "channel-apply-org";
    const agent = await createTestAgent(
      uniqueName("Apply Semantics Agent"),
      org,
    );
    const name = uniqueName("Apply Slack");

    const created = await channels.apply(channelFor(agent, name, true));
    expect(created.metadata?.id).not.toBe("");
    expect(created.status?.installState).toBe(
      ChannelInstallState.pending_install,
    );

    const updated = await channels.apply(channelFor(agent, name, false));
    expect(updated.metadata?.id).toBe(created.metadata!.id);
    expect(updated.spec?.enabled).toBe(false);
    expect(updated.status?.installState).toBe(
      ChannelInstallState.pending_install,
    );

    const list = await query.list({ org });
    expect(list.entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// vaults (channel-bound credentials).
// ---------------------------------------------------------------------------

describe("vaults (channel-bound credentials)", () => {
  it("persist in order, empty org normalizes, attachers recorded; apply replaces and unbinds; CEL kind check", async () => {
    const agent = await createTestAgent(uniqueName("Vaults Agent"));
    const name = uniqueName("Vaults Slack");

    const withRefs = channelFor(agent, name, true);
    (withRefs.spec as Record<string, unknown>).vaults = [
      { kind: ApiResourceKind.vault, slug: "github-credentials" },
      {
        kind: ApiResourceKind.vault,
        org: ORG,
        slug: "search-credentials",
      },
    ];
    const created = await channels.create(withRefs);
    expect(created.spec?.vaults).toHaveLength(2);
    expect(created.spec?.vaults[0]?.org).toBe(ORG_ID);
    expect(created.spec?.vaults[0]?.slug).toBe("github-credentials");
    expect(created.spec?.vaults[1]?.slug).toBe("search-credentials");
    expect(Object.keys(created.status?.vaultAttachers ?? {}).sort()).toEqual([
      "vlt_github-credentials",
      "vlt_search-credentials",
    ]);

    const fetched = await query.get({ value: created.metadata!.id });
    expect(fetched.spec?.vaults).toHaveLength(2);

    // Apply replaces the vaults wholesale; the attachers follow.
    const rebound = channelFor(agent, name, true);
    (rebound.spec as Record<string, unknown>).vaults = [
      {
        kind: ApiResourceKind.vault,
        org: ORG,
        slug: "rotated-credentials",
      },
    ];
    const updated = await channels.apply(rebound);
    expect(updated.spec?.vaults).toHaveLength(1);
    expect(updated.spec?.vaults[0]?.slug).toBe("rotated-credentials");
    expect(Object.keys(updated.status?.vaultAttachers ?? {})).toEqual([
      "vlt_rotated-credentials",
    ]);

    // Apply omitting the vaults unbinds them (declarative semantics).
    const unbound = await channels.apply(channelFor(agent, name, true));
    expect(unbound.spec?.vaults).toHaveLength(0);
    expect(unbound.status?.vaultAttachers ?? {}).toEqual({});

    // A non-vault ref kind is INVALID_ARGUMENT (proto CEL).
    const wrongKind = channelFor(agent, uniqueName("Wrong Kind Slack"), true);
    (wrongKind.spec as Record<string, unknown>).vaults = [
      { kind: ApiResourceKind.agent, org: ORG, slug: "not-a-vault" },
    ];
    const err = await grpcError(() => channels.create(wrongKind));
    expect(err.code).toBe(Code.InvalidArgument);
  });
});

// ---------------------------------------------------------------------------
// app_ref (Go TestAgentChannelController_AppRef).
// ---------------------------------------------------------------------------

describe("app_ref (BYO channel-app binding)", () => {
  it("an empty app_ref org normalizes to the channel's org and persists", async () => {
    const agent = await createTestAgent(uniqueName("App Ref Agent"));
    const ch = channelFor(agent, uniqueName("BYO Slack"), true, {
      kind: ApiResourceKind.channel_app,
      slug: "acme-support-app",
    });

    const created = await channels.create(ch);
    expect(appSettingsOf(created).appRef?.org).toBe(agent.metadata!.org);
    expect(appSettingsOf(created).appRef?.slug).toBe("acme-support-app");
  });

  it("a cross-org app_ref is FAILED_PRECONDITION with the shared copy", async () => {
    const agent = await createTestAgent(uniqueName("Cross Org App Agent"));
    const ch = channelFor(agent, uniqueName("Cross Org App Slack"), true, {
      kind: ApiResourceKind.channel_app,
      org: "channel-other-org",
      slug: "their-app",
    });

    const err = await grpcError(() => channels.create(ch));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(appRefSameOrgMessage("slack"));
  });

  it("a non-channel_app ref kind is INVALID_ARGUMENT (proto CEL)", async () => {
    const agent = await createTestAgent(uniqueName("Wrong Kind App Agent"));
    const ch = channelFor(agent, uniqueName("Wrong Kind App Slack"), true, {
      kind: ApiResourceKind.agent,
      org: agent.metadata!.org,
      slug: "not-a-channel-app",
    });

    const err = await grpcError(() => channels.create(ch));
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("a pending channel may rebind freely — rebind-before-install is the intended flow", async () => {
    const agent = await createTestAgent(uniqueName("Pending Rebind Agent"));
    const ch = channelFor(agent, uniqueName("Pending Rebind Slack"), true, {
      kind: ApiResourceKind.channel_app,
      slug: "first-app",
    });
    const created = await channels.create(ch);

    const rebound = channelFor(agent, created.metadata!.name, true, {
      kind: ApiResourceKind.channel_app,
      slug: "second-app",
    });
    (rebound.metadata as Record<string, string>).id = created.metadata!.id;
    (rebound.metadata as Record<string, string>).slug = created.metadata!.slug;
    const updated = await channels.update({ resource: rebound, updateMask: { paths: ["*"] } });
    expect(appSettingsOf(updated).appRef?.slug).toBe("second-app");
  });

  it("a cross-org app_ref on update is FAILED_PRECONDITION with the shared copy, and the binding stays", async () => {
    const agent = await createTestAgent(uniqueName("Cross Org Rebind Agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("Cross Org Rebind Slack"), true, {
        kind: ApiResourceKind.channel_app,
        slug: "first-app",
      }),
    );

    const rebound = channelFor(agent, created.metadata!.name, true, {
      kind: ApiResourceKind.channel_app,
      org: "channel-other-org",
      slug: "their-app",
    });
    (rebound.metadata as Record<string, string>).id = created.metadata!.id;
    (rebound.metadata as Record<string, string>).slug = created.metadata!.slug;
    const err = await grpcError(() => channels.update({ resource: rebound, updateMask: { paths: ["*"] } }));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(appRefSameOrgMessage("slack"));

    const stored = await query.get({ value: created.metadata!.id });
    expect(appSettingsOf(stored).appRef?.slug).toBe("first-app");
  });

  it("app_ref is frozen while installed, with the shared copy", async () => {
    const agent = await createTestAgent(uniqueName("Installed Freeze Agent"));
    const name = uniqueName("Installed Freeze Slack");
    const ch = channelFor(agent, name, true, {
      kind: ApiResourceKind.channel_app,
      slug: "granted-app",
    });
    const created = await channels.create(ch);

    // Flip the stored row to installed directly — OSS has no install
    // flow, and the freeze keys on stored status, not on how it got there.
    const stored = await server.store.getResource(
      ApiResourceKind.channel,
      created.metadata!.id,
      ChannelSchema,
    );
    stored.status!.installState = ChannelInstallState.installed;
    await namingSaves(server.store).saveResource(
      ApiResourceKind.channel,
      created.metadata!.id,
      ChannelSchema,
      stored,
    );

    const rebindBase = (appRef?: ReferenceInit) => {
      const c = channelFor(agent, name, true, appRef);
      (c.metadata as Record<string, string>).id = created.metadata!.id;
      (c.metadata as Record<string, string>).slug = created.metadata!.slug;
      return c;
    };

    const rebound = rebindBase({
      kind: ApiResourceKind.channel_app,
      slug: "different-app",
    });
    const err = await grpcError(() => channels.update({ resource: rebound, updateMask: { paths: ["*"] } }));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(appRefFrozenWhileInstalledMessage("slack"));

    // Unbinding while installed is equally a change.
    const unbindErr = await grpcError(() => channels.update({ resource: rebindBase(), updateMask: { paths: ["*"] } }));
    expect(unbindErr.code).toBe(Code.FailedPrecondition);

    // An unchanged binding must pass — the disable toggle keeps it.
    const unchanged = rebindBase({
      kind: ApiResourceKind.channel_app,
      org: agent.metadata!.org,
      slug: "granted-app",
    });
    unchanged.spec.enabled = false;
    await channels.update({ resource: unchanged, updateMask: { paths: ["*"] } });
  });
});

// ---------------------------------------------------------------------------
// WhatsApp app_ref (Go TestAgentChannelController_WhatsAppAppRef).
// ---------------------------------------------------------------------------

describe("whatsapp app_ref (BYO-only)", () => {
  it("create without app_ref is INVALID_ARGUMENT with the shared copy", async () => {
    const agent = await createTestAgent(uniqueName("WA No App Agent"));
    const err = await grpcError(() =>
      channels.create(whatsAppChannelFor(agent, uniqueName("WA No App"))),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE);
  });

  it("apply without app_ref is refused on the same path", async () => {
    const agent = await createTestAgent(uniqueName("WA Apply Agent"));
    const err = await grpcError(() =>
      channels.apply(whatsAppChannelFor(agent, uniqueName("WA Apply"))),
    );
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("create with app_ref passes; empty org normalizes", async () => {
    const agent = await createTestAgent(uniqueName("WA Bound Agent"));
    const ch = whatsAppChannelFor(agent, uniqueName("WA Bound"), {
      kind: ApiResourceKind.channel_app,
      slug: "acme-meta-app",
    });

    const created = await channels.create(ch);
    expect(appSettingsOf(created).appRef?.slug).toBe("acme-meta-app");
    expect(appSettingsOf(created).appRef?.org).toBe(agent.metadata!.org);
  });

  it("update clearing app_ref is INVALID_ARGUMENT — the binding may change, never disappear", async () => {
    const agent = await createTestAgent(uniqueName("WA Unbind Agent"));
    const name = uniqueName("WA Unbind");
    const ch = whatsAppChannelFor(agent, name, {
      kind: ApiResourceKind.channel_app,
      slug: "acme-meta-app",
    });
    const created = await channels.create(ch);

    const unbound = whatsAppChannelFor(agent, name);
    (unbound.metadata as Record<string, string>).id = created.metadata!.id;
    (unbound.metadata as Record<string, string>).slug = created.metadata!.slug;

    const err = await grpcError(() => channels.update({ resource: unbound, updateMask: { paths: ["*"] } }));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE);
  });

  it("update keeping the binding passes (uninstalled rebind stays legitimate)", async () => {
    const agent = await createTestAgent(uniqueName("WA Rebind Agent"));
    const ch = whatsAppChannelFor(agent, uniqueName("WA Rebind"), {
      kind: ApiResourceKind.channel_app,
      slug: "first-meta-app",
    });
    const created = await channels.create(ch);

    // A read answers the reference by id and name; naming another app
    // beside the first one's id names two resources, and is refused.
    const appRef = appSettingsOf(created).appRef!;
    appRef.slug = "second-meta-app";
    const mixed = await grpcError(() => channels.update({ resource: created, updateMask: { paths: ["*"] } }));
    expect(mixed.code).toBe(Code.InvalidArgument);

    appRef.id = "";
    const updated = await channels.update({ resource: created, updateMask: { paths: ["*"] } });
    expect(appSettingsOf(updated).appRef?.slug).toBe("second-meta-app");
  });
});

// ---------------------------------------------------------------------------
// Delete + queries (Go TestAgentChannelController_Delete / _Queries /
// _GetByAgent) — list counts use a dedicated org.
// ---------------------------------------------------------------------------

describe("delete and queries", () => {
  it("delete returns the deleted channel; get after delete is NOT_FOUND", async () => {
    const agent = await createTestAgent(uniqueName("Delete Agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("Doomed Slack"), true),
    );

    const deleted = await channels.delete({ value: created.metadata!.id });
    expect(deleted.metadata?.id).toBe(created.metadata!.id);

    const err = await grpcError(() =>
      query.get({ value: created.metadata!.id }),
    );
    expect(err.code).toBe(Code.NotFound);
  });

  it("nonexistent channel delete is NOT_FOUND", async () => {
    const err = await grpcError(() =>
      channels.delete({ value: "chn_does_not_exist" }),
    );
    expect(err.code).toBe(Code.NotFound);
  });

  it("get by id and by reference round-trip", async () => {
    const agent = await createTestAgent(uniqueName("Query Agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("Query Slack"), true),
    );

    const fetched = await query.get({ value: created.metadata!.id });
    expect(fetched.metadata?.slug).toBe(created.metadata!.slug);

    const byRef = await query.getByReference({
      kind: ApiResourceKind.channel,
      org: created.metadata!.org,
      slug: created.metadata!.slug,
    });
    expect(byRef.metadata?.id).toBe(created.metadata!.id);
  });

  it("list scopes to the requested org and filters labels", async () => {
    const org = "channel-list-org";
    const agent = await createTestAgent(uniqueName("List Agent"), org);
    await channels.create(channelFor(agent, uniqueName("Plain Slack"), true));

    const labeled = channelFor(agent, uniqueName("Labeled Slack"), true);
    (labeled.metadata as Record<string, unknown>).labels = { team: "sales" };
    await channels.create(labeled);

    const all = await query.list({ org });
    expect(all.entries).toHaveLength(2);

    const filtered = await query.list({ org, labels: { team: "sales" } });
    expect(filtered.entries).toHaveLength(1);

    const foreign = await query.list({ org: "channel-bystander-org" });
    expect(foreign.entries).toHaveLength(0);
  });

  it("getByAgent finds every channel regardless of slug; org scope filters", async () => {
    const agent = await createTestAgent(uniqueName("Get By Agent Agent"));
    const first = await channels.create(
      channelFor(agent, uniqueName("Primary Slack"), true),
    );
    const second = await channels.create(
      channelFor(agent, uniqueName("Secondary Slack"), false),
    );

    const list = await query.listByAgent({ agentId: agent.metadata!.id });
    expect(list.entries).toHaveLength(2);
    const slugs = list.entries.map((c) => c.metadata?.slug);
    expect(slugs).toContain(first.metadata!.slug);
    expect(slugs).toContain(second.metadata!.slug);

    const matching = await query.listByAgent({
      agentId: agent.metadata!.id,
      org: ORG,
    });
    expect(matching.entries).toHaveLength(2);

    const foreign = await query.listByAgent({
      agentId: agent.metadata!.id,
      org: "channel-bystander-org",
    });
    expect(foreign.entries).toHaveLength(0);
  });

  it("nonexistent agent yields an empty list", async () => {
    const list = await query.listByAgent({ agentId: "agt-does-not-exist" });
    expect(list.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Install posture (Go TestAgentChannelController_InstallPosture).
// ---------------------------------------------------------------------------

describe("install posture", () => {
  it("the full contract: NOT_FOUND with the cloud copy, refusal on existing, nothing persisted", async () => {
    const agent = await createTestAgent(uniqueName("Install Posture Agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("Installable Slack"), true),
    );

    const missErr = await grpcError(() =>
      channels.initiateInstall({ resourceId: "chn_does_not_exist" }),
    );
    expect(missErr.code).toBe(Code.NotFound);
    expect(missErr.rawMessage).toBe(
      "Channel not found: chn_does_not_exist",
    );

    const refuseErr = await grpcError(() =>
      channels.initiateInstall({ resourceId: created.metadata!.id }),
    );
    expect(refuseErr.code).toBe(Code.FailedPrecondition);
    expect(refuseErr.rawMessage).toBe(INSTALL_UNAVAILABLE_MESSAGE);

    // completeInstall mirrors the same contract.
    const completeMiss = await grpcError(() =>
      channels.completeInstall({
        resourceId: "chn_does_not_exist",
        state: "some-state",
        code: "some-code",
      }),
    );
    expect(completeMiss.code).toBe(Code.NotFound);

    const completeRefuse = await grpcError(() =>
      channels.completeInstall({
        resourceId: created.metadata!.id,
        state: "some-state",
        code: "some-code",
      }),
    );
    expect(completeRefuse.code).toBe(Code.FailedPrecondition);

    // Missing input fields are INVALID_ARGUMENT before any load (Layer-1).
    const emptyInitiate = await grpcError(() => channels.initiateInstall({}));
    expect(emptyInitiate.code).toBe(Code.InvalidArgument);
    const partialComplete = await grpcError(() =>
      channels.completeInstall({ resourceId: created.metadata!.id }),
    );
    expect(partialComplete.code).toBe(Code.InvalidArgument);

    // The refused install persists nothing.
    const fetched = await query.get({ value: created.metadata!.id });
    expect(fetched.status?.installState).toBe(
      ChannelInstallState.pending_install,
    );
  });

  it("a web channel refuses initiateInstall and completeInstall as not applicable", async () => {
    const agent = await createTestAgent(uniqueName("Web Install Agent"));
    const web = await channels.create(
      webChannelFor(agent, uniqueName("Uninstallable Web")),
    );
    // A web channel has nothing to install, so it starts at no install state.
    expect(web.status?.installState).toBe(
      ChannelInstallState.channel_install_state_unspecified,
    );

    const initiate = await grpcError(() =>
      channels.initiateInstall({ resourceId: web.metadata!.id }),
    );
    expect(initiate.code).toBe(Code.FailedPrecondition);
    expect(initiate.rawMessage).toBe(INSTALL_NOT_APPLICABLE_MESSAGE);

    const complete = await grpcError(() =>
      channels.completeInstall({
        resourceId: web.metadata!.id,
        state: "some-state",
        code: "some-code",
      }),
    );
    expect(complete.code).toBe(Code.FailedPrecondition);
    expect(complete.rawMessage).toBe(INSTALL_NOT_APPLICABLE_MESSAGE);
  });
});

// ---------------------------------------------------------------------------
// The web channel's link lanes, asked of a Slack channel.
// ---------------------------------------------------------------------------

describe("the link lanes refuse a Slack channel", () => {
  it("rotateLink on a Slack channel is FAILED_PRECONDITION and writes nothing", async () => {
    const agent = await createTestAgent(uniqueName("Slack Rotate Agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("Linkless Slack"), true),
    );

    const err = await grpcError(() =>
      channels.rotateLink({ resourceId: created.metadata!.id }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(ROTATE_LINK_NOT_APPLICABLE_MESSAGE);
    const fetched = await query.get({ value: created.metadata!.id });
    expect(fetched.status?.typeStatus.case).toBeUndefined();
  });

  it("both profile reads answer the uniform NotFound for an enabled Slack channel", async () => {
    const agent = await createTestAgent(uniqueName("Slack Profile Agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("Profileless Slack"), true),
    );
    const id = created.metadata!.id;

    const anonymous = await grpcError(() =>
      query.getAgentProfile({ channelId: id }),
    );
    expect(anonymous.code).toBe(Code.NotFound);
    expect(anonymous.rawMessage).toBe(linkNotFound(id).rawMessage);

    const member = await grpcError(() =>
      query.getAgentProfileForMember({ value: id }),
    );
    expect(member.code).toBe(Code.NotFound);
    expect(member.rawMessage).toBe(linkNotFound(id).rawMessage);
  });
});

// ---------------------------------------------------------------------------
// Rename.
// ---------------------------------------------------------------------------

describe("rename", () => {
  it("moves the slug; the old slug still resolves through getByReference for reading", async () => {
    const agent = await createTestAgent(uniqueName("Rename Agent"));
    const created = await channels.create(
      channelFor(agent, uniqueName("Before Rename Slack"), true),
    );
    const oldSlug = created.metadata!.slug;
    const newSlug = `${oldSlug}-renamed`;

    const renamed = await channels.rename({
      resourceId: created.metadata!.id,
      slug: newSlug,
    });
    expect(renamed.metadata?.id).toBe(created.metadata!.id);
    expect(renamed.metadata?.slug).toBe(newSlug);

    const byNew = await query.getByReference({
      kind: ApiResourceKind.channel,
      org: ORG,
      slug: newSlug,
    });
    expect(byNew.metadata?.id).toBe(created.metadata!.id);
    expect(byNew.metadata?.slug).toBe(newSlug);

    const byOld = await query.getByReference({
      kind: ApiResourceKind.channel,
      org: ORG,
      slug: oldSlug,
    });
    expect(byOld.metadata?.id).toBe(created.metadata!.id);
    expect(byOld.metadata?.slug).toBe(newSlug);
  });
});

// ---------------------------------------------------------------------------
// Messaging posture (Go TestChannelMessageController_CloudOnlyPosture).
// ---------------------------------------------------------------------------

describe("channel messaging posture (cloud-only runtime)", () => {
  const textPayload = (body: string) => ({
    kind: { case: "text" as const, value: { body } },
  });

  it("sendMessage refuses with FAILED_PRECONDITION and the documented copy", async () => {
    const err = await grpcError(() =>
      messageCommand.sendMessage({
        recipient: "15551234567",
        payload: textPayload("your fee is due"),
      }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(PROACTIVE_MESSAGING_UNAVAILABLE_MESSAGE);
  });

  it("sendMessage refusal is independent of channel existence (no probe)", async () => {
    const err = await grpcError(() =>
      messageCommand.sendMessage({
        channel: "no-such-channel",
        org: "no-such-org",
        recipient: "15551234567",
        payload: textPayload("hello"),
      }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
  });

  it("sendMessage contract violations are INVALID_ARGUMENT before the refusal", async () => {
    const cases: Array<
      [string, Parameters<typeof messageCommand.sendMessage>[0]]
    > = [
      ["empty recipient", { payload: textPayload("hello") }],
      ["missing payload", { recipient: "15551234567" }],
      ["unset payload arm", { recipient: "15551234567", payload: {} }],
      [
        "empty text body",
        { recipient: "15551234567", payload: textPayload("") },
      ],
      [
        "oversized text body",
        { recipient: "15551234567", payload: textPayload("x".repeat(4097)) },
      ],
      [
        "empty template name",
        {
          recipient: "15551234567",
          payload: { kind: { case: "template" as const, value: {} } },
        },
      ],
    ];
    for (const [name, input] of cases) {
      const err = await grpcError(() => messageCommand.sendMessage(input));
      expect(err.code, name).toBe(Code.InvalidArgument);
    }
  });

  it("listTemplates refuses with FAILED_PRECONDITION and the documented copy", async () => {
    const err = await grpcError(() =>
      messageQuery.listTemplates({
        channel: "some-channel",
        approvedOnly: true,
      }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(PROACTIVE_MESSAGING_UNAVAILABLE_MESSAGE);
  });

  it("listMessagingChannels answers with an empty list, never a refusal", async () => {
    const res = await messageQuery.listMessagingChannels({});
    expect(res.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Conversation posture (Go TestChannelConversationController_CloudOnlyPosture).
// ---------------------------------------------------------------------------

describe("channel conversation posture (cloud-only runtime)", () => {
  const controlInput = {
    channelId: "chn-123",
    conversationKey: "15551234567",
  };

  it("discovery reads answer truthful emptiness", async () => {
    const list = await conversationQuery.list({ org: "acme" });
    expect(list.entries).toHaveLength(0);
    expect(list.nextPageToken).toBe("");

    const counted = await conversationQuery.countConversations({ org: "acme" });
    expect(counted.count).toBe(0);

    const timeline = await conversationQuery.listTimeline({
      channelId: "chn-123",
      conversationKey: "15551234567",
    });
    expect(timeline.entries).toHaveLength(0);
    expect(timeline.nextPageToken).toBe("");
  });

  it("single-row reads answer the uniform miss", async () => {
    const getErr = await grpcError(() =>
      conversationQuery.getConversation({
        channelId: "chn-123",
        conversationKey: "15551234567",
      }),
    );
    expect(getErr.code).toBe(Code.NotFound);

    const mediaErr = await grpcError(() =>
      conversationQuery.getMediaDownloadUrl({
        channelId: "chn-123",
        conversationKey: "15551234567",
        itemId: "wa:wamid.abc123",
      }),
    );
    expect(mediaErr.code).toBe(Code.NotFound);
    expect(mediaErr.rawMessage).toBe(NO_DOWNLOADABLE_MEDIA_MESSAGE);
  });

  it("every command refuses with FAILED_PRECONDITION and the documented copy", async () => {
    const commands: Array<[string, () => Promise<unknown>]> = [
      [
        "reply",
        () =>
          conversationCommand.reply({
            channelId: "chn-123",
            conversationKey: "15551234567",
            payload: {
              kind: { case: "text" as const, value: { body: "on my way" } },
            },
          }),
      ],
      ["takeOver", () => conversationCommand.takeOver(controlInput)],
      ["handBack", () => conversationCommand.handBack(controlInput)],
      [
        "clearAttention",
        () => conversationCommand.clearAttention(controlInput),
      ],
      [
        "escalate",
        () =>
          conversationCommand.escalate({
            reason: "the member is asking about a refund I cannot process",
          }),
      ],
    ];
    for (const [name, call] of commands) {
      const err = await grpcError(call);
      expect(err.code, name).toBe(Code.FailedPrecondition);
      expect(err.rawMessage, name).toBe(
        CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE,
      );
    }
  });

  it("contract violations are INVALID_ARGUMENT before the refusal", async () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      [
        "list without org",
        () => conversationQuery.list({}),
      ],
      [
        "countConversations without org",
        () => conversationQuery.countConversations({}),
      ],
      [
        "listTimeline without conversation key",
        () => conversationQuery.listTimeline({ channelId: "chn-123" }),
      ],
      [
        "getConversation without conversation key",
        () => conversationQuery.getConversation({ channelId: "chn-123" }),
      ],
      [
        "getMediaDownloadUrl without item id",
        () =>
          conversationQuery.getMediaDownloadUrl({
            channelId: "chn-123",
            conversationKey: "15551234567",
          }),
      ],
      [
        "takeOver without channel id",
        () => conversationCommand.takeOver({ conversationKey: "15551234567" }),
      ],
      [
        "reply without payload",
        () =>
          conversationCommand.reply({
            channelId: "chn-123",
            conversationKey: "15551234567",
          }),
      ],
      ["escalate without reason", () => conversationCommand.escalate({})],
      [
        "escalate with an over-budget reason",
        () => conversationCommand.escalate({ reason: "x".repeat(1025) }),
      ],
    ];
    for (const [name, call] of cases) {
      const err = await grpcError(call);
      expect(err.code, name).toBe(Code.InvalidArgument);
    }
  });
});
