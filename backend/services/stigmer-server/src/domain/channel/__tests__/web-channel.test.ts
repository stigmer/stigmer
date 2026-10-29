/**
 * Pins the web channel (a hosted chat link, the Channel kind's `web` type)
 * through the REAL stack: a composed server on an ephemeral port, native
 * gRPC clients (channel + agent), the full interceptor chain.
 *
 * The load-bearing pins beyond the conformance suite's black-box view:
 *   - a nameless web channel takes the slug `<agent slug>-web` and the name
 *     `<agent name> (Web)`, so a second nameless one on one agent is a
 *     duplicate; its agent_ref holds its agent's id;
 *   - a client-provided link token is discarded, never trusted;
 *   - the indistinguishability contract compared ERROR-TO-ERROR (disabled
 *     vs deleted vs locked-link vs no-channel vs an organization that is
 *     gone vs an agent gone or replaced);
 *   - the #478 store-failure sanitization, pinned at the seam
 *     (loadLinkedChannel) with an injected failing store — the composed
 *     server cannot fault-inject storage;
 *   - an update keeps a write that lands between its read and its write
 *     (pipeline/guarded-write.ts): the lost swap reruns from a fresh read,
 *     so the stored channel and the answer carry both the landed
 *     visibility and the update's spec;
 *   - a link rotation of a channel deleted between its read and its write
 *     answers NotFound rather than writing the channel back.
 *
 * This file shares ONE server, so count-sensitive assertions use dedicated orgs and every agent name is
 * unique (slugs derive from names).
 */
import { ServiceTier, ThinkingMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
import type { DescMessage, MessageInitShape, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
import type { Client, Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { AgentCommandController } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/command_pb";
import type { Agent } from "@stigmer/apis/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelCommandController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/command_pb";
import { ChannelQueryController } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/query_pb";
import { ChannelSchema } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import type { Channel } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelAudience } from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import type {
  WebChannelConfig,
  WebChannelConfigSchema,
} from "@stigmer/apis/ai/stigmer/agentic/channel/v1/spec_pb";
import { VaultSchema } from "@stigmer/apis/ai/stigmer/agentic/vault/v1/api_pb";
import { SkillSchema } from "@stigmer/apis/ai/stigmer/agentic/skill/v1/api_pb";
import { OrganizationSchema } from "@stigmer/apis/ai/stigmer/tenancy/organization/v1/api_pb";
import { ApiResourceVisibility } from "@stigmer/apis/ai/stigmer/commons/apiresource/enum_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import { ApiResourceKind } from "@stigmer/apis/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import {
  visibilityWrite,
  writeLandsMidUpdate,
} from "../../../pipeline/__tests__/race-support.js";
import type { Store } from "../../../store/interface.js";
import { sameOrgInvariantMessage } from "../constants.js";
import { linkTokenAllowed, loadLinkedChannel } from "../steps.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";
import type { OrganizationIds } from "../../organization/__tests__/support.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";

type ChannelCommand = Client<typeof ChannelCommandController>;
type ChannelQuery = Client<typeof ChannelQueryController>;
type AgentCommand = Client<typeof AgentCommandController>;

let server: ComposedServer;
let channels: ChannelCommand;
let query: ChannelQuery;
let agents: AgentCommand;
let dir: string;

// Requests name organizations by slug, which the serving chain turns into
// the minted id; rows written straight to the store, and what the server
// answers or interpolates into an error, carry the id.
let organizationIds: OrganizationIds;
function idOf(slug: string): string {
  return organizationId(organizationIds, slug);
}

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "web-channel-domain-test-"));
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
  // Every Organization a describe below writes into (each names its own).
  organizationIds = await seedOrganizations(transport, [
    "create-test-org",
    "launchgate-test-org",
    "update-test-org",
    "profile-test-org",
    "audience-test-org",
    "rotate-test-org",
    "apply-isolation-org",
    "apply-sem-org",
    "gba-bystander-org",
    "gba-provider-org",
    "gba-org",
    "provider-org",
    "consumer-org",
  ]);
  channels = createClient(ChannelCommandController, transport);
  query = createClient(ChannelQueryController, transport);
  agents = createClient(AgentCommandController, transport);
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

async function createTestAgent(name: string, org: string): Promise<Agent> {
  return agents.create({
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name, org },
    spec: {
      description: "Agent for web channel tests",
      instructions: "You are a helpful agent for web channel verification.",
      iconUrl: "https://example.com/icon.svg",
    },
  });
}

/**
 * Writes a skill fixture directly to the store — the established
 * cross-domain fixture pattern (the skill controller needs artifact
 * storage the web channel tests don't).
 */
async function saveSkill(
  id: string,
  org: string,
  slug: string,
  visibility: ApiResourceVisibility,
): Promise<void> {
  const skill = create(SkillSchema, {
    apiVersion: API_VERSION,
    kind: "Skill",
    metadata: { id, name: slug, slug, org, visibility },
  });
  await namingSaves(server.store).saveResource(
    ApiResourceKind.skill,
    id,
    SkillSchema,
    skill,
  );
}

type WebConfigInit = MessageInitShape<typeof WebChannelConfigSchema>;

/**
 * A nameless public web channel of `agent`: no slug, no name, so both
 * default from the agent (`<agent slug>-web`). The anonymous-lane cases
 * below are about a link anyone may open, which is an explicit choice (an
 * omitted audience means the organization); `web` overrides the web
 * settings, a case about another audience sets its own.
 */
function webChannelFor(agent: Agent, enabled: boolean, web: WebConfigInit = {}) {
  return {
    apiVersion: API_VERSION,
    kind: "Channel",
    metadata: { org: agent.metadata!.org },
    spec: {
      agentRef: { kind: ApiResourceKind.agent, slug: agent.metadata!.slug },
      enabled,
      type: {
        case: "web" as const,
        value: { audience: ChannelAudience.public, ...web },
      },
    },
  };
}

/** The web settings of a channel the server answered; fails the case for another type. */
function webOf(channel: Channel): WebChannelConfig {
  const type = channel.spec?.type;
  if (type?.case !== "web") {
    throw new Error(`expected a web channel, got ${String(type?.case)}`);
  }
  return type.value;
}

/** A web channel's live link token as the server answered it; empty when unlocked. */
function linkTokenOn(channel: Channel): string {
  const status = channel.status?.typeStatus;
  return status?.case === "web" ? status.value.linkToken : "";
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
// Create.
// ---------------------------------------------------------------------------

describe("web channel create", () => {
  const ORG = "create-test-org";

  it("a nameless web channel takes the slug <agent slug>-web and the name <agent name> (Web); chn_ id; ref normalized", async () => {
    const agent = await createTestAgent(
      uniqueName("Canonical Default Agent"),
      ORG,
    );
    const channel = await channels.create(webChannelFor(agent, true));

    expect(channel.metadata?.slug).toBe(`${agent.metadata!.slug}-web`);
    expect(channel.metadata?.name).toBe(`${agent.metadata!.name} (Web)`);
    expect(channel.metadata?.id).toMatch(/^chn_/);
    expect(channel.spec?.agentRef?.org).toBe(agent.metadata!.org);
  });

  it("nonexistent agent is NOT_FOUND", async () => {
    const err = await grpcError(() =>
      channels.create({
        apiVersion: API_VERSION,
        kind: "Channel",
        metadata: { org: ORG },
        spec: {
          agentRef: { kind: ApiResourceKind.agent, slug: "no-such-agent" },
          enabled: true,
          type: { case: "web", value: { audience: ChannelAudience.public } },
        },
      }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe("Agent not found: no-such-agent");
  });

  it("an agent_ref naming another organization is FAILED_PRECONDITION with the same-organization copy, before any lookup", async () => {
    const agent = await createTestAgent(
      uniqueName("Cross Org Ghost Agent"),
      ORG,
    );
    const channel = webChannelFor(agent, true);
    channel.spec.agentRef = {
      ...channel.spec.agentRef,
      org: "some-other-org",
    } as never;

    const err = await grpcError(() => channels.create(channel));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(sameOrgInvariantMessage("some-other-org"));
  });

  it("a nameless web channel's agent_ref holds its agent's id", async () => {
    const agent = await createTestAgent(uniqueName("Pin Stamp Agent"), ORG);
    // The request names the agent by slug only.
    const channel = await channels.create(webChannelFor(agent, true));
    expect(channel.spec?.agentRef?.id).toBe(agent.metadata!.id);
    const stored = await server.store.getResource(
      ApiResourceKind.channel,
      channel.metadata!.id,
      ChannelSchema,
    );
    expect(stored.spec?.agentRef?.id).toBe(agent.metadata!.id);
  });

  it("a client-provided link token is discarded, never trusted", async () => {
    const agent = await createTestAgent(uniqueName("Pin Forgery Agent"), ORG);
    const created = await channels.create({
      ...webChannelFor(agent, true),
      status: {
        typeStatus: { case: "web", value: { linkToken: "forged-link-token" } },
      },
    });
    expect(linkTokenOn(created)).toBe("");
    const stored = await server.store.getResource(
      ApiResourceKind.channel,
      created.metadata!.id,
      ChannelSchema,
    );
    expect(linkTokenOn(stored)).toBe("");
  });

  it("missing org is INVALID_ARGUMENT with the pinned copy", async () => {
    const agent = await createTestAgent(uniqueName("Orgless Share Agent"), ORG);
    const channel = webChannelFor(agent, true);
    channel.metadata.org = "";

    const err = await grpcError(() => channels.create(channel));
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("a second nameless web channel for the same agent is ALREADY_EXISTS", async () => {
    const agent = await createTestAgent(
      uniqueName("Duplicate Share Agent"),
      ORG,
    );
    await channels.create(webChannelFor(agent, true));

    const err = await grpcError(() => channels.create(webChannelFor(agent, true)));
    expect(err.code).toBe(Code.AlreadyExists);
  });

  it("a named web channel coexists under its own slug", async () => {
    const agent = await createTestAgent(uniqueName("Multi Channel Agent"), ORG);
    await channels.create(webChannelFor(agent, true));

    const named = webChannelFor(agent, true);
    const name = uniqueName("Docs Site Channel");
    (named.metadata as Record<string, string>).name = name;
    const second = await channels.create(named);
    expect(second.metadata?.slug).toBe(name.toLowerCase().replace(/\s+/g, "-"));
    expect(second.metadata?.slug).not.toBe(`${agent.metadata!.slug}-web`);
  });
});

// ---------------------------------------------------------------------------
// Launch-gate config — the
// validation arms are protovalidate CEL rules in the proto, enforced by
// the shared ValidateProto step; asserted here, not reimplemented.
// ---------------------------------------------------------------------------

describe("launch-gate config", () => {
  const ORG = "launchgate-test-org";

  it("allowed_origins and messages persist and round-trip", async () => {
    const agent = await createTestAgent(
      uniqueName("Launch Gate Config Agent"),
      ORG,
    );
    const created = await channels.create(
      webChannelFor(agent, true, {
        allowedOrigins: ["https://docs.example.com", "http://localhost:3000"],
        messages: {
          rateLimited: "Custom rate copy",
          unavailable: "Custom unavailable copy",
          conversationEnded: "Custom ended copy",
        },
      }),
    );

    const fetched = webOf(await query.get({ value: created.metadata!.id }));
    expect(fetched.allowedOrigins).toEqual([
      "https://docs.example.com",
      "http://localhost:3000",
    ]);
    expect(fetched.messages?.rateLimited).toBe("Custom rate copy");
    expect(fetched.messages?.unavailable).toBe("Custom unavailable copy");
    expect(fetched.messages?.conversationEnded).toBe("Custom ended copy");
  });

  it("malformed origins are INVALID_ARGUMENT", async () => {
    const agent = await createTestAgent(
      uniqueName("Origin Validation Agent"),
      ORG,
    );
    for (const origin of [
      "docs.example.com", // missing scheme
      "https://example.com/path", // path not allowed
      "https://example.com/", // trailing slash not allowed
      "ftp://example.com", // wrong scheme
      "https://example.com?q=1", // query not allowed
    ]) {
      const err = await grpcError(() =>
        channels.create(webChannelFor(agent, true, { allowedOrigins: [origin] })),
      );
      expect(err.code, `origin ${origin}`).toBe(Code.InvalidArgument);
    }
  });

  it("overlong custom message is INVALID_ARGUMENT", async () => {
    const agent = await createTestAgent(
      uniqueName("Message Length Agent"),
      ORG,
    );
    const err = await grpcError(() =>
      channels.create(
        webChannelFor(agent, true, { messages: { rateLimited: "x".repeat(301) } }),
      ),
    );
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("a saved thinking mode with no model of its own is INVALID_ARGUMENT, on create and on update", async () => {
    const agent = await createTestAgent(uniqueName("Thinking Alone Agent"), ORG);
    const base = webChannelFor(agent, true);
    const err = await grpcError(() =>
      channels.create({
        ...base,
        spec: { ...base.spec, runConfig: { thinkingMode: ThinkingMode.ENABLED } },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);
    expect(err.rawMessage).toContain("spec.run_config.model_name");

    const created = await channels.create(base);
    const update = await grpcError(() =>
      channels.update({ resource: {
        ...base,
        metadata: { ...base.metadata, id: created.metadata!.id, slug: created.metadata!.slug },
        spec: { ...base.spec, runConfig: { serviceTier: ServiceTier.FAST } },
      }, updateMask: { paths: ["*"] } }),
    );
    expect(update.code).toBe(Code.InvalidArgument);
  });

  it("vaults on an org-audience web channel is INVALID_ARGUMENT; public persists with its attacher recorded", async () => {
    const agent = await createTestAgent(
      uniqueName("Vaults Audience Agent"),
      ORG,
    );
    // The vault must exist when the channel is written (the reference rule).
    await namingSaves(server.store).saveResource(
      ApiResourceKind.vault,
      "vlt_shared_credentials",
      VaultSchema,
      create(VaultSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Vault",
        metadata: {
          id: "vlt_shared_credentials",
          name: "shared-credentials",
          slug: "shared-credentials",
          org: idOf(ORG),
          visibility: ApiResourceVisibility.visibility_org,
        },
        spec: { owner: { case: "org", value: idOf(ORG) } },
      }),
    );
    const vaultRef = {
      kind: ApiResourceKind.vault,
      org: ORG,
      slug: "shared-credentials",
    };

    const orgAudience = webChannelFor(agent, true, { audience: ChannelAudience.org });
    const err = await grpcError(() =>
      channels.create({
        ...orgAudience,
        spec: { ...orgAudience.spec, vaults: [vaultRef] },
      }),
    );
    expect(err.code).toBe(Code.InvalidArgument);

    const publicAudience = webChannelFor(agent, true, { audience: ChannelAudience.public });
    const created = await channels.create({
      ...publicAudience,
      spec: { ...publicAudience.spec, vaults: [vaultRef] },
    });
    expect(created.spec?.vaults).toHaveLength(1);
    expect(created.spec?.vaults[0]?.slug).toBe("shared-credentials");
    expect(
      created.status?.vaultAttachers["vlt_shared_credentials"],
    ).not.toBe("");
  });

  it("a My vault cannot be attached to a web channel", async () => {
    const agent = await createTestAgent(uniqueName("My Vault Share Agent"), ORG);
    await namingSaves(server.store).saveResource(
      ApiResourceKind.vault,
      "vlt_someones_own",
      VaultSchema,
      create(VaultSchema, {
        apiVersion: "agentic.stigmer.ai/v1",
        kind: "Vault",
        metadata: {
          id: "vlt_someones_own",
          name: "My vault",
          slug: "my-vault-someones-own",
          org: idOf(ORG),
        },
        spec: { owner: { case: "person", value: "ida_someone" } },
      }),
    );
    const base = webChannelFor(agent, true, { audience: ChannelAudience.public });
    const err = await grpcError(() =>
      channels.create({
        ...base,
        spec: {
          ...base.spec,
          vaults: [
            { kind: ApiResourceKind.vault, org: ORG, slug: "my-vault-someones-own" },
          ],
        },
      }),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toMatch(/a My vault cannot be attached to a channel/);
  });
});

// ---------------------------------------------------------------------------
// Update.
// ---------------------------------------------------------------------------

describe("web channel update", () => {
  const ORG = "update-test-org";

  it("disable is a config-preserving pause", async () => {
    const agent = await createTestAgent(uniqueName("Pause Agent"), ORG);
    const created = await channels.create(
      webChannelFor(agent, true, { allowedOrigins: ["https://docs.example.com"] }),
    );

    created.spec!.enabled = false;
    const updated = await channels.update({ resource: created, updateMask: { paths: ["*"] } });
    expect(updated.spec?.enabled).toBe(false);
    expect(webOf(updated).allowedOrigins).toHaveLength(1);
  });

  it("agent_ref is immutable — FAILED_PRECONDITION with the pinned copy", async () => {
    const agentA = await createTestAgent(
      uniqueName("Immutable Ref Agent A"),
      ORG,
    );
    const agentB = await createTestAgent(
      uniqueName("Immutable Ref Agent B"),
      ORG,
    );
    const created = await channels.create(webChannelFor(agentA, true));

    created.spec!.agentRef = create(ApiResourceReferenceSchema, {
      kind: ApiResourceKind.agent,
      org: agentB.metadata!.org,
      slug: agentB.metadata!.slug,
    });
    const err = await grpcError(() => channels.update({ resource: created, updateMask: { paths: ["*"] } }));
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toContain("spec.agent_ref is immutable");
  });

  it("an update keeps a write that lands between its read and its write", async () => {
    const agent = await createTestAgent(uniqueName("Race Agent"), ORG);
    const created = await channels.create(webChannelFor(agent, true));
    const id = created.metadata!.id;
    expect(created.metadata?.visibility).toBe(
      ApiResourceVisibility.visibility_private,
    );

    created.spec!.enabled = false;
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
// Cross-org contract.
// ---------------------------------------------------------------------------

describe("the same-organization invariant", () => {
  const PROVIDER = "provider-org";
  const CONSUMER = "consumer-org";

  function channelInAnotherOrg(agent: Agent, enabled: boolean) {
    const channel = webChannelFor(agent, enabled);
    channel.metadata.org = CONSUMER;
    channel.spec.agentRef = {
      ...channel.spec.agentRef,
      org: agent.metadata!.org,
    } as never;
    return channel;
  }

  it("another organization's agent cannot be given a web channel — the same sentence whether the agent exists or not, at any level", async () => {
    const existing = await createTestAgent(
      uniqueName("Provider Agent"),
      PROVIDER,
    );
    const err = await grpcError(() =>
      channels.create(channelInAnotherOrg(existing, true)),
    );
    expect(err.code).toBe(Code.FailedPrecondition);
    expect(err.rawMessage).toBe(sameOrgInvariantMessage(idOf(PROVIDER)));

    const ghost = webChannelFor(existing, true);
    ghost.metadata.org = CONSUMER;
    ghost.spec.agentRef = {
      ...ghost.spec.agentRef,
      org: PROVIDER,
      slug: "no-such-agent",
    } as never;
    const ghostErr = await grpcError(() => channels.create(ghost));
    expect(ghostErr.code).toBe(Code.FailedPrecondition);
    expect(ghostErr.rawMessage).toBe(sameOrgInvariantMessage(idOf(PROVIDER)));
  });

  it("a stored web channel whose agent is in another organization fails the profile closed, like a dangling reference", async () => {
    const agent = await createTestAgent(
      uniqueName("Cross Org Provider Agent"),
      PROVIDER,
    );
    // A row that reached the store past the invariant, written straight
    // to it: its reference holds the other organization's agent by id, so
    // only the organization tells it apart from a live link.
    const strayRow = create(ChannelSchema, {
      apiVersion: API_VERSION,
      kind: "Channel",
      metadata: {
        id: "chn_stray_cross_org",
        name: "stray-cross-org",
        slug: "stray-cross-org",
        org: idOf(CONSUMER),
      },
      spec: {
        agentRef: {
          kind: ApiResourceKind.agent,
          org: idOf(PROVIDER),
          id: agent.metadata!.id,
          slug: agent.metadata!.slug,
        },
        enabled: true,
        type: { case: "web", value: { audience: ChannelAudience.public } },
      },
    });
    await namingSaves(server.store).saveResource(
      ApiResourceKind.channel,
      strayRow.metadata!.id,
      ChannelSchema,
      strayRow,
    );

    const err = await grpcError(() =>
      query.getAgentProfile({ channelId: strayRow.metadata!.id }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe(`Agent not found: ${strayRow.metadata!.id}`);
    // The row itself is still readable by id — nothing is deleted.
    const row = await query.get({ value: strayRow.metadata!.id });
    expect(row.spec?.agentRef?.id).toBe(agent.metadata!.id);
  });
});

// ---------------------------------------------------------------------------
// Anonymous profile lane.
// ---------------------------------------------------------------------------

describe("getAgentProfile (anonymous lane)", () => {
  const ORG = "profile-test-org";

  it("uniform NotFound across no-channel / disabled / deleted; enabled resolves trimmed", async () => {
    const agent = await createTestAgent(
      uniqueName("Shared Profile Agent"),
      ORG,
    );

    // No such channel: the refusal echoes the id the caller sent.
    const noChannelErr = await grpcError(() =>
      query.getAgentProfile({ channelId: "chn_never_created" }),
    );
    expect(noChannelErr.code).toBe(Code.NotFound);
    expect(noChannelErr.rawMessage).toBe("Agent not found: chn_never_created");

    // An enabled web channel resolves by its id to the trimmed profile —
    // display fields from the AGENT, org, slug and the agent reference the
    // hosted page starts its sessions on from the CHANNEL, never the full
    // Agent.
    const channel = await channels.create(webChannelFor(agent, true));
    const ref = { channelId: channel.metadata!.id };
    const missing = `Agent not found: ${channel.metadata!.id}`;
    const profile = await query.getAgentProfile(ref);
    expect(profile.org).toBe(channel.metadata!.org);
    expect(profile.slug).toBe(channel.metadata!.slug);
    expect(profile.name).toBe(agent.metadata!.name);
    expect(profile.description).toBe(agent.spec!.description);
    expect(profile.iconUrl).toBe(agent.spec!.iconUrl);
    expect(profile.agentRef).toEqual(channel.spec!.agentRef);

    // Disabled: byte-identical to no-channel.
    channel.spec!.enabled = false;
    await channels.update({ resource: channel, updateMask: { paths: ["*"] } });
    const disabledErr = await grpcError(() => query.getAgentProfile(ref));
    expect(disabledErr.code).toBe(Code.NotFound);
    expect(disabledErr.rawMessage).toBe(missing);

    // Deleted: indistinguishable too.
    await channels.delete({ value: channel.metadata!.id });
    const deletedErr = await grpcError(() => query.getAgentProfile(ref));
    expect(deletedErr.code).toBe(Code.NotFound);
    expect(deletedErr.rawMessage).toBe(missing);
  });

  it("dangling agent_ref fails closed with the same error, naming the channel's id", async () => {
    const agent = await createTestAgent(uniqueName("Soon Deleted Agent"), ORG);
    const channel = await channels.create(webChannelFor(agent, true));
    await agents.delete({ value: agent.metadata!.id });

    const err = await grpcError(() =>
      query.getAgentProfile({ channelId: channel.metadata!.id }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe(`Agent not found: ${channel.metadata!.id}`);
  });

  it("a stored web channel whose agent is gone or was replaced fails closed, naming the channel's id", async () => {
    // An agent delete cascades its channels, so these rows are written
    // straight to the store: one holds an agent id nothing holds, one
    // holds an id the slug's current holder does not carry.
    const agent = await createTestAgent(uniqueName("Rebound Agent"), ORG);
    const rows = [
      { id: "chn_stored_dangling", slug: "no-such-agent", agentId: "agt_gone" },
      {
        id: "chn_stored_stale_pin",
        slug: agent.metadata!.slug,
        agentId: "agt_replaced",
      },
    ];
    for (const row of rows) {
      const stored = create(ChannelSchema, {
        apiVersion: API_VERSION,
        kind: "Channel",
        metadata: { id: row.id, name: row.id, slug: row.id, org: idOf(ORG) },
        spec: {
          agentRef: {
            kind: ApiResourceKind.agent,
            org: idOf(ORG),
            id: row.agentId,
            slug: row.slug,
          },
          enabled: true,
          type: { case: "web", value: { audience: ChannelAudience.public } },
        },
      });
      await namingSaves(server.store).saveResource(
        ApiResourceKind.channel,
        row.id,
        ChannelSchema,
        stored,
      );
      const err = await grpcError(() =>
        query.getAgentProfile({ channelId: row.id }),
      );
      expect(err.code, row.id).toBe(Code.NotFound);
      expect(err.rawMessage, row.id).toBe(`Agent not found: ${row.id}`);
      await namingSaves(server.store).deleteResource(ApiResourceKind.channel, row.id);
    }
  });

  it("another kind's id answers the same NotFound", async () => {
    const agent = await createTestAgent(uniqueName("Wrong Kind Agent"), ORG);
    const err = await grpcError(() =>
      query.getAgentProfile({ channelId: agent.metadata!.id }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe(`Agent not found: ${agent.metadata!.id}`);
  });

  it("an empty channel_id is INVALID_ARGUMENT", async () => {
    const err = await grpcError(() => query.getAgentProfile({ channelId: "" }));
    expect(err.code).toBe(Code.InvalidArgument);
  });

  it("a web channel whose organization is gone answers the same NotFound on both lanes", async () => {
    const agent = await createTestAgent(
      uniqueName("Orphaned Share Agent"),
      ORG,
    );
    const channel = await channels.create(webChannelFor(agent, true));
    const ref = { channelId: channel.metadata!.id };
    await query.getAgentProfile(ref);

    // Delete leaves an organization's resources in place; only its row
    // goes. Removing the row directly is that state, with nothing else
    // in this shared server's organization disturbed.
    const org = channel.metadata!.org;
    const orgRow = await server.store.getResource(
      ApiResourceKind.organization,
      org,
      OrganizationSchema,
    );
    await namingSaves(server.store).deleteResource(ApiResourceKind.organization, org);
    try {
      const anonymous = await grpcError(() => query.getAgentProfile(ref));
      expect(anonymous.code).toBe(Code.NotFound);
      expect(anonymous.rawMessage).toBe(
        `Agent not found: ${channel.metadata!.id}`,
      );
      const member = await grpcError(() =>
        query.getAgentProfileForMember({ value: channel.metadata!.id }),
      );
      expect(member.code).toBe(Code.NotFound);
      expect(member.rawMessage).toBe(anonymous.rawMessage);
    } finally {
      await namingSaves(server.store).saveResource(
        ApiResourceKind.organization,
        org,
        OrganizationSchema,
        orgRow,
      );
    }
    await query.getAgentProfile(ref);
  });
});

// ---------------------------------------------------------------------------
// Audience + member lane.
// ---------------------------------------------------------------------------

describe("audience and the member resolution lane", () => {
  const ORG = "audience-test-org";

  it("audience persists and round-trips", async () => {
    const agent = await createTestAgent(
      uniqueName("Audience Round Trip Agent"),
      ORG,
    );
    const created = await channels.create(
      webChannelFor(agent, true, { audience: ChannelAudience.org }),
    );
    expect(webOf(created).audience).toBe(ChannelAudience.org);

    const fetched = await query.get({ value: created.metadata!.id });
    expect(webOf(fetched).audience).toBe(ChannelAudience.org);
  });

  it("member path resolves web channels in either audience (OSS: membership always holds)", async () => {
    const agent = await createTestAgent(
      uniqueName("Member Resolution Agent"),
      ORG,
    );

    const noChannelErr = await grpcError(() =>
      query.getAgentProfileForMember({ value: "chn_never_created" }),
    );
    expect(noChannelErr.code).toBe(Code.NotFound);
    expect(noChannelErr.rawMessage).toBe("Agent not found: chn_never_created");

    const channel = await channels.create(
      webChannelFor(agent, true, { audience: ChannelAudience.org }),
    );

    const profile = await query.getAgentProfileForMember({
      value: channel.metadata!.id,
    });
    expect(profile.slug).toBe(channel.metadata!.slug);
    expect(profile.name).toBe(agent.metadata!.name);
  });

  it("the member path refuses a disabled web channel with the missing channel's NotFound", async () => {
    const agent = await createTestAgent(
      uniqueName("Member Disabled Agent"),
      ORG,
    );
    const channel = await channels.create(
      webChannelFor(agent, false, { audience: ChannelAudience.org }),
    );
    const err = await grpcError(() =>
      query.getAgentProfileForMember({ value: channel.metadata!.id }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe(`Agent not found: ${channel.metadata!.id}`);
  });

  it("an omitted audience is written out as org on create, update and apply, and reaches no anonymous reader", async () => {
    const agent = await createTestAgent(
      uniqueName("Omitted Audience Agent"),
      ORG,
    );
    const created = await channels.create(
      webChannelFor(agent, true, { audience: ChannelAudience.unspecified }),
    );
    expect(webOf(created).audience).toBe(ChannelAudience.org);
    const anonymous = await grpcError(() =>
      query.getAgentProfile({ channelId: created.metadata!.id }),
    );
    expect(anonymous.code).toBe(Code.NotFound);

    // A public channel updated or applied without an audience narrows to
    // the organization: update and apply replace the spec whole.
    webOf(created).audience = ChannelAudience.public;
    const opened = await channels.update({ resource: created, updateMask: { paths: ["*"] } });
    expect(webOf(opened).audience).toBe(ChannelAudience.public);
    webOf(opened).audience = ChannelAudience.unspecified;
    const narrowed = await channels.update({ resource: opened, updateMask: { paths: ["*"] } });
    expect(webOf(narrowed).audience).toBe(ChannelAudience.org);
    webOf(narrowed).audience = ChannelAudience.unspecified;
    const applied = await channels.apply(narrowed);
    expect(webOf(applied).audience).toBe(ChannelAudience.org);
  });

  it("a stored row holding no audience reads as organization-only, never public", async () => {
    const agent = await createTestAgent(
      uniqueName("Unset Audience Agent"),
      ORG,
    );
    const created = await channels.create(webChannelFor(agent, true));
    webOf(created).audience = ChannelAudience.unspecified;
    await namingSaves(server.store).saveResource(
      ApiResourceKind.channel,
      created.metadata!.id,
      ChannelSchema,
      created,
    );
    const anonymous = await grpcError(() =>
      query.getAgentProfile({ channelId: created.metadata!.id }),
    );
    expect(anonymous.code).toBe(Code.NotFound);
    const member = await query.getAgentProfileForMember({
      value: created.metadata!.id,
    });
    expect(member.slug).toBe(created.metadata!.slug);
  });

  it("the ANONYMOUS path collapses an org-audience web channel to the uniform NotFound (the proto's audience contract)", async () => {
    const agent = await createTestAgent(
      uniqueName("Org Audience Anon Agent"),
      ORG,
    );
    const channel = await channels.create(
      webChannelFor(agent, true, { audience: ChannelAudience.org }),
    );

    // Byte-identical with the missing/disabled/rotated refusals — a
    // members-only chat link must teach an anonymous visitor nothing.
    const err = await grpcError(() =>
      query.getAgentProfile({ channelId: channel.metadata!.id }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe(`Agent not found: ${channel.metadata!.id}`);

    // Flipping back to public restores anonymous resolution — the same
    // immediate-revocation latency as disabling the channel.
    webOf(channel).audience = ChannelAudience.public;
    await channels.update({ resource: channel, updateMask: { paths: ["*"] } });
    const profile = await query.getAgentProfile({
      channelId: channel.metadata!.id,
    });
    expect(profile.slug).toBe(channel.metadata!.slug);
  });
});

// ---------------------------------------------------------------------------
// Agent-apply isolation.
// ---------------------------------------------------------------------------

describe("agent apply never touches the web channel", () => {
  it("a full agent update leaves the web channel resolving, with fresh display fields", async () => {
    const agent = await createTestAgent(
      uniqueName("Apply Isolation Agent"),
      "apply-isolation-org",
    );
    const channel = await channels.create(webChannelFor(agent, true));

    agent.spec!.description = "Updated description";
    await agents.update({ resource: agent, updateMask: { paths: ["*"] } });

    const profile = await query.getAgentProfile({
      channelId: channel.metadata!.id,
    });
    expect(profile.description).toBe("Updated description");
  });
});

// ---------------------------------------------------------------------------
// rotateLink (and its org-audience
// member-path twin).
// ---------------------------------------------------------------------------

describe("rotateLink", () => {
  const ORG = "rotate-test-org";

  it("the full rotation lifecycle: lock, resolve-with-token, re-rotate, preserve across update", async () => {
    const agent = await createTestAgent(uniqueName("Rotate Link Agent"), ORG);
    const channel = await channels.create(webChannelFor(agent, true));
    const request = (token: string) => ({
      channelId: channel.metadata!.id,
      linkToken: token,
    });
    // The locked-link refusal is byte-identical to a missing channel's.
    const missing = `Agent not found: ${channel.metadata!.id}`;

    // A stray ?k= on an unlocked link is harmless.
    await query.getAgentProfile(request("stray-token"));

    // Rotation locks the link: 27 url-safe chars, status-resident.
    const rotated = await channels.rotateLink({
      resourceId: channel.metadata!.id,
    });
    const firstToken = linkTokenOn(rotated);
    expect(firstToken).toHaveLength(27);
    expect(firstToken).toMatch(/^[A-Za-z0-9_-]+$/);

    const lockedErr = await grpcError(() =>
      query.getAgentProfile(request("")),
    );
    expect(lockedErr.code).toBe(Code.NotFound);
    expect(lockedErr.rawMessage).toBe(missing);

    await query.getAgentProfile(request(firstToken));

    // Re-rotation kills the previous token.
    const reRotated = await channels.rotateLink({
      resourceId: channel.metadata!.id,
    });
    const secondToken = linkTokenOn(reRotated);
    expect(secondToken).not.toBe(firstToken);

    const deadErr = await grpcError(() =>
      query.getAgentProfile(request(firstToken)),
    );
    expect(deadErr.code).toBe(Code.NotFound);
    expect(deadErr.rawMessage).toBe(missing);
    await query.getAgentProfile(request(secondToken));

    // The tokenless member path must not reveal a token-locked PUBLIC link.
    const memberErr = await grpcError(() =>
      query.getAgentProfileForMember({ value: channel.metadata!.id }),
    );
    expect(memberErr.code).toBe(Code.NotFound);
    expect(memberErr.rawMessage).toBe(missing);

    // A manifest-shaped update (no status) preserves the token — status
    // survives every update verbatim, the design's core guarantee.
    const current = await query.get({ value: channel.metadata!.id });
    current.status = undefined;
    const updated = await channels.update({ resource: current, updateMask: { paths: ["*"] } });
    expect(linkTokenOn(updated)).toBe(secondToken);
  });

  it("nonexistent channel is NOT_FOUND", async () => {
    const err = await grpcError(() =>
      channels.rotateLink({ resourceId: "chn-does-not-exist" }),
    );
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe("Channel not found: chn-does-not-exist");
  });

  it("a link rotation of a web channel deleted between its read and its write answers NotFound", async () => {
    const agent = await createTestAgent(uniqueName("Vanish Rotate Agent"), ORG);
    const channel = await channels.create(webChannelFor(agent, true));
    const id = channel.metadata!.id;

    // The first atomic write to the channel deletes the row first, so the
    // rotation's write finds no row: the delete landed after its read.
    const store = server.store;
    const updateResource = store.updateResource.bind(store);
    let armed = true;
    const spy = vi.spyOn(store, "updateResource").mockImplementation((async <
      Desc extends DescMessage,
    >(
      writtenKind: ApiResourceKind,
      writtenId: string,
      schema: Desc,
      modify: (msg: MessageShape<Desc>) => void,
    ) => {
      if (armed && writtenKind === ApiResourceKind.channel && writtenId === id) {
        armed = false;
        await store.deleteResource(writtenKind, writtenId);
      }
      return updateResource(writtenKind, writtenId, schema, modify);
    }) as typeof store.updateResource);
    let err: ConnectError;
    try {
      err = await grpcError(() => channels.rotateLink({ resourceId: id }));
    } finally {
      spy.mockRestore();
    }

    expect(armed).toBe(false);
    expect(err.code).toBe(Code.NotFound);
    expect(err.rawMessage).toBe(`Channel not found: ${id}`);
  });

  it("member path stays open for org-audience web channels even when a token exists", async () => {
    const agent = await createTestAgent(
      uniqueName("Org Audience Rotate Agent"),
      ORG,
    );
    const created = await channels.create(
      webChannelFor(agent, true, { audience: ChannelAudience.org }),
    );
    await channels.rotateLink({ resourceId: created.metadata!.id });

    const profile = await query.getAgentProfileForMember({
      value: created.metadata!.id,
    });
    expect(profile.slug).toBe(created.metadata!.slug);
  });
});

// ---------------------------------------------------------------------------
// listByAgent.
// ---------------------------------------------------------------------------

describe("listByAgent", () => {
  it("finds the nameless web channel and a named web channel", async () => {
    const agent = await createTestAgent(
      uniqueName("Get By Agent Agent"),
      "gba-org",
    );
    const nameless = await channels.create(webChannelFor(agent, true));

    const named = webChannelFor(agent, true);
    (named.metadata as Record<string, string>).name =
      uniqueName("Renamed Channel");
    const second = await channels.create(named);

    const list = await query.listByAgent({ agentId: agent.metadata!.id });
    expect(list.entries).toHaveLength(2);
    const slugs = list.entries.map((c: Channel) => c.metadata?.slug);
    expect(slugs).toContain(nameless.metadata!.slug);
    expect(slugs).toContain(second.metadata!.slug);
  });

  it("nonexistent agent yields an empty list, not an error", async () => {
    const list = await query.listByAgent({ agentId: "agt_does-not-exist" });
    expect(list.entries).toHaveLength(0);
  });

  it("org scopes the list to one org's channels", async () => {
    const agent = await createTestAgent(
      uniqueName("Org Scoped List Agent"),
      "gba-provider-org",
    );
    await channels.create(webChannelFor(agent, true));
    const named = webChannelFor(agent, true);
    named.metadata = { ...named.metadata, name: "second link" } as never;
    await channels.create(named);

    // The request names the organization by slug; the channels it answers
    // record the organization's id.
    const cases: Array<{ org: string; want: number; wantOrg: string }> = [
      { org: "", want: 2, wantOrg: "" },
      { org: "gba-provider-org", want: 2, wantOrg: idOf("gba-provider-org") },
      { org: "gba-bystander-org", want: 0, wantOrg: "" },
    ];
    for (const tt of cases) {
      const list = await query.listByAgent({
        agentId: agent.metadata!.id,
        org: tt.org,
      });
      expect(list.entries, `org ${tt.org}`).toHaveLength(tt.want);
      for (const item of list.entries) {
        if (tt.wantOrg !== "") {
          expect(item.metadata?.org).toBe(tt.wantOrg);
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Apply semantics — delegates the
// CLONED state, so a nameless manifest (no name/slug) applies twice into
// ONE web channel.
// ---------------------------------------------------------------------------

describe("apply semantics", () => {
  it("apply creates, re-apply updates in place — never duplicates", async () => {
    const agent = await createTestAgent(
      uniqueName("Apply Semantics Agent"),
      "apply-sem-org",
    );

    const created = await channels.apply(webChannelFor(agent, true));
    expect(created.metadata?.id).not.toBe("");

    const updated = await channels.apply(
      webChannelFor(agent, true, { allowedOrigins: ["https://docs.example.com"] }),
    );
    expect(updated.metadata?.id).toBe(created.metadata!.id);
    expect(webOf(updated).allowedOrigins).toHaveLength(1);

    const list = await query.list({ org: "apply-sem-org" });
    expect(list.entries).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Seam-level pins that the composed server cannot reach.
// ---------------------------------------------------------------------------

describe("seam-level pins", () => {
  it("store failure leaks no internals (stigmer/stigmer#478)", async () => {
    // The pin sits on the exact seam that formats the wire error — the channel lookup used
    // by the ONLY anonymous RPC. The wire carries the static message; the
    // cause stays server-side on ConnectError.cause.
    const cause = new Error("bbolt: /var/lib/stigmer/store.db corrupted");
    const failing = {
      getResource: async () => {
        throw cause;
      },
    } as unknown as Store;

    const err = await grpcError(() => loadLinkedChannel(failing, "chn_x"));
    expect(err.code).toBe(Code.Internal);
    expect(err.rawMessage).toBe("failed to load channel");
    expect(err.rawMessage).not.toContain("bbolt");
    expect(err.cause).toBe(cause);
  });

  it("an organization read failure leaks no internals either", async () => {
    const cause = new Error("bbolt: /var/lib/stigmer/store.db corrupted");
    const failing = {
      getResource: async (kind: ApiResourceKind) => {
        if (kind === ApiResourceKind.channel) {
          return create(ChannelSchema, {
            metadata: { id: "chn_x", org: "org_x" },
            spec: { type: { case: "web", value: {} } },
          });
        }
        throw cause;
      },
    } as unknown as Store;

    const err = await grpcError(() => loadLinkedChannel(failing, "chn_x"));
    expect(err.code).toBe(Code.Internal);
    expect(err.rawMessage).toBe("failed to load organization");
    expect(err.cause).toBe(cause);
  });

  it("linkTokenAllowed: constant-time compare that refuses a length mismatch", () => {
    // Unlocked link: anything presented is ignored.
    expect(linkTokenAllowed("", "")).toBe(true);
    expect(linkTokenAllowed("stray", "")).toBe(true);
    // Locked link: exact match only; empty and length-mismatched presented
    // tokens refuse (Node's timingSafeEqual would THROW on a length
    // mismatch without the guard).
    expect(linkTokenAllowed("", "live-token")).toBe(false);
    expect(linkTokenAllowed("live-token", "live-token")).toBe(true);
    expect(linkTokenAllowed("live-tok", "live-token")).toBe(false);
    expect(linkTokenAllowed("live-tokeX", "live-token")).toBe(false);
  });
});
