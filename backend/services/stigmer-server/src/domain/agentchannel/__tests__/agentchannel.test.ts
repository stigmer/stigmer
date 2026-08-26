/**
 * Pins the agentchannel domain against Go's agentchannel_test.go,
 * case-for-case — through the REAL stack: a composed server on an
 * ephemeral port, native gRPC clients for all four registration blocks
 * (channel command/query, message, conversation), the full interceptor
 * chain.
 *
 * One deliberate adaptation from the Go file, a strengthening: Go pins
 * provider-arm immutability at the STEP level with a no-arm stand-in
 * (the test predates the WhatsApp arm); here a real slack→whatsapp flip
 * runs through the wire and pins the copy. Go's TestProviderFieldName
 * ports as a seam-level pin below — the TS derivation resolves the PROTO
 * field name through the schema descriptor, because the oneof `case` is
 * the camelCased localName and would silently diverge from Go's pinned
 * error copy on a future snake_case arm.
 *
 * Go tests run one store per test function; this file shares ONE server,
 * so count-sensitive assertions use dedicated orgs and every agent /
 * channel name is unique per test.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { AgentChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/api_pb";
import { AgentChannelSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/spec_pb";
import { AgentChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/command_pb";
import { AgentChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/query_pb";
import { ChannelMessageCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_command_pb";
import { ChannelMessageQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/message_query_pb";
import { ChannelConversationCommandController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_command_pb";
import { ChannelConversationQueryController } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/conversation_query_pb";
import { AgentChannelInstallState } from "@stigmer/protos/ai/stigmer/agentic/agentchannel/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { providerFieldName } from "../steps.js";
import {
  APP_REF_FROZEN_WHILE_INSTALLED_MESSAGE,
  APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE,
  APP_REF_SAME_ORG_MESSAGE,
  CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE,
  INSTALL_UNAVAILABLE_MESSAGE,
  NO_DOWNLOADABLE_MEDIA_MESSAGE,
  PROACTIVE_MESSAGING_UNAVAILABLE_MESSAGE,
  agentRefImmutableMessage,
  providerImmutableMessage,
  sameOrgInvariantMessage,
} from "../constants.js";

const silentLogger = createLogger({ level: "error", pretty: false, write: () => {} });

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "channel-test-org";

let server: ComposedServer;
let channels: Client<typeof AgentChannelCommandController>;
let query: Client<typeof AgentChannelQueryController>;
let agents: Client<typeof AgentCommandController>;
let messageCommand: Client<typeof ChannelMessageCommandController>;
let messageQuery: Client<typeof ChannelMessageQueryController>;
let conversationCommand: Client<typeof ChannelConversationCommandController>;
let conversationQuery: Client<typeof ChannelConversationQueryController>;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "agentchannel-domain-test-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("STIGMER_RUNNER_TOKEN_KEY", Buffer.alloc(32, 8).toString("base64"));
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
  channels = createClient(AgentChannelCommandController, transport);
  query = createClient(AgentChannelQueryController, transport);
  agents = createClient(AgentCommandController, transport);
  messageCommand = createClient(ChannelMessageCommandController, transport);
  messageQuery = createClient(ChannelMessageQueryController, transport);
  conversationCommand = createClient(ChannelConversationCommandController, transport);
  conversationQuery = createClient(ChannelConversationQueryController, transport);
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

async function createTestAgent(name: string, org: string = ORG): Promise<Agent> {
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

/**
 * A named Slack channel for an agent. Unlike shares, channels have no
 * canonical-slug default (P7: N-per-agent), so tests always provide a
 * name for the generic derive-from-name slug.
 */
function channelFor(agent: Agent, name: string, enabled: boolean) {
  return {
    apiVersion: API_VERSION,
    kind: "AgentChannel",
    metadata: { name, org: agent.metadata!.org },
    spec: {
      agentRef: { kind: ApiResourceKind.agent, slug: agent.metadata!.slug },
      enabled,
      providerConfig: { case: "slack" as const, value: {} },
    },
  };
}

/** The whatsapp variant — no app_ref by default (DD-WA-2 arms test it). */
function whatsAppChannelFor(agent: Agent, name: string) {
  return {
    apiVersion: API_VERSION,
    kind: "AgentChannel",
    metadata: { name, org: agent.metadata!.org },
    spec: {
      agentRef: { kind: ApiResourceKind.agent, slug: agent.metadata!.slug },
      enabled: true,
      providerConfig: {
        case: "whatsapp" as const,
        value: { phoneNumberId: "106540352242922" },
      },
    },
  };
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
    (ch.spec as Record<string, unknown>).runConfig = { modelName: "composr-2.5" };

    const err = await grpcError(() => channels.create(ch));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("not in the model registry (any harness)");
    expect(err.rawMessage).toContain("'composer-2.5'");
  });

  it("create accepts a pin valid under some harness", async () => {
    const agent = await createTestAgent(uniqueName("pin-agent"));
    const ch = channelFor(agent, uniqueName("valid-pin"), true);
    (ch.spec as Record<string, unknown>).runConfig = { modelName: "composer-2.5" };
    await channels.create(ch);
  });

  it("update refuses the same typo", async () => {
    const agent = await createTestAgent(uniqueName("pin-agent"));
    const created = await channels.create(channelFor(agent, uniqueName("update-pin-target"), true));

    const update = channelFor(agent, created.metadata!.name, true);
    (update.metadata as Record<string, string>).id = created.metadata!.id;
    (update.metadata as Record<string, string>).slug = created.metadata!.slug;
    (update.spec as Record<string, unknown>).runConfig = { modelName: "composr-2.5" };

    const err = await grpcError(() => channels.update(update));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("not in the model registry (any harness)");
  });
});

// ---------------------------------------------------------------------------
// Create (Go TestAgentChannelController_Create).
// ---------------------------------------------------------------------------

describe("agentchannel create", () => {
  it("creates with ach_ prefix, normalized ref, pending_install", async () => {
    const agent = await createTestAgent(uniqueName("Create Basics Agent"));
    const channel = await channels.create(channelFor(agent, uniqueName("Slack Workspace"), true));

    expect(channel.metadata?.id).toMatch(/^ach_/);
    expect(channel.spec?.agentRef?.org).toBe(agent.metadata!.org);
    expect(channel.status?.installState).toBe(AgentChannelInstallState.pending_install);
  });

  it("no slug default from the agent — name derives the slug (P7)", async () => {
    const agent = await createTestAgent(uniqueName("Slug Discipline Agent"));
    const name = uniqueName("Team Slack");
    const channel = await channels.create(channelFor(agent, name, true));

    expect(channel.metadata?.slug).toBe(name.toLowerCase().replace(/\s+/g, "-"));
    expect(channel.metadata?.slug).not.toBe(agent.metadata!.slug);
  });

  it("nameless and slugless channel is INVALID_ARGUMENT, never agent-slug fallback", async () => {
    const agent = await createTestAgent(uniqueName("No Name Agent"));
    const err = await grpcError(() => channels.create(channelFor(agent, "", true)));
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("client-provided status is discarded, never trusted", async () => {
    const agent = await createTestAgent(uniqueName("Status Forgery Agent"));
    const created = await channels.create({
      ...channelFor(agent, uniqueName("Forged Status Slack"), true),
      status: { installState: AgentChannelInstallState.installed },
    });
    expect(created.status?.installState).toBe(AgentChannelInstallState.pending_install);
  });

  it("missing org is INVALID_ARGUMENT with the shared copy", async () => {
    const agent = await createTestAgent(uniqueName("Orgless Channel Agent"));
    const ch = channelFor(agent, uniqueName("Orgless Slack"), true);
    ch.metadata.org = "";

    const err = await grpcError(() => channels.create(ch));
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("missing agent_ref slug is INVALID_ARGUMENT naming the field", async () => {
    const err = await grpcError(() =>
      channels.create({
        apiVersion: API_VERSION,
        kind: "AgentChannel",
        metadata: { name: uniqueName("Refless Channel"), org: ORG },
        spec: {
          agentRef: { kind: ApiResourceKind.agent },
          enabled: true,
          providerConfig: { case: "slack" as const, value: {} },
        },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("spec.agent_ref.slug");
  });

  it("nonexistent agent is NOT_FOUND with the direct-lookup copy", async () => {
    const err = await grpcError(() =>
      channels.create({
        apiVersion: API_VERSION,
        kind: "AgentChannel",
        metadata: { name: uniqueName("Ghost Channel"), org: ORG },
        spec: {
          agentRef: { kind: ApiResourceKind.agent, slug: "no-such-agent" },
          enabled: true,
          providerConfig: { case: "slack" as const, value: {} },
        },
      }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe("Agent not found: no-such-agent");
  });

  it("cross-org agent_ref is FAILED_PRECONDITION with the shared copy", async () => {
    const agent = await createTestAgent(uniqueName("Foreign Agent"), "channel-other-org");
    const ch = channelFor(agent, uniqueName("Cross Org Channel"), true);
    ch.metadata.org = ORG;
    ch.spec.agentRef = { ...ch.spec.agentRef, org: "channel-other-org" } as never;

    const err = await grpcError(() => channels.create(ch));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(sameOrgInvariantMessage("channel-other-org"));
  });

  it("cross-org refusal precedes the agent load — no slug probing", async () => {
    // The referenced slug does NOT exist in the foreign org; the refusal
    // must still be FAILED_PRECONDITION, never NOT_FOUND — this path must
    // not disclose whether a foreign org's slug exists.
    const err = await grpcError(() =>
      channels.create({
        apiVersion: API_VERSION,
        kind: "AgentChannel",
        metadata: { name: uniqueName("Probe Channel"), org: ORG },
        spec: {
          agentRef: {
            kind: ApiResourceKind.agent,
            org: "some-foreign-org",
            slug: "possibly-private-slug",
          },
          enabled: true,
          providerConfig: { case: "slack" as const, value: {} },
        },
      }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
  });

  it("duplicate org+slug is ALREADY_EXISTS", async () => {
    const agent = await createTestAgent(uniqueName("Duplicate Channel Agent"));
    const name = uniqueName("Duplicate Slack");
    await channels.create(channelFor(agent, name, true));

    const err = await grpcError(() => channels.create(channelFor(agent, name, true)));
    expect(err.code).toBe(Code.AlreadyExists);
  });

  it("missing provider arm is INVALID_ARGUMENT (required oneof)", async () => {
    const agent = await createTestAgent(uniqueName("Providerless Agent"));
    const err = await grpcError(() =>
      channels.create({
        apiVersion: API_VERSION,
        kind: "AgentChannel",
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
    const first = await channels.create(channelFor(agent, uniqueName("Sales Slack"), true));
    const second = await channels.create(channelFor(agent, uniqueName("Support Slack"), true));
    expect(first.metadata?.slug).not.toBe(second.metadata?.slug);
  });
});

// ---------------------------------------------------------------------------
// Update (Go TestAgentChannelController_Update + provider immutability).
// ---------------------------------------------------------------------------

describe("agentchannel update", () => {
  it("disable is a config-preserving pause; status survives a status-less manifest", async () => {
    const agent = await createTestAgent(uniqueName("Pause Agent"));
    const created = await channels.create(channelFor(agent, uniqueName("Pausable Slack"), true));

    created.spec!.enabled = false;
    created.status = undefined; // a manifest apply sends no status
    const updated = await channels.update(created);
    expect(updated.spec?.enabled).toBe(false);
    expect(updated.status?.installState).toBe(AgentChannelInstallState.pending_install);
  });

  it("agent_ref is immutable with the shared copy", async () => {
    const agentA = await createTestAgent(uniqueName("Immutable Ref Agent A"));
    const agentB = await createTestAgent(uniqueName("Immutable Ref Agent B"));
    const created = await channels.create(channelFor(agentA, uniqueName("Repoint Slack"), true));

    const repointed = channelFor(agentB, "ignored", true);
    (repointed.metadata as Record<string, string>).id = created.metadata!.id;
    (repointed.metadata as Record<string, string>).slug = created.metadata!.slug;
    (repointed.metadata as Record<string, string>).name = created.metadata!.name;
    repointed.spec.agentRef = {
      kind: ApiResourceKind.agent,
      org: agentB.metadata!.org,
      slug: agentB.metadata!.slug,
    } as never;

    const err = await grpcError(() => channels.update(repointed));
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
    await channels.update(relative);
  });

  it("providerFieldName derives the PROTO field name (Go TestProviderFieldName)", () => {
    // The error copy interpolates this; a camelCase/snake_case mismatch
    // with Go would be a silent cross-edition wire divergence.
    const slack = create(AgentChannelSpecSchema, {
      providerConfig: { case: "slack", value: {} },
    });
    expect(providerFieldName(slack)).toBe("slack");
    expect(providerFieldName(create(AgentChannelSpecSchema))).toBe("");
    expect(providerFieldName(undefined)).toBe("");
  });

  it("provider arm is immutable — a real slack→whatsapp flip refuses with the shared copy", async () => {
    const agent = await createTestAgent(uniqueName("Provider Flip Agent"));
    const created = await channels.create(channelFor(agent, uniqueName("Prov Slack"), true));

    const flipped = whatsAppChannelFor(agent, created.metadata!.name);
    (flipped.metadata as Record<string, string>).id = created.metadata!.id;
    (flipped.metadata as Record<string, string>).slug = created.metadata!.slug;
    (flipped.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.channel_app,
      slug: "acme-meta-app",
    };

    const err = await grpcError(() => channels.update(flipped));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(providerImmutableMessage("slack"));
  });
});

// ---------------------------------------------------------------------------
// Apply (Go TestAgentChannelController_Apply) — dedicated org: the final
// List asserts an exact count.
// ---------------------------------------------------------------------------

describe("apply semantics", () => {
  it("apply creates (pending_install), re-apply updates in place preserving status", async () => {
    const org = "channel-apply-org";
    const agent = await createTestAgent(uniqueName("Apply Semantics Agent"), org);
    const name = uniqueName("Apply Slack");

    const created = await channels.apply(channelFor(agent, name, true));
    expect(created.metadata?.id).not.toBe("");
    expect(created.status?.installState).toBe(AgentChannelInstallState.pending_install);

    const updated = await channels.apply(channelFor(agent, name, false));
    expect(updated.metadata?.id).toBe(created.metadata!.id);
    expect(updated.spec?.enabled).toBe(false);
    expect(updated.status?.installState).toBe(AgentChannelInstallState.pending_install);

    const list = await query.list({ org });
    expect(list.totalCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// environment_refs (Go TestAgentChannelController_EnvironmentRefs, T04).
// ---------------------------------------------------------------------------

describe("environment_refs (channel-bound credentials)", () => {
  it("persist in order, empty org normalizes; apply replaces and unbinds; CEL kind check", async () => {
    const agent = await createTestAgent(uniqueName("Env Refs Agent"));
    const name = uniqueName("Env Refs Slack");

    const withRefs = channelFor(agent, name, true);
    (withRefs.spec as Record<string, unknown>).environmentRefs = [
      { kind: ApiResourceKind.environment, slug: "github-credentials" },
      { kind: ApiResourceKind.environment, org: ORG, slug: "search-credentials" },
    ];
    const created = await channels.create(withRefs);
    expect(created.spec?.environmentRefs).toHaveLength(2);
    expect(created.spec?.environmentRefs[0]?.org).toBe(ORG);
    expect(created.spec?.environmentRefs[0]?.slug).toBe("github-credentials");
    expect(created.spec?.environmentRefs[1]?.slug).toBe("search-credentials");

    const fetched = await query.get({ value: created.metadata!.id });
    expect(fetched.spec?.environmentRefs).toHaveLength(2);

    // Apply replaces the refs wholesale — credentials are mutable.
    const rebound = channelFor(agent, name, true);
    (rebound.spec as Record<string, unknown>).environmentRefs = [
      { kind: ApiResourceKind.environment, org: ORG, slug: "rotated-credentials" },
    ];
    const updated = await channels.apply(rebound);
    expect(updated.spec?.environmentRefs).toHaveLength(1);
    expect(updated.spec?.environmentRefs[0]?.slug).toBe("rotated-credentials");

    // Apply omitting the refs unbinds them (declarative semantics).
    const unbound = await channels.apply(channelFor(agent, name, true));
    expect(unbound.spec?.environmentRefs).toHaveLength(0);

    // A non-environment ref kind is INVALID_ARGUMENT (proto CEL).
    const wrongKind = channelFor(agent, uniqueName("Wrong Kind Slack"), true);
    (wrongKind.spec as Record<string, unknown>).environmentRefs = [
      { kind: ApiResourceKind.agent, org: ORG, slug: "not-an-environment" },
    ];
    const err = await grpcError(() => channels.create(wrongKind));
    expect(err.code).toBe(Code.InvalidArgument);
  });
});

// ---------------------------------------------------------------------------
// app_ref (Go TestAgentChannelController_AppRef, T04 item 2).
// ---------------------------------------------------------------------------

describe("app_ref (BYO channel-app binding)", () => {
  it("an empty app_ref org normalizes to the channel's org and persists", async () => {
    const agent = await createTestAgent(uniqueName("App Ref Agent"));
    const ch = channelFor(agent, uniqueName("BYO Slack"), true);
    (ch.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.channel_app,
      slug: "acme-support-app",
    };

    const created = await channels.create(ch);
    expect(created.spec?.appRef?.org).toBe(agent.metadata!.org);
    expect(created.spec?.appRef?.slug).toBe("acme-support-app");
  });

  it("a cross-org app_ref is FAILED_PRECONDITION with the shared copy", async () => {
    const agent = await createTestAgent(uniqueName("Cross Org App Agent"));
    const ch = channelFor(agent, uniqueName("Cross Org App Slack"), true);
    (ch.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.channel_app,
      org: "channel-other-org",
      slug: "their-app",
    };

    const err = await grpcError(() => channels.create(ch));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(APP_REF_SAME_ORG_MESSAGE);
  });

  it("a non-channel_app ref kind is INVALID_ARGUMENT (proto CEL)", async () => {
    const agent = await createTestAgent(uniqueName("Wrong Kind App Agent"));
    const ch = channelFor(agent, uniqueName("Wrong Kind App Slack"), true);
    (ch.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.agent,
      org: agent.metadata!.org,
      slug: "not-a-channel-app",
    };

    const err = await grpcError(() => channels.create(ch));
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("a pending channel may rebind freely — rebind-before-install is the intended flow", async () => {
    const agent = await createTestAgent(uniqueName("Pending Rebind Agent"));
    const ch = channelFor(agent, uniqueName("Pending Rebind Slack"), true);
    (ch.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.channel_app,
      slug: "first-app",
    };
    const created = await channels.create(ch);

    const rebound = channelFor(agent, created.metadata!.name, true);
    (rebound.metadata as Record<string, string>).id = created.metadata!.id;
    (rebound.metadata as Record<string, string>).slug = created.metadata!.slug;
    (rebound.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.channel_app,
      slug: "second-app",
    };
    const updated = await channels.update(rebound);
    expect(updated.spec?.appRef?.slug).toBe("second-app");
  });

  it("app_ref is frozen while installed, with the shared copy", async () => {
    const agent = await createTestAgent(uniqueName("Installed Freeze Agent"));
    const name = uniqueName("Installed Freeze Slack");
    const ch = channelFor(agent, name, true);
    (ch.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.channel_app,
      slug: "granted-app",
    };
    const created = await channels.create(ch);

    // Flip the stored row to installed directly — OSS has no install
    // flow, and the freeze keys on stored status, not on how it got there.
    const stored = await server.store.getResource(
      ApiResourceKind.agent_channel,
      created.metadata!.id,
      AgentChannelSchema,
    );
    stored.status!.installState = AgentChannelInstallState.installed;
    await server.store.saveResource(
      ApiResourceKind.agent_channel,
      created.metadata!.id,
      AgentChannelSchema,
      stored,
    );

    const rebindBase = () => {
      const c = channelFor(agent, name, true);
      (c.metadata as Record<string, string>).id = created.metadata!.id;
      (c.metadata as Record<string, string>).slug = created.metadata!.slug;
      return c;
    };

    const rebound = rebindBase();
    (rebound.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.channel_app,
      slug: "different-app",
    };
    const err = await grpcError(() => channels.update(rebound));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(APP_REF_FROZEN_WHILE_INSTALLED_MESSAGE);

    // Unbinding while installed is equally a change.
    const unbindErr = await grpcError(() => channels.update(rebindBase()));
    expect(unbindErr.code).toBe(Code.FailedPrecondition);

    // An unchanged binding must pass — the disable toggle keeps it.
    const unchanged = rebindBase();
    unchanged.spec.enabled = false;
    (unchanged.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.channel_app,
      org: agent.metadata!.org,
      slug: "granted-app",
    };
    await channels.update(unchanged);
  });
});

// ---------------------------------------------------------------------------
// WhatsApp app_ref (Go TestAgentChannelController_WhatsAppAppRef, DD-WA-2).
// ---------------------------------------------------------------------------

describe("whatsapp app_ref (BYO-only, DD-WA-2)", () => {
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
    const ch = whatsAppChannelFor(agent, uniqueName("WA Bound"));
    (ch.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.channel_app,
      slug: "acme-meta-app",
    };

    const created = await channels.create(ch);
    expect(created.spec?.appRef?.slug).toBe("acme-meta-app");
    expect(created.spec?.appRef?.org).toBe(agent.metadata!.org);
  });

  it("update clearing app_ref is INVALID_ARGUMENT — the binding may change, never disappear", async () => {
    const agent = await createTestAgent(uniqueName("WA Unbind Agent"));
    const name = uniqueName("WA Unbind");
    const ch = whatsAppChannelFor(agent, name);
    (ch.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.channel_app,
      slug: "acme-meta-app",
    };
    const created = await channels.create(ch);

    const unbound = whatsAppChannelFor(agent, name);
    (unbound.metadata as Record<string, string>).id = created.metadata!.id;
    (unbound.metadata as Record<string, string>).slug = created.metadata!.slug;

    const err = await grpcError(() => channels.update(unbound));
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toBe(APP_REF_REQUIRED_FOR_WHATSAPP_MESSAGE);
  });

  it("update keeping the binding passes (uninstalled rebind stays legitimate)", async () => {
    const agent = await createTestAgent(uniqueName("WA Rebind Agent"));
    const ch = whatsAppChannelFor(agent, uniqueName("WA Rebind"));
    (ch.spec as Record<string, unknown>).appRef = {
      kind: ApiResourceKind.channel_app,
      slug: "first-meta-app",
    };
    const created = await channels.create(ch);

    (created.spec!.appRef as Record<string, unknown>).slug = "second-meta-app";
    const updated = await channels.update(created);
    expect(updated.spec?.appRef?.slug).toBe("second-meta-app");
  });
});

// ---------------------------------------------------------------------------
// Delete + queries (Go TestAgentChannelController_Delete / _Queries /
// _GetByAgent) — list counts use a dedicated org.
// ---------------------------------------------------------------------------

describe("delete and queries", () => {
  it("delete returns the deleted channel; get after delete is NOT_FOUND", async () => {
    const agent = await createTestAgent(uniqueName("Delete Agent"));
    const created = await channels.create(channelFor(agent, uniqueName("Doomed Slack"), true));

    const deleted = await channels.delete({ value: created.metadata!.id });
    expect(deleted.metadata?.id).toBe(created.metadata!.id);

    const err = await grpcError(() => query.get({ value: created.metadata!.id }));
    expect(err.code).toBe(Code.NotFound);
  });

  it("nonexistent channel delete is NOT_FOUND", async () => {
    const err = await grpcError(() => channels.delete({ value: "ach_does_not_exist" }));
    expect(err.code).toBe(Code.NotFound);
  });

  it("get by id and by reference round-trip", async () => {
    const agent = await createTestAgent(uniqueName("Query Agent"));
    const created = await channels.create(channelFor(agent, uniqueName("Query Slack"), true));

    const fetched = await query.get({ value: created.metadata!.id });
    expect(fetched.metadata?.slug).toBe(created.metadata!.slug);

    const byRef = await query.getByReference({
      kind: ApiResourceKind.agent_channel,
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
    expect(all.totalCount).toBe(2);

    const filtered = await query.list({ org, labels: { team: "sales" } });
    expect(filtered.totalCount).toBe(1);

    const foreign = await query.list({ org: "channel-bystander-org" });
    expect(foreign.totalCount).toBe(0);
  });

  it("getByAgent finds every channel regardless of slug; org scope filters", async () => {
    const agent = await createTestAgent(uniqueName("Get By Agent Agent"));
    const first = await channels.create(channelFor(agent, uniqueName("Primary Slack"), true));
    const second = await channels.create(channelFor(agent, uniqueName("Secondary Slack"), false));

    const list = await query.getByAgent({ agentId: agent.metadata!.id });
    expect(list.totalCount).toBe(2);
    const slugs = list.items.map((c) => c.metadata?.slug);
    expect(slugs).toContain(first.metadata!.slug);
    expect(slugs).toContain(second.metadata!.slug);

    const matching = await query.getByAgent({ agentId: agent.metadata!.id, org: ORG });
    expect(matching.totalCount).toBe(2);

    const foreign = await query.getByAgent({
      agentId: agent.metadata!.id,
      org: "channel-bystander-org",
    });
    expect(foreign.totalCount).toBe(0);
  });

  it("nonexistent agent yields an empty list", async () => {
    const list = await query.getByAgent({ agentId: "agt-does-not-exist" });
    expect(list.totalCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Install posture (Go TestAgentChannelController_InstallPosture, §0-b).
// ---------------------------------------------------------------------------

describe("install posture (§0-b)", () => {
  it("the full contract: NOT_FOUND with the cloud copy, refusal on existing, nothing persisted", async () => {
    const agent = await createTestAgent(uniqueName("Install Posture Agent"));
    const created = await channels.create(channelFor(agent, uniqueName("Installable Slack"), true));

    const missErr = await grpcError(() =>
      channels.initiateInstall({ resourceId: "ach_does_not_exist" }),
    );
    expect(missErr.code).toBe(Code.NotFound);
    expect(missErr.rawMessage).toBe("AgentChannel not found: ach_does_not_exist");

    const refuseErr = await grpcError(() =>
      channels.initiateInstall({ resourceId: created.metadata!.id }),
    );
    expect(refuseErr.code).toBe(Code.FailedPrecondition);
    expect(refuseErr.rawMessage).toBe(INSTALL_UNAVAILABLE_MESSAGE);

    // completeInstall mirrors the same contract.
    const completeMiss = await grpcError(() =>
      channels.completeInstall({
        resourceId: "ach_does_not_exist",
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
    expect(fetched.status?.installState).toBe(AgentChannelInstallState.pending_install);
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
    const cases: Array<[string, Parameters<typeof messageCommand.sendMessage>[0]]> = [
      ["empty recipient", { payload: textPayload("hello") }],
      ["missing payload", { recipient: "15551234567" }],
      ["unset payload arm", { recipient: "15551234567", payload: {} }],
      ["empty text body", { recipient: "15551234567", payload: textPayload("") }],
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
      messageQuery.listTemplates({ channel: "some-channel", approvedOnly: true }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(PROACTIVE_MESSAGING_UNAVAILABLE_MESSAGE);
  });

  it("listMessagingChannels answers with an empty list, never a refusal (DD-006 D3)", async () => {
    const res = await messageQuery.listMessagingChannels({});
    expect(res.entries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Conversation posture (Go TestChannelConversationController_CloudOnlyPosture).
// ---------------------------------------------------------------------------

describe("channel conversation posture (cloud-only runtime)", () => {
  const controlInput = { agentChannelId: "ach-123", conversationKey: "15551234567" };

  it("discovery reads answer truthful emptiness", async () => {
    const list = await conversationQuery.listConversations({ org: "acme" });
    expect(list.items).toHaveLength(0);

    const timeline = await conversationQuery.getTimeline({
      agentChannelId: "ach-123",
      conversationKey: "15551234567",
    });
    expect(timeline.items).toHaveLength(0);
    expect(timeline.nextPageToken).toBe("");
  });

  it("single-row reads answer the uniform miss", async () => {
    const getErr = await grpcError(() =>
      conversationQuery.getConversation({
        agentChannelId: "ach-123",
        conversationKey: "15551234567",
      }),
    );
    expect(getErr.code).toBe(Code.NotFound);

    const mediaErr = await grpcError(() =>
      conversationQuery.getMediaDownloadUrl({
        agentChannelId: "ach-123",
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
            agentChannelId: "ach-123",
            conversationKey: "15551234567",
            payload: { kind: { case: "text" as const, value: { body: "on my way" } } },
          }),
      ],
      ["takeOver", () => conversationCommand.takeOver(controlInput)],
      ["handBack", () => conversationCommand.handBack(controlInput)],
      ["clearAttention", () => conversationCommand.clearAttention(controlInput)],
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
      expect(err.rawMessage, name).toBe(CONVERSATION_PARTICIPATION_UNAVAILABLE_MESSAGE);
    }
  });

  it("contract violations are INVALID_ARGUMENT before the refusal", async () => {
    const cases: Array<[string, () => Promise<unknown>]> = [
      ["listConversations without org", () => conversationQuery.listConversations({})],
      [
        "getTimeline without conversation key",
        () => conversationQuery.getTimeline({ agentChannelId: "ach-123" }),
      ],
      [
        "getConversation without conversation key",
        () => conversationQuery.getConversation({ agentChannelId: "ach-123" }),
      ],
      [
        "getMediaDownloadUrl without item id",
        () =>
          conversationQuery.getMediaDownloadUrl({
            agentChannelId: "ach-123",
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
            agentChannelId: "ach-123",
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
