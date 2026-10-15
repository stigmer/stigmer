/**
 * Pins the two guards that keep a channel from outliving its agent
 * (cascade.ts), through the REAL stack: a composed server on an ephemeral
 * port with ONE extension unit carrying a recording fake channel runtime,
 * native gRPC clients and the full interceptor chain.
 *
 *   - the agent's delete (CascadeDeleteChannels) removes every channel of
 *     the agent in its own organization, of every type: a Slack or
 *     WhatsApp channel through the composed runtime's teardownOnDelete
 *     first (handed that channel), a web channel without it; the row, its
 *     names and its access go, so a channel of that name can be made
 *     again. A teardown that throws fails the agent's delete and keeps the
 *     agent and that channel, and the retry heals. A channel of another
 *     organization naming the agent is that organization's row and is
 *     left.
 *   - create, after it stores the channel and its access, reads the agent
 *     again (EnsureChannelAgentStillExists): an agent deleted meanwhile
 *     (its delete listed its channels before this one was stored) takes
 *     the new channel with it, row and name, with no runtime teardown (a
 *     new channel has no runtime state), and the create answers NOT_FOUND
 *     naming the agent by the id its resolved reference holds.
 *   - the cascade step on its own: a chain that never loaded the agent is
 *     a broken invariant and throws; an agent with no id reads nothing;
 *     and the shared read (queries.ts) skips a row that does not decode,
 *     logging it, and keeps every row that does.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create, toBinary } from "@bufbuild/protobuf";
import type { DescMessage, MessageInitShape, MessageShape } from "@bufbuild/protobuf";
import { Code, ConnectError, createClient } from "@connectrpc/connect";
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

import { AgentCommandController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/command_pb";
import { AgentQueryController } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/query_pb";
import { AgentSchema } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/command_pb";
import { ChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/query_pb";
import { ChannelAudience } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { testCallerIdentity, untouchable } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../../pipeline/steps/load-existing.js";
import { resolveName } from "../../../pipeline/steps/names.js";
import type { Store } from "../../../store/interface.js";
import { newCascadeDeleteChannelsStep } from "../cascade.js";
import { listChannelsOfAgent } from "../queries.js";
import { namingSaves } from "../../../store/__tests__/named-saves.js";
import type { ChannelRuntime } from "../channel-runtime.js";
import {
  organizationId,
  seedOrganizations,
} from "../../organization/__tests__/support.js";

const silentLogger = createLogger({
  level: "error",
  pretty: false,
  write: () => {},
});

const API_VERSION = "agentic.stigmer.ai/v1";
const ORG = "channel-cascade-org";
const OTHER_ORG = "channel-cascade-other-org";
let ORG_ID: string;
let OTHER_ORG_ID: string;

const FAKE_TEARDOWN_FAILURE_MESSAGE = "fake teardown failure";

/** The channels the fake runtime's teardown was handed, in order. */
const tornDown: Channel[] = [];
let failTeardown = false;

/** A runtime arm none of these cases reaches. */
function unused(): Promise<never> {
  return Promise.reject(new Error("not reached by the cascade cases"));
}

/** The recording fake: its teardown records the channel and fails when armed. */
const fakeRuntime: ChannelRuntime = {
  installs: { initiateInstall: unused, completeInstall: unused },
  messaging: {
    sendMessage: unused,
    listTemplates: unused,
    listMessagingChannels: unused,
  },
  conversations: {
    list: unused,
    countConversations: unused,
    getConversation: unused,
    listTimeline: unused,
    getMediaDownloadUrl: unused,
    reply: unused,
    takeOver: unused,
    handBack: unused,
    clearAttention: unused,
    escalate: unused,
  },
  enforceWriteConstraints: () => Promise.resolve(),
  teardownOnDelete: (channel) => {
    tornDown.push(channel);
    return failTeardown
      ? Promise.reject(new Error(FAKE_TEARDOWN_FAILURE_MESSAGE))
      : Promise.resolve();
  },
};

let server: ComposedServer;
let channels: Client<typeof ChannelCommandController>;
let channelQuery: Client<typeof ChannelQueryController>;
let agents: Client<typeof AgentCommandController>;
let agentQuery: Client<typeof AgentQueryController>;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "channel-cascade-test-"));
  vi.stubEnv("STIGMER_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv(
    "STIGMER_RUNNER_TOKEN_KEY",
    Buffer.alloc(32, 8).toString("base64"),
  );
  server = await composeServer({
    config: loadConfig({
      STIGMER_MODEL_REGISTRY_REFRESH: "off",
      // No engine behind composed tests — the channel.test.ts posture.
      TEMPORAL_HOST_PORT: "127.0.0.1:1",
      DB_PATH: path.join(dir, "stigmer.db"),
      ARTIFACT_LOCAL_BASE_PATH: path.join(dir, "artifacts"),
    }),
    logger: silentLogger,
    portOverride: 0,
    host: "127.0.0.1",
    extensions: [
      { name: "fake-channels", drivers: { channelRuntime: fakeRuntime } },
    ],
  });
  const port = await server.start();
  const transport: Transport = createGrpcTransport({
    baseUrl: `http://127.0.0.1:${port}`,
  });
  const organizationIds = await seedOrganizations(transport, [ORG, OTHER_ORG]);
  ORG_ID = organizationId(organizationIds, ORG);
  OTHER_ORG_ID = organizationId(organizationIds, OTHER_ORG);
  channels = createClient(ChannelCommandController, transport);
  channelQuery = createClient(ChannelQueryController, transport);
  agents = createClient(AgentCommandController, transport);
  agentQuery = createClient(AgentQueryController, transport);
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

beforeEach(() => {
  tornDown.length = 0;
  failTeardown = false;
});

let counter = 0;
function uniqueName(base: string): string {
  counter += 1;
  return `${base} ${counter}`;
}

async function createTestAgent(name: string): Promise<Agent> {
  return agents.create({
    apiVersion: API_VERSION,
    kind: "Agent",
    metadata: { name, org: ORG },
    spec: {
      description: "Agent for channel cascade tests",
      instructions: "You are a helpful agent for cascade verification.",
    },
  });
}

/** A nameless channel of `agent` of the given type: its slug is `<agent slug>-<type>`. */
function namelessChannel(
  agent: Agent,
  type: "web" | "slack",
): MessageInitShape<typeof ChannelSchema> {
  return {
    apiVersion: API_VERSION,
    kind: "Channel",
    metadata: { org: ORG },
    spec: {
      agentRef: { kind: ApiResourceKind.agent, slug: agent.metadata!.slug },
      enabled: true,
      type:
        type === "web"
          ? {
              case: "web" as const,
              value: { audience: ChannelAudience.public },
            }
          : { case: "slack" as const, value: {} },
    },
  };
}

async function grpcError(run: () => Promise<unknown>): Promise<ConnectError> {
  try {
    await run();
  } catch (error) {
    return ConnectError.from(error);
  }
  throw new Error("expected the call to fail");
}

async function channelGone(id: string): Promise<boolean> {
  const err = await grpcError(() => channelQuery.get({ value: id }));
  return err.code === Code.NotFound;
}

describe("an agent's delete takes its channels (CascadeDeleteChannels)", () => {
  it("removes its web channel and its Slack channel, the Slack one through the runtime's teardown, and releases their names", async () => {
    const name = uniqueName("Cascaded Agent");
    const agent = await createTestAgent(name);
    const web = await channels.create(namelessChannel(agent, "web"));
    const slack = await channels.create(namelessChannel(agent, "slack"));

    await agents.delete({ value: agent.metadata!.id });

    // The runtime tore down the Slack channel, handed that channel, and
    // never the web channel.
    expect(tornDown.map((c) => c.metadata?.id)).toEqual([slack.metadata!.id]);
    expect(tornDown[0]?.spec?.type.case).toBe("slack");
    expect(await channelGone(web.metadata!.id)).toBe(true);
    expect(await channelGone(slack.metadata!.id)).toBe(true);

    // Their names are free: nothing holds them, and an agent of the same
    // name can have channels of those names again.
    for (const channel of [web, slack]) {
      expect(
        await resolveName(server.store, ApiResourceKind.channel, ORG_ID, channel.metadata!.slug),
      ).toBeUndefined();
    }
    const again = await createTestAgent(name);
    expect(again.metadata?.slug).toBe(agent.metadata!.slug);
    const webAgain = await channels.create(namelessChannel(again, "web"));
    expect(webAgain.metadata?.slug).toBe(web.metadata!.slug);
    const slackAgain = await channels.create(namelessChannel(again, "slack"));
    expect(slackAgain.metadata?.slug).toBe(slack.metadata!.slug);
  });

  it("a teardown that throws fails the agent's delete and keeps the agent and that channel; the retry heals", async () => {
    const agent = await createTestAgent(uniqueName("Teardown Failure Agent"));
    const slack = await channels.create(namelessChannel(agent, "slack"));

    failTeardown = true;
    const err = await grpcError(() =>
      agents.delete({ value: agent.metadata!.id }),
    );
    expect(err.code).toBe(Code.Internal);
    expect(tornDown.map((c) => c.metadata?.id)).toEqual([slack.metadata!.id]);

    const kept = await agentQuery.get({ value: agent.metadata!.id });
    expect(kept.metadata?.id).toBe(agent.metadata!.id);
    const keptChannel = await channelQuery.get({ value: slack.metadata!.id });
    expect(keptChannel.metadata?.id).toBe(slack.metadata!.id);

    failTeardown = false;
    await agents.delete({ value: agent.metadata!.id });
    expect(await channelGone(slack.metadata!.id)).toBe(true);
    const gone = await grpcError(() =>
      agentQuery.get({ value: agent.metadata!.id }),
    );
    expect(gone.code).toBe(Code.NotFound);
  });

  it("leaves a channel of another organization that names the agent", async () => {
    const agent = await createTestAgent(uniqueName("Cross Org Cascade Agent"));
    // A row no create admits any more (a channel's agent lives in the
    // channel's organization), written straight to the store.
    const foreignId = "chn_cascade_foreign";
    await namingSaves(server.store).saveResource(
      ApiResourceKind.channel,
      foreignId,
      ChannelSchema,
      create(ChannelSchema, {
        apiVersion: API_VERSION,
        kind: "Channel",
        metadata: {
          id: foreignId,
          name: "cascade-foreign",
          slug: "cascade-foreign",
          org: OTHER_ORG_ID,
        },
        spec: {
          agentRef: {
            kind: ApiResourceKind.agent,
            org: ORG_ID,
            id: agent.metadata!.id,
          },
          enabled: true,
          type: { case: "slack", value: {} },
        },
      }),
    );

    await agents.delete({ value: agent.metadata!.id });

    expect(tornDown).toEqual([]);
    const left = await server.store.getResource(
      ApiResourceKind.channel,
      foreignId,
      ChannelSchema,
    );
    expect(left.metadata?.org).toBe(OTHER_ORG_ID);
  });
});

describe("a channel created while its agent is deleted (EnsureChannelAgentStillExists)", () => {
  it("removes itself, row and name, and the create answers NOT_FOUND naming the agent", async () => {
    const agent = await createTestAgent(uniqueName("Raced Agent"));

    // The agent's delete lands after the create resolved the agent and
    // claimed the channel's name, but before the channel's row is stored:
    // the delete lists the agent's channels and finds none.
    const store = server.store;
    const saveResource = store.saveResource.bind(store);
    let armed = true;
    let racedId = "";
    const spy = vi.spyOn(store, "saveResource").mockImplementation((async <
      Desc extends DescMessage,
    >(
      kind: ApiResourceKind,
      id: string,
      schema: Desc,
      resource: MessageShape<Desc>,
    ) => {
      if (armed && kind === ApiResourceKind.channel) {
        armed = false;
        racedId = id;
        await agents.delete({ value: agent.metadata!.id });
      }
      return saveResource(kind, id, schema, resource);
    }) as typeof store.saveResource);
    let err: ConnectError;
    try {
      err = await grpcError(() =>
        channels.create(namelessChannel(agent, "slack")),
      );
    } finally {
      spy.mockRestore();
    }

    expect(armed).toBe(false);
    expect(err.code).toBe(Code.NotFound);
    // The resolved reference holds the agent's id, which the refusal names.
    expect(err.rawMessage).toBe(`Agent not found: ${agent.metadata!.id}`);
    expect(racedId).not.toBe("");
    expect(await channelGone(racedId)).toBe(true);
    expect(
      await resolveName(
        server.store,
        ApiResourceKind.channel,
        ORG_ID,
        `${agent.metadata!.slug}-slack`,
      ),
    ).toBeUndefined();
    // A new channel has no runtime state: nothing was torn down.
    expect(tornDown).toEqual([]);
  });
});

describe("the cascade step on its own", () => {
  /** An agent delete's context, holding `agent` as the loaded resource when given. */
  function agentDeleteContext(agent?: Agent): RequestContext<typeof AgentSchema> {
    const ctx = new RequestContext(AgentSchema, create(AgentSchema), testCallerIdentity(), ApiResourceKind.agent);
    if (agent !== undefined) {
      ctx.set(EXISTING_RESOURCE_KEY, agent);
    }
    return ctx;
  }

  function cascadeStep(store: Store) {
    return newCascadeDeleteChannelsStep<typeof AgentSchema>({
      store,
      logger: silentLogger,
      authorizationLifecycle: undefined,
      channelRuntime: undefined,
    });
  }

  it("a chain that never loaded the agent is a broken invariant and throws", async () => {
    await expect(cascadeStep(untouchable<Store>("store")).execute(agentDeleteContext())).rejects.toThrow(
      "agent not found in context (LoadExistingForDelete must run first)",
    );
  });

  it("an agent with no id reads nothing and deletes nothing", async () => {
    const agent = create(AgentSchema, { metadata: { org: "org_acme", slug: "helper" } });
    await cascadeStep(untouchable<Store>("store")).execute(agentDeleteContext(agent));
  });

  it("the shared read skips a row that does not decode, logging it, and keeps the rows that do", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "warn", pretty: false, write: (line) => lines.push(line) });
    const kept = create(ChannelSchema, {
      metadata: { id: "chn_kept", org: "org_acme" },
      spec: { agentRef: { org: "org_acme", id: "agt_helper" }, type: { case: "slack", value: {} } },
    });
    const store = {
      queryResources: () =>
        Promise.resolve([
          { id: "chn_undecodable", data: new Uint8Array([0x22, 0xff]) },
          { id: "chn_kept", data: toBinary(ChannelSchema, kept) },
        ]),
    } as unknown as Store;

    const channels = await listChannelsOfAgent(store, logger, "agt_helper");

    expect(channels.map((channel) => channel.metadata?.id)).toEqual(["chn_kept"]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("skipped a channel row that does not decode");
    expect(lines[0]).toContain("chn_undecodable");
  });
});
