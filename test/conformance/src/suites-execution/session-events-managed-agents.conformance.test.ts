// Conformance suite for the Claude Managed Agents wire on real turns:
// Anthropic's own SDK (`@anthropic-ai/sdk`, the exact pin the claim names)
// lists, streams and answers a Stigmer session at managed-agents-2026-04-01.
// Domain: agentic / session — the session's event log, read and answered by
// a standard Managed Agents client.
//
// Each arm's session is created natively with its agent, then driven ONLY
// through the SDK (`client.beta.sessions.events.list`, `.stream`, `.send`),
// against the server's unified port (TargetProfile.managedAgentsBaseUrl),
// with a key the arm mints. Every value read is typed by the SDK's own
// types, and every event the lane served must deep-equal the Stigmer harness's log's
// event rendered as Managed Agents JSON (support/managed-agents.ts):
//
//   - a user.message sent the moment the stream opened starts a turn; the
//     send answers with the logged user.message, and the stream yields the
//     turn's events in log order (with agent.message previews, when the
//     runner sent any, naming that message) to end_turn;
//   - the SDK's pager walks the whole log; desc, a type filter and a
//     created_at bound select what the native read selects;
//   - a tool that waits for a person shows as agent.mcp_tool_use with
//     evaluated_permission ask and an idle requires_action naming it,
//     answerable by a client that knows no Stigmer event (the Stigmer harness's log's
//     stigmer.permission.asked never reaches it); allow runs the call to
//     end_turn, deny (with its message) ends the turn without it;
//   - user.interrupt stops a held turn, which ends idle;
//   - an image block naming a File by id, as the SDK sends one: the
//     conversation lists its own copy of the File, the logged
//     user.message carries the block naming that copy, and the model's
//     request carries the image;
//   - an agent that edits files reaches end_turn with the file written and
//     no Stigmer event on the lane, and with file review on reaches it just
//     the same, nothing to answer and the edit kept, while the Stigmer harness's log
//     does carry its stigmer.file_review events: the lane drops them.
//
// Out of scope here: the refusals (bad key, outsider, unserved events and
// versions) are Class A, suites/session-events-managed-agents.conformance
// .test.ts. Managed Agents' session resource (create, retrieve, list,
// delete) is not served; nor are user.tool_result, custom tools, outcomes,
// system.message, or image and document blocks whose source is not a File.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type Anthropic from "@anthropic-ai/sdk";
import type {
  BetaManagedAgentsSendSessionEvents,
  BetaManagedAgentsSessionEvent,
  BetaManagedAgentsStreamSessionEvents,
} from "@anthropic-ai/sdk/resources/beta/sessions/events";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUse } from "@stigmer/test-support/mock-llm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { ConformanceClients } from "../harness/clients";
import { FixtureTracker } from "../harness/fixtures";
import { GitWorkspace } from "../harness/git-workspace";
import { DESTRUCTIVE_ECHO_TOOL_NAME, type McpToolFixture } from "../harness/mcp-server";
import { agentRefOf, makeAgent } from "../support/agents";
import { awaitIdleWith, awaitRequiresAction, confirmPerContract } from "../support/answers";
import {
  collectUntil,
  isIdleWith,
  listAll,
  managedAgentsClient,
  stigmerAsManagedAgents,
  storedOf,
} from "../support/managed-agents";
import { uniqueName } from "../support/naming";
import { awaitPhase, awaitTerminal, pushFixturePlugin, requireLlmProxy, requireMcpFixture } from "../support/runs";
import { makeSession, type SessionSpecOptions } from "../support/sessions";
import { createTarget, type TargetProfile } from "../targets";
import { modelToolName } from "../support/plugins";

let target: TargetProfile;
let clients: ConformanceClients;
let mock: MockLlmProxy;
let mcp: McpToolFixture;
const fixtures = new FixtureTracker();

/** How long a held turn stays IN_PROGRESS unless released. */
const HOLD_MS = 120_000;

beforeAll(async () => {
  target = createTarget();
  await target.setup();
  clients = target.clients();
  mock = requireLlmProxy(target);
  mcp = requireMcpFixture(target);
});

afterEach(async () => {
  mock.releaseHolds();
  const claimDeadline = Date.now() + 15_000;
  while (mock.remaining() > 0 && Date.now() < claimDeadline) {
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }
  await fixtures.cleanup();
  mock.reset();
  mcp.resetCaptured();
});

afterAll(async () => {
  await target?.teardown();
});

/**
 * Anthropic's SDK for `org`, with a key minted there: the credential a
 * developer pastes. A server without sign-in serves its caller as the local
 * person whatever key it sends; one with sign-in verifies this key.
 */
async function sdkFor(org: string): Promise<Anthropic> {
  const key = await clients.apiKeyCommand.create({
    apiVersion: "iam.stigmer.ai/v1",
    kind: "ApiKey",
    metadata: { name: uniqueName("managed-agents-key"), org },
    spec: {},
  });
  const id = key.metadata?.id ?? "";
  fixtures.defer(() => clients.apiKeyCommand.delete({ value: id }).catch(() => undefined));
  return managedAgentsClient(target.managedAgentsBaseUrl(), { apiKey: key.spec?.keyHash ?? "" });
}

async function newSession(org: string, options: Omit<SessionSpecOptions, "agentRef"> & { plugins?: string[] } = {}): Promise<string> {
  const { plugins, ...spec } = options;
  const agent = await clients.agentCommand.create(
    makeAgent({ org, name: uniqueName("ma-agent"), ...(plugins === undefined ? {} : { plugins }) }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }).catch(() => undefined));
  const session = await clients.sessionCommand.create(
    makeSession({ org, name: uniqueName("ma-session"), agentRef: agentRefOf(agent), ...spec }),
  );
  const id = session.metadata!.id;
  fixtures.defer(() => clients.sessionCommand.delete({ value: id }).catch(() => undefined));
  return id;
}

/** A user.message's send parameters. */
function message(text: string): { type: "user.message"; content: Array<{ type: "text"; text: string }> } {
  return { type: "user.message", content: [{ type: "text", text }] };
}

/** A valid one-pixel PNG: the runner reads an image's header before it shows it to the model. */
const ONE_PIXEL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

/** Whether a captured request is a Messages call (it carries messages). */
function isChatRequest(body: unknown): boolean {
  return typeof body === "object" && body !== null && Array.isArray((body as { messages?: unknown }).messages);
}

/** The content blocks of a Messages request's last user message. */
function lastUserContent(body: unknown): Array<Record<string, unknown>> {
  const messages = isChatRequest(body) ? (body as { messages: Array<{ role?: string; content?: unknown }> }).messages : [];
  const last = [...messages].reverse().find((message) => message.role === "user");
  return Array.isArray(last?.content) ? (last.content as Array<Record<string, unknown>>) : [];
}

/** An image block's inline bytes, whichever of the two Anthropic shapes carries them. */
function sourceData(block: Record<string, unknown>): string {
  const source = block["source"] as { data?: unknown } | undefined;
  return typeof source?.data === "string" ? source.data : "";
}

/** The run the newest user.message started, from the Stigmer harness's log (the SDK's events carry no run). */
async function newestRunId(sessionId: string): Promise<string> {
  const { events } = await clients.sessionQuery.listEvents({ sessionId, order: "desc", types: ["user.message"], pageSize: 1 });
  const runId = events[0]?.runId ?? "";
  expect(runId, "the sent message started a turn").not.toBe("");
  return runId;
}

describe("Anthropic's SDK on a Stigmer session (the Managed Agents lane)", () => {
  it("a message sent the moment the stream opens starts a turn; the stream yields its events in log order to end_turn", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    const sdk = await sdkFor(org);
    mock.enqueue(anthropicText("Hello from the agent."));

    const stream = await sdk.beta.sessions.events.stream(sessionId, { event_deltas: ["agent.message"] });
    const reading = collectUntil(stream, (seen) => seen.some((event) => isIdleWith(event, "end_turn")));
    const sent: BetaManagedAgentsSendSessionEvents = await sdk.beta.sessions.events.send(sessionId, {
      events: [message("hello")],
    });
    const seen: BetaManagedAgentsStreamSessionEvents[] = await reading;

    const native = await stigmerAsManagedAgents(clients, sessionId);
    expect(native.map((event) => event["type"])).toEqual([
      "user.message",
      "session.status_running",
      "agent.message",
      "session.status_idle",
    ]);
    expect(sent.data, "the send answers with the logged user.message").toEqual([native[0]]);
    expect(storedOf(seen), "the stream is the log, in order").toEqual(native);
    const answerId = String(native[2]?.["id"]);
    for (const preview of seen) {
      if (preview.type === "event_start") {
        expect([preview.event.type, preview.event.id]).toEqual(["agent.message", answerId]);
      } else if (preview.type === "event_delta") {
        expect(preview.event_id).toBe(answerId);
      }
    }
  });

  it("the SDK's pager walks the whole log; desc, a type filter and a created_at bound select what the native read selects", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    const sdk = await sdkFor(org);
    for (const text of ["first", "second"]) {
      mock.enqueue(anthropicText(`Answer to ${text}.`));
      await sdk.beta.sessions.events.send(sessionId, { events: [message(text)] });
      await awaitIdleWith(clients, sessionId, "end_turn");
    }
    const native = await stigmerAsManagedAgents(clients, sessionId);
    expect(native.length, "two turns of four events").toBe(8);

    const firstPage = await sdk.beta.sessions.events.list(sessionId, { limit: 3 });
    expect(firstPage.data).toHaveLength(3);
    expect(firstPage.hasNextPage()).toBe(true);
    const paged: BetaManagedAgentsSessionEvent[] = await listAll(sdk, sessionId, { limit: 3 });
    expect(paged).toEqual(native);

    expect(await listAll(sdk, sessionId, { order: "desc" })).toEqual([...native].reverse());
    const messages = await listAll(sdk, sessionId, { types: ["user.message"] });
    expect(messages.map((event) => event.type === "user.message" && event.content)).toEqual([
      [{ type: "text", text: "first" }],
      [{ type: "text", text: "second" }],
    ]);

    const secondAt = String(messages[1]?.processed_at ?? "");
    const bounded = await listAll(sdk, sessionId, { "created_at[gte]": secondAt });
    const { events: stigmerBounded } = await clients.sessionQuery.listEvents({
      sessionId,
      createdAtGte: secondAt,
      types: native.map((event) => String(event["type"])).filter((type, i, all) => all.indexOf(type) === i),
      pageSize: 1000,
    });
    expect(bounded.map((event) => event.id)).toEqual(stigmerBounded.map((event) => (event.event.case === undefined ? "" : event.event.value.id)));
    expect(bounded[0]?.type, "the bound starts at the second turn").toBe("user.message");
  });

  it("a tool that waits shows as an ask and requires_action, answered with no Stigmer event: allow runs it, deny ends the turn without it", async () => {
    const { org } = await target.provisionTenancy();
    const plugin = await pushFixturePlugin(clients, mcp, fixtures, { org, name: uniqueName("ma-gated"), tools: [DESTRUCTIVE_ECHO_TOOL_NAME] });
    const sessionId = await newSession(org, { plugins: [plugin.metadata!.slug] });
    const sdk = await sdkFor(org);

    // Allow.
    mock.enqueue(anthropicToolUse("toolu_ma_allow", modelToolName(plugin, DESTRUCTIVE_ECHO_TOOL_NAME), { text: "hello" }));
    mock.enqueue(anthropicText("Echoed."));
    const stream = await sdk.beta.sessions.events.stream(sessionId);
    const reading = collectUntil(stream, (seen) => {
      const asked = seen.findIndex((event) => isIdleWith(event, "requires_action"));
      return asked !== -1 && seen.slice(asked + 1).some((event) => isIdleWith(event, "end_turn"));
    });
    await sdk.beta.sessions.events.send(sessionId, { events: [message("echo it")] });
    const [toolUseId] = await awaitRequiresAction(clients, sessionId, 1);
    const runId = await newestRunId(sessionId);
    await confirmPerContract({
      clients,
      sessionId,
      runId,
      answer: () =>
        sdk.beta.sessions.events.send(sessionId, {
          events: [{ type: "user.tool_confirmation", tool_use_id: toolUseId!, result: "allow" }],
        }),
      expectedRemaining: 0,
      label: "the SDK's allow leaves nothing waiting",
    });
    const seen = await reading;
    const use = seen.find((event) => event.type === "agent.mcp_tool_use");
    expect(use?.type === "agent.mcp_tool_use" && [use.id, use.evaluated_permission]).toEqual([toolUseId, "ask"]);
    const waiting = seen.find((event) => isIdleWith(event, "requires_action"));
    expect(waiting?.type === "session.status_idle" && waiting.stop_reason.type === "requires_action" && waiting.stop_reason.event_ids).toEqual([
      toolUseId,
    ]);
    expect(seen.map((event) => event.type)).toEqual([
      "user.message",
      "session.status_running",
      "agent.mcp_tool_use",
      "session.status_idle",
      "user.tool_confirmation",
      "session.status_running",
      "agent.mcp_tool_result",
      "agent.message",
      "session.status_idle",
    ]);
    expect(storedOf(seen)).toEqual(await stigmerAsManagedAgents(clients, sessionId));
    const { events: stigmerLog } = await clients.sessionQuery.listEvents({ sessionId, runId, pageSize: 1000 });
    expect(stigmerLog.some((event) => event.event.case === "stigmerPermissionAsked"), "Stigmer's own record of the ask stays on its API").toBe(true);

    // Deny, with its message.
    mcp.resetCaptured();
    mock.enqueue(anthropicToolUse("toolu_ma_deny", modelToolName(plugin, DESTRUCTIVE_ECHO_TOOL_NAME), { text: "again" }));
    mock.enqueue(anthropicText("Understood, not echoing."));
    await sdk.beta.sessions.events.send(sessionId, { events: [message("echo again")] });
    const [deniedId] = await awaitRequiresAction(clients, sessionId, 1);
    const deniedRun = await newestRunId(sessionId);
    await confirmPerContract({
      clients,
      sessionId,
      runId: deniedRun,
      answer: () =>
        sdk.beta.sessions.events.send(sessionId, {
          events: [{ type: "user.tool_confirmation", tool_use_id: deniedId!, result: "deny", deny_message: "not today" }],
        }),
      expectedRemaining: 0,
      label: "the SDK's deny leaves nothing waiting",
    });
    await awaitIdleWith(clients, sessionId, "end_turn");
    const confirmations = await listAll(sdk, sessionId, { types: ["user.tool_confirmation"] });
    const denied = confirmations.find((event) => event.type === "user.tool_confirmation" && event.tool_use_id === deniedId);
    expect(denied?.type === "user.tool_confirmation" && [denied.result, denied.deny_message]).toEqual(["deny", "not today"]);
    expect(
      mcp.capturedRequests().filter((request) => request.method === "tools/call"),
      "a denied call never reaches the tool",
    ).toEqual([]);
  });

  it("user.interrupt stops a held turn, which ends idle", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    const sdk = await sdkFor(org);
    mock.enqueue(anthropicText("Held until interrupted."), { delayMs: HOLD_MS });
    await sdk.beta.sessions.events.send(sessionId, { events: [message("stop me")] });
    const runId = await newestRunId(sessionId);
    await awaitPhase(clients, runId, RunPhase.RUN_IN_PROGRESS);

    const stopped = await sdk.beta.sessions.events.send(sessionId, { events: [{ type: "user.interrupt" }] });
    const native = await stigmerAsManagedAgents(clients, sessionId);
    expect(stopped.data).toEqual(native.filter((event) => event["type"] === "user.interrupt"));
    expect((await awaitTerminal(clients, runId)).status?.phase).toBe(RunPhase.RUN_CANCELLED);
    await awaitIdleWith(clients, sessionId, "end_turn");
    const idle = (await sdk.beta.sessions.events.list(sessionId, { order: "desc", types: ["session.status_idle"], limit: 1 })).data[0];
    expect(idle?.type === "session.status_idle" && idle.stop_reason.type).toBe("end_turn");
  });

  it("an image block naming a File reaches the model, and the conversation lists its own copy", async () => {
    const { org } = await target.provisionTenancy();
    const sessionId = await newSession(org);
    const sdk = await sdkFor(org);
    const png = Buffer.from(ONE_PIXEL_PNG_BASE64, "base64");
    const original = await clients.fileCommand.upload({
      org,
      filename: "shot.png",
      mimeType: "image/png",
      source: { case: "data", value: new Uint8Array(png) },
    });
    const originalId = original.metadata!.id;
    fixtures.defer(() => clients.fileCommand.delete({ value: originalId }).catch(() => undefined));
    mock.enqueue(anthropicText("A single pixel."));

    const sent = await sdk.beta.sessions.events.send(sessionId, {
      events: [
        {
          type: "user.message",
          content: [
            { type: "text", text: "what is in this image?" },
            { type: "image", source: { type: "file", file_id: originalId } },
          ],
        },
      ],
    });
    await awaitIdleWith(clients, sessionId, "end_turn");

    const session = await clients.sessionQuery.get({ value: sessionId });
    const listed = (session.spec?.resources ?? []).flatMap((entry) =>
      entry.resource.case === "file" ? [entry.resource.value.fileId] : [],
    );
    expect(listed, "the conversation lists one File").toHaveLength(1);
    const copyId = listed[0]!;
    expect(copyId, "the conversation's File is its own copy").not.toBe(originalId);
    expect((await clients.fileQuery.get({ value: copyId })).status?.sessionId).toBe(sessionId);

    const logged = sent.data?.[0];
    expect(logged?.type).toBe("user.message");
    const blocks = logged?.type === "user.message" ? logged.content : [];
    expect(blocks.map((block) => block.type)).toEqual(["text", "image"]);
    const image = blocks[1];
    expect(image?.type === "image" && image.source.type === "file" ? image.source.file_id : "", "the block names the copy").toBe(
      copyId,
    );

    const chats = mock.requests().filter((request) => isChatRequest(request.body));
    const userTurn = lastUserContent(chats[chats.length - 1]?.body);
    expect(
      userTurn.some((block) => block["type"] === "image" && sourceData(block) === ONE_PIXEL_PNG_BASE64),
      "the model's request carries the image",
    ).toBe(true);
  });

  describe("an agent that edits files", () => {
    async function editTurn(fileReview: boolean): Promise<{
      workspace: GitWorkspace;
      sessionId: string;
      seen: BetaManagedAgentsStreamSessionEvents[];
      listed: BetaManagedAgentsSessionEvent[];
    }> {
      const { org } = await target.provisionTenancy();
      const workspace = await GitWorkspace.create();
      fixtures.defer(() => workspace.cleanup());
      const sessionId = await newSession(org, {
        harness: Harness.STIGMER,
        localWorkspaces: [{ name: "repo", path: workspace.dir }],
        fileReview,
      });
      const sdk = await sdkFor(org);
      mock.enqueue(anthropicToolUse("toolu_ma_write", "write_file", { file_path: "notes.txt", content: "one\ntwo\n" }));
      mock.enqueue(anthropicText("Wrote it."));
      const stream = await sdk.beta.sessions.events.stream(sessionId);
      const reading = collectUntil(stream, (seen) => seen.some((event) => event.type === "session.status_idle"));
      await sdk.beta.sessions.events.send(sessionId, { events: [message("write it")] });
      const seen = await reading;
      return { workspace, sessionId, seen, listed: await listAll(sdk, sessionId) };
    }

    it("reaches end_turn with the file written and no Stigmer event", async () => {
      const { workspace, seen, listed } = await editTurn(false);
      expect(seen.map((event) => event.type)).toEqual([
        "user.message",
        "session.status_running",
        "agent.tool_use",
        "agent.tool_result",
        "agent.message",
        "session.status_idle",
      ]);
      expect(isIdleWith(seen[seen.length - 1]!, "end_turn")).toBe(true);
      expect(await readFile(join(workspace.dir, "notes.txt"), "utf8")).toBe("one\ntwo\n");
      expect(listed.filter((event) => event.type.startsWith("stigmer."))).toEqual([]);
      expect(listed).toEqual(storedOf(seen));
    });

    it("with file review on, reaches end_turn just the same: nothing to answer, the edit kept, the review events left on Stigmer's API", async () => {
      const { workspace, sessionId, seen, listed } = await editTurn(true);
      expect(storedOf(seen).map((event) => event.type)).toEqual([
        "user.message",
        "session.status_running",
        "agent.tool_use",
        "agent.tool_result",
        "agent.message",
        "session.status_idle",
      ]);
      expect(isIdleWith(seen[seen.length - 1]!, "end_turn"), "review never holds the turn").toBe(true);
      expect(await readFile(join(workspace.dir, "notes.txt"), "utf8")).toBe("one\ntwo\n");
      expect(listed.filter((event) => event.type.startsWith("stigmer."))).toEqual([]);
      const { events: stigmerLog } = await clients.sessionQuery.listEvents({ sessionId, pageSize: 1000 });
      expect(
        stigmerLog.some((event) => event.event.case === "stigmerFileReviewChanges"),
        "the Stigmer harness's log carries the review's events, so the lane dropped them",
      ).toBe(true);
    });
  });
});
