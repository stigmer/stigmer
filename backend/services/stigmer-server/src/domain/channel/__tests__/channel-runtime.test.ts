/**
 * Pins the ChannelRuntime driver seam's SERVING posture (channel-runtime.ts)
 * — the complement of channel.test.ts, which pins the
 * storing posture this seam must leave byte-identical. Same real stack:
 * a composed server on an ephemeral port with ONE extension unit carrying
 * a recording fake runtime, native gRPC clients, the full interceptor
 * chain.
 *
 * What this file proves, arm by arm:
 *   - every delegated RPC reaches the driver with its input and the
 *     caller identity, and the driver's reply rides back on the wire
 *     (delegation, not tail-end refusal-then-driver);
 *   - the OSS-owned prefixes survive composition: the install lane's
 *     load-then-X NOT_FOUND and Layer-1 proto validation both fire
 *     BEFORE the driver (the driver records zero calls on those paths);
 *   - enforceWriteConstraints runs at create/apply/update AFTER the
 *     edition-neutral rules, sees the RESOLVED channel, and its refusal
 *     is the request's refusal;
 *   - teardownOnDelete runs between the load and the row delete: a
 *     throwing teardown fails the delete AND leaves the row (idempotent
 *     retry heals); the teardown step run by a chain that never loaded
 *     the channel throws as a broken invariant, asking the driver nothing;
 *   - the runtime is a Slack or WhatsApp channel's: a web channel's
 *     create, update and delete never reach enforceWriteConstraints or
 *     teardownOnDelete, and its install RPCs refuse with
 *     INSTALL_NOT_APPLICABLE_MESSAGE before the driver is asked.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { create } from "@bufbuild/protobuf";
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
import type { Agent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/api_pb";
import { ChannelSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import type { Channel } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/api_pb";
import { ChannelCommandController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/command_pb";
import { ChannelQueryController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/query_pb";
import { ChannelMessageCommandController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/message_command_pb";
import { ChannelMessageQueryController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/message_query_pb";
import { ChannelConversationCommandController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/conversation_command_pb";
import { ChannelConversationQueryController } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/conversation_query_pb";
import {
  ChannelConversationCountSchema,
  ChannelConversationListSchema,
  ChannelConversationSchema,
  ConversationMediaDownloadUrlSchema,
  ConversationTimelineSchema,
} from "@stigmer/protos/ai/stigmer/agentic/channel/v1/conversation_io_pb";
import { InitiateChannelInstallOutputSchema } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/io_pb";
import {
  ChannelTemplatesSchema,
  MessagingChannelsSchema,
  SendChannelMessageOutputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/channel/v1/message_io_pb";
import { ChannelAudience } from "@stigmer/protos/ai/stigmer/agentic/channel/v1/spec_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { loadConfig } from "../../../boot/config.js";
import { composeServer } from "../../../boot/compose.js";
import type { ComposedServer } from "../../../boot/compose.js";
import { createLogger } from "../../../boot/logger.js";
import { invalidArgumentError } from "../../../pipeline/errors.js";
import type { CallerIdentity } from "../../../extensions/identity.js";
import type { ChannelRuntime } from "../channel-runtime.js";
import { newTeardownChannelRuntimeStep } from "../steps.js";
import { testCallerIdentity, untouchable } from "../../../pipeline/__tests__/support.js";
import { RequestContext } from "../../../pipeline/request-context.js";
import { INSTALL_NOT_APPLICABLE_MESSAGE } from "../constants.js";
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
// Requests name the organization by slug; the serving chain resolves it
// to the minted id before anything else sees the request, so the driver
// receives the id.
const ORG = "channel-runtime-test-org";
let ORG_ID: string;

/** The refusal the fake's write-constraint arm throws when armed. */
const FAKE_PIN_REQUIRED_MESSAGE =
  "spec.run_config.model_name must name a pinned model when the run would use the Cursor harness";
const FAKE_TEARDOWN_FAILURE_MESSAGE =
  "fake teardown failure — cascade unavailable";

/** One recorded driver invocation: the arm name and what it saw. */
interface RecordedCall {
  readonly arm: string;
  readonly caller: CallerIdentity;
  readonly channelId?: string;
  readonly inputMarker?: string;
}

const calls: RecordedCall[] = [];
let refuseWrites = false;
let failTeardown = false;

/**
 * The recording fake: every arm logs what it saw and answers a schema-
 * empty (or sentinel) reply. The two hooks are switchable so the refusal
 * arms are provable through the same composed server.
 */
const fakeRuntime: ChannelRuntime = {
  installs: {
    initiateInstall: (channel, input, caller) => {
      calls.push({
        arm: "initiateInstall",
        caller,
        channelId: channel.metadata?.id,
        inputMarker: input.resourceId,
      });
      return Promise.resolve(
        create(InitiateChannelInstallOutputSchema, {
          authorizationUrl: "https://consent.invalid/fake",
          state: "fake-state-token",
        }),
      );
    },
    completeInstall: (channel, input, caller) => {
      calls.push({
        arm: "completeInstall",
        caller,
        channelId: channel.metadata?.id,
        inputMarker: input.state,
      });
      return Promise.resolve(channel);
    },
  },
  messaging: {
    sendMessage: (input, caller) => {
      calls.push({ arm: "sendMessage", caller, inputMarker: input.recipient });
      return Promise.resolve(create(SendChannelMessageOutputSchema));
    },
    listTemplates: (input, caller) => {
      calls.push({ arm: "listTemplates", caller, inputMarker: input.channel });
      return Promise.resolve(create(ChannelTemplatesSchema));
    },
    listMessagingChannels: (_input, caller) => {
      calls.push({ arm: "listMessagingChannels", caller });
      return Promise.resolve(create(MessagingChannelsSchema));
    },
  },
  conversations: {
    list: (input, caller) => {
      calls.push({ arm: "list", caller, inputMarker: input.org });
      return Promise.resolve(
        create(ChannelConversationListSchema, { nextPageToken: "sentinel-42" }),
      );
    },
    countConversations: (input, caller) => {
      calls.push({ arm: "countConversations", caller, inputMarker: input.org });
      return Promise.resolve(
        create(ChannelConversationCountSchema, { count: 42 }),
      );
    },
    getConversation: (input, caller) => {
      calls.push({
        arm: "getConversation",
        caller,
        inputMarker: input.conversationKey,
      });
      return Promise.resolve(create(ChannelConversationSchema));
    },
    listTimeline: (input, caller) => {
      calls.push({
        arm: "listTimeline",
        caller,
        inputMarker: input.conversationKey,
      });
      return Promise.resolve(create(ConversationTimelineSchema));
    },
    getMediaDownloadUrl: (input, caller) => {
      calls.push({
        arm: "getMediaDownloadUrl",
        caller,
        inputMarker: input.itemId,
      });
      return Promise.resolve(create(ConversationMediaDownloadUrlSchema));
    },
    reply: (input, caller) => {
      calls.push({ arm: "reply", caller, inputMarker: input.conversationKey });
      return Promise.resolve(create(SendChannelMessageOutputSchema));
    },
    takeOver: (input, caller) => {
      calls.push({
        arm: "takeOver",
        caller,
        inputMarker: input.conversationKey,
      });
      return Promise.resolve(create(ChannelConversationSchema));
    },
    handBack: (input, caller) => {
      calls.push({
        arm: "handBack",
        caller,
        inputMarker: input.conversationKey,
      });
      return Promise.resolve(create(ChannelConversationSchema));
    },
    clearAttention: (input, caller) => {
      calls.push({
        arm: "clearAttention",
        caller,
        inputMarker: input.conversationKey,
      });
      return Promise.resolve(create(ChannelConversationSchema));
    },
    escalate: (input, caller) => {
      calls.push({ arm: "escalate", caller, inputMarker: input.reason });
      return Promise.resolve(create(ChannelConversationSchema));
    },
  },
  enforceWriteConstraints: (channel) => {
    calls.push({
      arm: "enforceWriteConstraints",
      // The hook deliberately carries no caller (it is a spec rule, not an
      // authorization decision) — a placeholder keeps the record uniform.
      caller: {
        identityId: "",
        callerClass: "internal",
        issuer: "",
        rawToken: "",
      },
      channelId: channel.metadata?.id,
      inputMarker: channel.spec?.agentRef?.org,
    });
    if (refuseWrites) {
      return Promise.reject(invalidArgumentError(FAKE_PIN_REQUIRED_MESSAGE));
    }
    return Promise.resolve();
  },
  teardownOnDelete: (channel, caller) => {
    calls.push({
      arm: "teardownOnDelete",
      caller,
      channelId: channel.metadata?.id,
    });
    if (failTeardown) {
      return Promise.reject(new Error(FAKE_TEARDOWN_FAILURE_MESSAGE));
    }
    return Promise.resolve();
  },
};

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
  dir = mkdtempSync(path.join(tmpdir(), "channel-runtime-test-"));
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
  ORG_ID = organizationId(await seedOrganizations(transport, [ORG]), ORG);
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
});

afterAll(async () => {
  await server.shutdown();
  rmSync(dir, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

beforeEach(() => {
  calls.length = 0;
  refuseWrites = false;
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
      description: "Agent for channel-runtime seam tests",
      instructions: "You are a helpful agent for seam verification.",
    },
  });
}

async function createTestChannel(agentSlug: string): Promise<Channel> {
  return channels.create({
    apiVersion: API_VERSION,
    kind: "Channel",
    metadata: { name: uniqueName("runtime channel"), org: ORG },
    spec: {
      agentRef: { kind: ApiResourceKind.agent, slug: agentSlug },
      type: { case: "slack", value: {} },
    },
  });
}

/** A web channel (a chat link): it has no provider runtime. */
async function createTestWebChannel(agentSlug: string): Promise<Channel> {
  return channels.create({
    apiVersion: API_VERSION,
    kind: "Channel",
    metadata: { name: uniqueName("runtime web channel"), org: ORG },
    spec: {
      agentRef: { kind: ApiResourceKind.agent, slug: agentSlug },
      enabled: true,
      type: { case: "web", value: { audience: ChannelAudience.public } },
    },
  });
}

function lastCall(arm: string): RecordedCall {
  const found = calls.filter((c) => c.arm === arm).at(-1);
  expect(found, `driver arm '${arm}' was invoked`).toBeDefined();
  return found!;
}

async function expectCode(
  fn: () => Promise<unknown>,
  code: Code,
): Promise<ConnectError> {
  try {
    await fn();
  } catch (error) {
    const connectErr = ConnectError.from(error);
    expect(connectErr.code).toBe(code);
    return connectErr;
  }
  throw new Error("expected the call to fail, but it succeeded");
}

describe("install arms — per-arm delegation behind the OSS load contract", () => {
  it("initiateInstall delegates with the LOADED channel and returns the driver's output", async () => {
    const agent = await createTestAgent(uniqueName("install agent"));
    const channel = await createTestChannel(agent.metadata!.slug);

    const out = await channels.initiateInstall({
      resourceId: channel.metadata!.id,
    });
    expect(out.authorizationUrl).toBe("https://consent.invalid/fake");
    expect(out.state).toBe("fake-state-token");

    const call = lastCall("initiateInstall");
    expect(call.channelId).toBe(channel.metadata!.id);
    expect(call.inputMarker).toBe(channel.metadata!.id);
    expect(call.caller.identityId).not.toBe("");
  });

  it("completeInstall delegates the same way", async () => {
    const agent = await createTestAgent(uniqueName("complete agent"));
    const channel = await createTestChannel(agent.metadata!.slug);

    await channels.completeInstall({
      resourceId: channel.metadata!.id,
      state: "state-token-1",
      code: "oauth-code-1",
    });
    const call = lastCall("completeInstall");
    expect(call.channelId).toBe(channel.metadata!.id);
    expect(call.inputMarker).toBe("state-token-1");
  });

  it("keeps the OSS NOT_FOUND load contract — the driver never sees a missing id", async () => {
    const err = await expectCode(
      () => channels.initiateInstall({ resourceId: "chn_01runtimemissing" }),
      Code.NotFound,
    );
    expect(err.rawMessage).toBe("Channel not found: chn_01runtimemissing");
    expect(calls.filter((c) => c.arm === "initiateInstall")).toHaveLength(0);
  });

  it("a web channel's install RPCs refuse as not applicable — the driver never sees them", async () => {
    const agent = await createTestAgent(uniqueName("web install agent"));
    const web = await createTestWebChannel(agent.metadata!.slug);
    calls.length = 0;

    const initiate = await expectCode(
      () => channels.initiateInstall({ resourceId: web.metadata!.id }),
      Code.FailedPrecondition,
    );
    expect(initiate.rawMessage).toBe(INSTALL_NOT_APPLICABLE_MESSAGE);
    const complete = await expectCode(
      () =>
        channels.completeInstall({
          resourceId: web.metadata!.id,
          state: "state-token-web",
          code: "oauth-code-web",
        }),
      Code.FailedPrecondition,
    );
    expect(complete.rawMessage).toBe(INSTALL_NOT_APPLICABLE_MESSAGE);
    expect(calls).toHaveLength(0);
  });
});

describe("messaging surface — whole-method delegation", () => {
  it("delegates all three methods with input and caller threaded", async () => {
    await messageCommand.sendMessage({
      channel: "chan-1",
      recipient: "15551234567",
      payload: { kind: { case: "text", value: { body: "hello" } } },
    });
    expect(lastCall("sendMessage").inputMarker).toBe("15551234567");

    await messageQuery.listTemplates({ channel: "chan-1" });
    expect(lastCall("listTemplates").inputMarker).toBe("chan-1");

    await messageQuery.listMessagingChannels({});
    expect(lastCall("listMessagingChannels").caller.identityId).not.toBe("");
  });

  it("Layer-1 validation still precedes delegation (driver sees nothing)", async () => {
    await expectCode(
      () => messageCommand.sendMessage({ channel: "c", recipient: "" }),
      Code.InvalidArgument,
    );
    expect(calls).toHaveLength(0);
  });
});

describe("conversation surface — whole-method delegation", () => {
  it("delegates every query, sentinel replies riding back", async () => {
    const list = await conversationQuery.list({ org: ORG });
    expect(list.nextPageToken).toBe("sentinel-42");
    expect(lastCall("list").inputMarker).toBe(ORG_ID);

    const counted = await conversationQuery.countConversations({ org: ORG });
    expect(counted.count).toBe(42);
    expect(lastCall("countConversations").inputMarker).toBe(ORG_ID);

    await conversationQuery.getConversation({
      channelId: "chn_x",
      conversationKey: "conv-1",
    });
    expect(lastCall("getConversation").inputMarker).toBe("conv-1");

    await conversationQuery.listTimeline({
      channelId: "chn_x",
      conversationKey: "conv-2",
    });
    expect(lastCall("listTimeline").inputMarker).toBe("conv-2");

    await conversationQuery.getMediaDownloadUrl({
      channelId: "chn_x",
      conversationKey: "conv-3",
      itemId: "item-9",
    });
    expect(lastCall("getMediaDownloadUrl").inputMarker).toBe("item-9");
  });

  it("delegates every command", async () => {
    const control = { channelId: "chn_x", conversationKey: "conv-cmd" };
    await conversationCommand.reply({
      ...control,
      payload: { kind: { case: "text", value: { body: "hi" } } },
    });
    expect(lastCall("reply").inputMarker).toBe("conv-cmd");

    await conversationCommand.takeOver(control);
    expect(lastCall("takeOver").inputMarker).toBe("conv-cmd");

    await conversationCommand.handBack(control);
    expect(lastCall("handBack").inputMarker).toBe("conv-cmd");

    await conversationCommand.clearAttention(control);
    expect(lastCall("clearAttention").inputMarker).toBe("conv-cmd");

    await conversationCommand.escalate({ reason: "needs a human" });
    expect(lastCall("escalate").inputMarker).toBe("needs a human");
  });
});

describe("enforceWriteConstraints — the edition-split CRUD hook", () => {
  it("runs on create with the RESOLVED channel (agent_ref.org normalized)", async () => {
    const agent = await createTestAgent(uniqueName("constraint agent"));
    await createTestChannel(agent.metadata!.slug);

    const call = lastCall("enforceWriteConstraints");
    // The request left agent_ref.org empty; the hook saw it resolved —
    // proof it runs AFTER the edition-neutral resolution.
    expect(call.inputMarker).toBe(ORG_ID);
  });

  it("runs on update", async () => {
    const agent = await createTestAgent(uniqueName("update agent"));
    const channel = await createTestChannel(agent.metadata!.slug);
    calls.length = 0;

    await channels.update({ resource: channel, updateMask: { paths: ["*"] } });
    expect(lastCall("enforceWriteConstraints").channelId).toBe(
      channel.metadata!.id,
    );
  });

  it("a refusing constraint refuses the create with the driver's code and copy", async () => {
    const agent = await createTestAgent(uniqueName("refusal agent"));
    refuseWrites = true;

    const err = await expectCode(
      () =>
        channels.create({
          apiVersion: API_VERSION,
          kind: "Channel",
          metadata: { name: uniqueName("refused channel"), org: ORG },
          spec: {
            agentRef: {
              kind: ApiResourceKind.agent,
              slug: agent.metadata!.slug,
            },
            type: { case: "slack", value: {} },
          },
        }),
      Code.InvalidArgument,
    );
    expect(err.rawMessage).toBe(FAKE_PIN_REQUIRED_MESSAGE);
  });

  it("is never asked for a web channel, on create or on update", async () => {
    const agent = await createTestAgent(uniqueName("web constraint agent"));
    // Armed: were the hook asked, the create would be refused.
    refuseWrites = true;
    const web = await createTestWebChannel(agent.metadata!.slug);
    web.spec!.enabled = false;
    const updated = await channels.update({ resource: web, updateMask: { paths: ["*"] } });
    expect(updated.spec?.enabled).toBe(false);
    expect(calls.filter((c) => c.arm === "enforceWriteConstraints")).toHaveLength(0);
  });
});

describe("teardownOnDelete — the delete-chain cascade hook", () => {
  it("a failing teardown fails the delete AND the row survives for retry", async () => {
    const agent = await createTestAgent(uniqueName("teardown agent"));
    const channel = await createTestChannel(agent.metadata!.slug);

    failTeardown = true;
    await expectCode(
      () => channels.delete({ value: channel.metadata!.id }),
      Code.Internal,
    );
    expect(lastCall("teardownOnDelete").channelId).toBe(channel.metadata!.id);

    // The row outlived the failed cascade — the teardown-before-row order.
    const still = await query.get({ value: channel.metadata!.id });
    expect(still.metadata?.id).toBe(channel.metadata!.id);

    // The idempotent retry heals once the cascade succeeds.
    failTeardown = false;
    await channels.delete({ value: channel.metadata!.id });
    await expectCode(
      () => query.get({ value: channel.metadata!.id }),
      Code.NotFound,
    );
  });

  it("delegates with the loaded channel and the caller identity", async () => {
    const agent = await createTestAgent(uniqueName("delete agent"));
    const channel = await createTestChannel(agent.metadata!.slug);
    calls.length = 0;

    await channels.delete({ value: channel.metadata!.id });
    const call = lastCall("teardownOnDelete");
    expect(call.channelId).toBe(channel.metadata!.id);
    expect(call.caller.identityId).not.toBe("");
  });

  it("the teardown step run by a chain that never loaded the channel is a broken invariant and throws, asking the driver nothing", async () => {
    const step = newTeardownChannelRuntimeStep<typeof ChannelSchema>(untouchable<ChannelRuntime>("channelRuntime"));
    const ctx = new RequestContext(ChannelSchema, create(ChannelSchema), testCallerIdentity(), ApiResourceKind.channel);
    await expect(step.execute(ctx)).rejects.toThrow("existing channel not found in context");
  });

  it("is never asked for a web channel — its delete goes through untouched", async () => {
    const agent = await createTestAgent(uniqueName("web delete agent"));
    const web = await createTestWebChannel(agent.metadata!.slug);
    // Armed: were the hook asked, the delete would fail.
    failTeardown = true;
    calls.length = 0;

    await channels.delete({ value: web.metadata!.id });
    expect(calls.filter((c) => c.arm === "teardownOnDelete")).toHaveLength(0);
    await expectCode(() => query.get({ value: web.metadata!.id }), Code.NotFound);
  });
});
