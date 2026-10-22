/**
 * Pins the turn's input channel (../turn-input.ts): a claim asks the server
 * only when the hint says messages wait, or when forced; claims run one at
 * a time; a claim the server does not answer takes nothing and keeps the
 * hint; a message's text blocks join as a turn's own message's do and its
 * files are shown only when it carries some; the hint tells its listeners
 * each time it rises; and what the run took while it worked is every one of
 * its messages but those it started with, less the ones named delivered.
 */
import { create } from "@bufbuild/protobuf";
import { describe, expect, it, vi } from "vitest";

import type { ContentBlock } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_content_pb";
import { SessionEventSchema, type SessionEvent } from "@stigmer/apis/ai/stigmer/agentic/session/v1/event_pb";

import type { MessageFilesView } from "../turn-context.js";
import { NO_TURN_INPUT, newTurnInput, takenWhileWorking, turnMessageOf, type TurnInputServer } from "../turn-input.js";

const NO_FILES: MessageFilesView = { message: [], visionImages: [], visionNotViewable: [] };

function message(id: string, blocks: Array<{ type: string; text?: string; fileId?: string }>, runId = "run_a"): SessionEvent {
  return create(SessionEventSchema, {
    runId,
    event: {
      case: "userMessage",
      value: {
        id,
        content: blocks.map((block) => ({
          type: block.type,
          text: block.text ?? "",
          ...(block.fileId === undefined ? {} : { source: { type: "file", fileId: block.fileId } }),
        })),
      },
    },
  });
}

function text(id: string, value: string): SessionEvent {
  return message(id, [{ type: "text", text: value }]);
}

function server(overrides: Partial<TurnInputServer> = {}): TurnInputServer {
  return {
    claim: vi.fn(async () => []),
    runMessages: vi.fn(async () => []),
    queuedMessageIds: () => [],
    ...overrides,
  };
}

describe("turnMessageOf", () => {
  it("joins the text blocks by a blank line and shows no files for a message without any", async () => {
    const resolve = vi.fn(async () => NO_FILES);
    const read = await turnMessageOf(
      message("m1", [{ type: "text", text: "one" }, { type: "text", text: "" }, { type: "text", text: "two" }]),
      resolve,
    );
    expect(read).toEqual({ id: "m1", text: "one\n\ntwo", ...NO_FILES });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("shows a message's files through the resolver, handed only its file blocks", async () => {
    const shown: MessageFilesView = {
      message: [{ fileId: "file_1", kind: "image", mountPath: "a.png", filename: "a.png", mimeType: "image/png", sizeBytes: 3, relativePath: ".stigmer/uploads/a.png" }],
      visionImages: [],
      visionNotViewable: [],
    };
    const resolve = vi.fn(async (_blocks: readonly ContentBlock[]) => shown);
    const read = await turnMessageOf(message("m1", [{ type: "text", text: "look" }, { type: "image", fileId: "file_1" }]), resolve);
    expect(read?.message).toEqual(shown.message);
    expect(resolve.mock.calls[0]?.[0].map((block) => block.source?.fileId)).toEqual(["file_1"]);
  });

  it("is undefined for any other event", async () => {
    const other = create(SessionEventSchema, { event: { case: "sessionStatusRunning", value: { id: "e1" } } });
    expect(await turnMessageOf(other, async () => NO_FILES)).toBeUndefined();
  });
});

describe("newTurnInput", () => {
  it("asks the server only when the hint says messages wait, or when forced", async () => {
    const claim = vi.fn(async () => [text("m1", "hello")]);
    const input = newTurnInput(server({ claim }), async () => NO_FILES);
    expect(await input.claim()).toEqual([]);
    expect(claim).not.toHaveBeenCalled();
    input.setPending(true);
    expect((await input.claim()).map((m) => m.text)).toEqual(["hello"]);
    expect(input.pending(), "a claim that answered clears the hint").toBe(false);
    expect((await input.claim({ force: true })).map((m) => m.id)).toEqual(["m1"]);
    expect(claim).toHaveBeenCalledTimes(2);
  });

  it("runs one claim at a time: a second while one is in flight shares its answer", async () => {
    let answer: (events: SessionEvent[]) => void = () => undefined;
    const claim = vi.fn(() => new Promise<SessionEvent[]>((resolve) => (answer = resolve)));
    const input = newTurnInput(server({ claim }), async () => NO_FILES);
    const first = input.claim({ force: true });
    const second = input.claim({ force: true });
    answer([text("m1", "once")]);
    expect(await first).toEqual(await second);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("takes nothing and keeps the hint when the server does not answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const input = newTurnInput(server({ claim: vi.fn(async () => Promise.reject(new Error("unavailable"))) }), async () => NO_FILES);
    input.setPending(true);
    expect(await input.claim()).toEqual([]);
    expect(input.pending()).toBe(true);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("tells its listeners each time the hint rises, never while it stays up, and not after they leave", () => {
    const input = newTurnInput(server(), async () => NO_FILES);
    const heard = vi.fn();
    const leave = input.onPending(heard);
    input.setPending(true);
    input.setPending(true);
    input.setPending(false);
    input.setPending(true);
    expect(heard).toHaveBeenCalledTimes(2);
    leave();
    input.setPending(false);
    input.setPending(true);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("answers what the run took while it worked, less the messages named delivered", async () => {
    const runMessages = vi.fn(async () => [text("own", "the task"), text("m1", "one"), text("m2", "two")]);
    const input = newTurnInput(server({ runMessages }), async () => NO_FILES);
    expect((await input.claimed(new Set(["m1"]))).map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("takenWhileWorking", () => {
  it("passes over the message a run was created with", () => {
    const events = [text("own", "the task"), text("m1", "one")];
    expect(takenWhileWorking(events, []).map((event) => event.event.value?.id)).toEqual(["m1"]);
  });

  it("passes over the queued messages a run started with, wherever they sit", () => {
    const events = [text("q1", "a"), text("q2", "b"), text("m1", "later")];
    expect(takenWhileWorking(events, ["q1", "q2"]).map((event) => event.event.value?.id)).toEqual(["m1"]);
  });

  it("reads only user messages", () => {
    const other = create(SessionEventSchema, { runId: "run_a", event: { case: "sessionStatusRunning", value: { id: "e1" } } });
    expect(takenWhileWorking([text("own", "task"), other, text("m1", "one")], [])).toHaveLength(1);
  });
});

describe("NO_TURN_INPUT", () => {
  it("never has input", async () => {
    expect(NO_TURN_INPUT.pending()).toBe(false);
    NO_TURN_INPUT.onPending(() => undefined)();
    expect(await NO_TURN_INPUT.claim({ force: true })).toEqual([]);
    expect(await NO_TURN_INPUT.claimed(new Set())).toEqual([]);
  });
});
