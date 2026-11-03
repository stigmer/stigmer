// The docs' scripted server (../live-server.ts), driven as a reader's acts
// drive it, through a real client over its routes: a send gets the
// scripted turn, paced; an approval or a denial lets it go on to its end;
// Stop ends whatever works; a message sent while a turn works waits in the
// queue, starts its own turn after, and is dropped by a Stop.
import { createRouterTransport } from "@connectrpc/connect";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";
import { Stigmer, foldSession } from "@stigmer/client";
import { scenarios } from "@stigmer/react-sdk/test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveConversation, PACE_MS } from "../live-server.ts";

const SESSION_ID = scenarios.completed.session!.metadata!.id;

function talkTo(conversation: LiveConversation): Stigmer {
  return new Stigmer({
    baseUrl: "https://gallery.invalid",
    apiKey: "stk_gallery",
    customTransport: createRouterTransport(conversation.routes()),
  });
}

/** What the conversation's log holds now, folded as the views fold it. */
function foldOf(conversation: LiveConversation) {
  return foldSession(conversation.replay.events as SessionEvent[]);
}

/** The cases of the events after the base's, in order. */
function casesAfter(conversation: LiveConversation, base: number): string[] {
  return conversation.replay.events.slice(base).map((event) => event.event.case ?? "");
}

async function send(client: Stigmer, message: string) {
  return client.run.sendMessage({ name: "run-x", org: "demo", sessionId: SESSION_ID, message });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("KIT-13 a message sent in a docs demo gets a scripted answer, never an error", () => {
  it("plays the scripted turn under the reader's words, one event per pace, and waits at the ask", async () => {
    const conversation = new LiveConversation(scenarios.completed);
    const base = scenarios.completed.events.length;
    const response = await send(talkTo(conversation), "what changed?");
    expect(response.run?.metadata?.id).toMatch(/^run_live/);
    expect(foldOf(conversation).turns.at(-1)?.userMessage?.text).toBe("what changed?");
    expect(casesAfter(conversation, base)).toEqual(["userMessage"]);
    await vi.advanceTimersByTimeAsync(PACE_MS);
    expect(casesAfter(conversation, base)).toEqual(["userMessage", "stigmerRunStatus"]);
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    const turn = foldOf(conversation).turns.at(-1)!;
    expect(turn.items.filter((item) => item.kind === "tool_use").map((item) => item.kind === "tool_use" && item.name)).toEqual([
      "read_file",
      "read_file",
      "execute",
    ]);
    expect(turn.asks.map((ask) => ask.name)).toEqual(["execute"]);
    expect(turn.status?.phase).toBe("waiting");
    expect(conversation.replay.runs.at(-1)?.status?.phase).toBe(RunPhase.RUN_WAITING_FOR_APPROVAL);
  });

  it("goes on to the answer and ends the turn when the reader allows the command", async () => {
    const conversation = new LiveConversation(scenarios.completed);
    const client = talkTo(conversation);
    await send(client, "what changed?");
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    const ask = foldOf(conversation).turns.at(-1)!.asks[0]!;
    await client.session.confirmToolUse({ sessionId: SESSION_ID, toolUseId: ask.id, result: "allow" });
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    const turn = foldOf(conversation).turns.at(-1)!;
    expect(turn.ended).toBe(true);
    expect(turn.status?.phase).toBe("completed");
    expect(turn.answer).toMatch(/^Two changes this week/);
    expect(conversation.replay.runs.at(-1)?.status?.phase).toBe(RunPhase.RUN_COMPLETED);
  });

  it("answers from the two files alone when the reader denies the command, and when they grant its class", async () => {
    const denied = new LiveConversation(scenarios.completed);
    const client = talkTo(denied);
    await send(client, "what changed?");
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    await client.session.confirmToolUse({ sessionId: SESSION_ID, toolUseId: foldOf(denied).turns.at(-1)!.asks[0]!.id, result: "deny" });
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    expect(foldOf(denied).turns.at(-1)!.answer).toMatch(/^I won't run it/);

    const granted = new LiveConversation(scenarios.completed);
    const other = talkTo(granted);
    await send(other, "what changed?");
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    await other.session.grantPermission({ sessionId: SESSION_ID, toolUseId: foldOf(granted).turns.at(-1)!.asks[0]!.id });
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    expect(foldOf(granted).turns.at(-1)!.answer).toMatch(/^Two changes this week/);
  });

  it("stops the turn where it is, and sends nothing after", async () => {
    const conversation = new LiveConversation(scenarios.completed);
    const client = talkTo(conversation);
    await send(client, "what changed?");
    await vi.advanceTimersByTimeAsync(PACE_MS * 2);
    const response = await client.session.interrupt({ sessionId: SESSION_ID });
    expect(response.stoppedRunIds).toEqual([conversation.replay.runs.at(-1)!.metadata!.id]);
    const length = conversation.replay.events.length;
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    expect(conversation.replay.events.length).toBe(length);
    const turn = foldOf(conversation).turns.at(-1)!;
    expect(turn.ended).toBe(true);
    expect(turn.status?.phase).toBe("cancelled");
    expect(conversation.working).toBe(false);
  });

  it("queues a message sent while a turn works and starts its own turn when that one ends", async () => {
    const conversation = new LiveConversation(scenarios.completed);
    const client = talkTo(conversation);
    await send(client, "what changed?");
    const queued = await send(client, "and last week?");
    expect(queued.run).toBeUndefined();
    expect(foldOf(conversation).queued.map((message) => message.text)).toEqual(["and last week?"]);
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    await client.session.confirmToolUse({ sessionId: SESSION_ID, toolUseId: foldOf(conversation).turns.at(-1)!.asks[0]!.id, result: "allow" });
    await vi.advanceTimersByTimeAsync(PACE_MS * 40);
    const fold = foldOf(conversation);
    expect(fold.queued).toEqual([]);
    expect(fold.turns.at(-1)!.userMessage?.text).toBe("and last week?");
    expect(fold.turns.at(-1)!.asks.map((ask) => ask.name)).toEqual(["execute"]);
  });

  it("stops a long turn the demo opened on, and drops what waited behind it", async () => {
    const conversation = new LiveConversation(scenarios.busy);
    const client = talkTo(conversation);
    expect(conversation.working).toBe(true);
    await send(client, "is it done yet?");
    expect(foldOf(conversation).queued.map((message) => message.state)).toEqual(["waiting"]);
    const response = await client.session.interrupt({ sessionId: SESSION_ID });
    expect(response.stoppedRunIds).toEqual([scenarios.busy.runs.at(-1)!.metadata!.id]);
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    const fold = foldOf(conversation);
    expect(fold.queued.map((message) => message.state)).toEqual(["dropped"]);
    expect(fold.turns.at(-1)!.status?.phase).toBe("cancelled");
    expect(fold.turns).toHaveLength(scenarios.busy.fold.turns.length);
  });

  it("takes an approval sent before the ask's last events, sending each event once, in order", async () => {
    const conversation = new LiveConversation(scenarios.completed);
    const client = talkTo(conversation);
    const base = scenarios.completed.events.length;
    await send(client, "what changed?");
    // The ask shows from the tool use, before its permission and the waiting phase are sent.
    await vi.waitFor(async () => {
      await vi.advanceTimersByTimeAsync(PACE_MS);
      expect(foldOf(conversation).turns.at(-1)!.asks).toHaveLength(1);
    });
    expect(casesAfter(conversation, base).at(-1)).toBe("agentToolUse");
    await client.session.confirmToolUse({ sessionId: SESSION_ID, toolUseId: foldOf(conversation).turns.at(-1)!.asks[0]!.id, result: "allow" });
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    const ids = conversation.replay.events.slice(base).map((event) => event.event.value?.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(casesAfter(conversation, base).slice(-8, -3)).toEqual(["agentToolUse", "stigmerPermissionAsked", "stigmerRunStatus", "userToolConfirmation", "stigmerRunStatus"]);
    expect(foldOf(conversation).turns.at(-1)!.answer).toMatch(/^Two changes this week/);
  });

  it("starts a queued message's turn the moment the working one ends, so a send just after it queues and a Stop stops it", async () => {
    const conversation = new LiveConversation(scenarios.completed);
    const client = talkTo(conversation);
    await send(client, "what changed?");
    await send(client, "and last week?");
    await vi.advanceTimersByTimeAsync(PACE_MS * 20);
    await client.session.confirmToolUse({ sessionId: SESSION_ID, toolUseId: foldOf(conversation).turns.at(-1)!.asks[0]!.id, result: "allow" });
    // The four events after the confirmation, one per pace: the turn ends on the last.
    await vi.advanceTimersByTimeAsync(PACE_MS * 4);
    expect(foldOf(conversation).turns.at(-2)!.status?.phase).toBe("completed");
    expect(foldOf(conversation).turns.at(-1)!.userMessage?.text).toBe("and last week?");
    expect(conversation.working).toBe(true);
    expect((await send(client, "and the week before?")).run).toBeUndefined();
    await client.session.interrupt({ sessionId: SESSION_ID });
    const length = conversation.replay.events.length;
    await vi.advanceTimersByTimeAsync(PACE_MS * 40);
    expect(conversation.replay.events.length).toBe(length);
    expect(foldOf(conversation).turns.at(-1)!.status?.phase).toBe("cancelled");
    expect(foldOf(conversation).queued.map((message) => message.state)).toEqual(["dropped"]);
  });

  it("gives every queued message its own id, before and after a Stop", async () => {
    const conversation = new LiveConversation(scenarios.completed);
    const client = talkTo(conversation);
    await send(client, "one");
    const a = (await send(client, "two")).message!.event.value!.id;
    const b = (await send(client, "three")).message!.event.value!.id;
    await client.session.interrupt({ sessionId: SESSION_ID });
    await send(client, "four");
    const d = (await send(client, "five")).message!.event.value!.id;
    expect(new Set([a, b, d]).size).toBe(3);
    expect(foldOf(conversation).queued.map((message) => [message.text, message.state])).toEqual([
      ["two", "dropped"],
      ["three", "dropped"],
      ["five", "waiting"],
    ]);
  });

  it("refuses a new conversation while a turn works", async () => {
    const conversation = new LiveConversation(scenarios.completed);
    const client = talkTo(conversation);
    await send(client, "what changed?");
    await expect(client.run.create({ name: "run-y", org: "demo", sessionId: SESSION_ID, message: "again" })).rejects.toThrow(/a turn is working/);
  });

  it("refuses an answer when no tool call waits for one", async () => {
    const conversation = new LiveConversation(scenarios.completed);
    const client = talkTo(conversation);
    const refused = client.session.confirmToolUse({ sessionId: SESSION_ID, toolUseId: "run_x.tc-execute", result: "allow" });
    await expect(refused).rejects.toThrow(/no tool call waits for an answer/);
  });

  it("streams every event it appends to a viewer following the conversation", async () => {
    const conversation = new LiveConversation(scenarios.completed);
    const client = talkTo(conversation);
    const controller = new AbortController();
    const after = BigInt(conversation.replay.events.length);
    const next = conversation.feed.after(after, controller.signal);
    await send(client, "what changed?");
    const fresh = await next;
    expect(fresh.map((event) => [event.seq, event.event.case])).toEqual([[after + 1n, "userMessage"]]);
    controller.abort();
  });
});
