/**
 * Pins how a Claude turn takes the messages a person sends while it works
 * (`mid-turn-input.ts`): when it takes them, in what order it persists and
 * claims, what it pushes to the engine, and when it counts a pushed message
 * read.
 *
 * Why each rule matters:
 *  - while a call runs the queue is taken only when the runtime's hint says
 *    something waits, so a turn makes no claim call per tool step; at a
 *    result it is taken whatever the hint says, because a silent tool
 *    writes no status to refresh the hint and the turn must not end with a
 *    message left behind;
 *  - the transcript is persisted before the claim, so a taken message sits
 *    in the session's log after the agent's words that came before it,
 *    where the agent read it;
 *  - a turn ends only once every pushed message is read, and "read" comes
 *    from the engine alone: a `command_lifecycle` frame past `queued`, or a
 *    main-agent reply frame naming it (a sub-agent's frame names the
 *    sub-agent's prompt, never the person's message);
 *  - a stopping or yielding turn takes nothing, so its continuation reads
 *    what waits;
 *  - a message's images come before its text, as a turn's own message's do.
 */

import { create } from "@bufbuild/protobuf";
import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { RunStatusSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { beforeEach, describe, expect, it } from "vitest";

import { TurnRowsSchema } from "../../../gen/turn/ai/stigmer/runner/turn/v1/rows_pb.js";
import { TranscriptBuilder } from "../../../harness/transcript/builder.js";
import type { TurnInputChannel, TurnMessage } from "../../../harness/turn-input.js";
import type { VisionImage } from "../../../shared/attachment-vision.js";
import { sentMessageIdOf } from "../engine-session-id.js";
import { MidTurnInput, sentMessageOf } from "../mid-turn-input.js";

function message(id: string, text: string, visionImages: readonly VisionImage[] = []): TurnMessage {
  return { id, text, message: [], visionImages: [...visionImages], visionNotViewable: [] };
}

const PNG: VisionImage = { filename: "shot.png", mimeType: "image/png", base64: "iVBORw0KGgo=", byteSize: 8 };
const JPEG: VisionImage = { filename: "photo.jpg", mimeType: "image/jpeg", base64: "/9j/4AAQ", byteSize: 6 };

/** A runtime's side of one turn, recording what the input asks of it in order. */
class FakeRuntime {
  readonly events: string[] = [];
  readonly pushed: SDKUserMessage[] = [];
  pending = false;
  queue: TurnMessage[] = [];
  /** Run while the persist is in flight: what lands between persist and claim. */
  duringPersist: (() => void) | undefined;
  readonly transcript = new TranscriptBuilder("aex-mid", create(TurnRowsSchema), create(RunStatusSchema, {}));

  readonly input: TurnInputChannel = {
    pending: () => this.pending,
    onPending: () => () => undefined,
    claim: async (options) => {
      this.events.push(options?.force === true ? "claim(force)" : "claim");
      return this.queue.splice(0);
    },
    claimed: async () => [],
  };

  constructor() {
    const markPersisted = this.transcript.markPersisted.bind(this.transcript);
    this.transcript.markPersisted = () => {
      this.events.push("markPersisted");
      markPersisted();
    };
  }

  readonly sink = {
    input: this.input,
    transcript: this.transcript,
    requestPersist: async (): Promise<void> => {
      this.events.push("persist");
      this.duringPersist?.();
    },
  };

  readonly stream = {
    push: (m: SDKUserMessage): void => {
      this.events.push(`push ${String(m.uuid)}`);
      this.pushed.push(m);
    },
  };
}

/** The engine's `command_lifecycle` frame, which its typed union does not carry. */
function lifecycle(commandUuid: unknown, state: string): SDKMessage {
  return { type: "command_lifecycle", command_uuid: commandUuid, state, uuid: "frame", session_id: "s" } as unknown as SDKMessage;
}

function assistant(parentToolUseId: string | null, userMessageUuids?: string[]): SDKMessage {
  return {
    type: "assistant",
    message: { id: "msg", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0 } },
    parent_tool_use_id: parentToolUseId,
    uuid: "00000000-0000-4000-8000-000000000001",
    session_id: "s",
    ...(userMessageUuids === undefined ? {} : { user_message_uuid: userMessageUuids.at(-1), user_message_uuids: userMessageUuids }),
  } as unknown as SDKMessage;
}

function streamEvent(parentToolUseId: string | null, userMessageUuids: string[]): SDKMessage {
  return {
    type: "stream_event",
    event: { type: "message_stop" },
    parent_tool_use_id: parentToolUseId,
    uuid: "00000000-0000-4000-8000-000000000002",
    session_id: "s",
    user_message_uuid: userMessageUuids.at(-1),
    user_message_uuids: userMessageUuids,
  } as unknown as SDKMessage;
}

describe("sentMessageOf", () => {
  it("is the text alone, under the message's own derived id, at the top level", () => {
    const sent = sentMessageOf(message("um-1", "also check the tests"));
    expect(sent).toEqual({
      type: "user",
      message: { role: "user", content: "also check the tests" },
      parent_tool_use_id: null,
      uuid: sentMessageIdOf("um-1"),
    });
  });

  it("puts every image before the text, each labelled", () => {
    const sent = sentMessageOf(message("um-2", "what is wrong here?", [PNG, JPEG]));
    expect(sent.uuid).toBe(sentMessageIdOf("um-2"));
    expect(sent.message.content).toEqual([
      { type: "text", text: "Image 1: shot.png" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: PNG.base64 } },
      { type: "text", text: "Image 2: photo.jpg" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: JPEG.base64 } },
      { type: "text", text: "what is wrong here?" },
    ]);
  });
});

describe("MidTurnInput", () => {
  let runtime: FakeRuntime;
  let input: MidTurnInput;

  beforeEach(() => {
    runtime = new FakeRuntime();
    input = new MidTurnInput(runtime.sink, runtime.stream);
  });

  it("takes nothing while working when the hint says nothing waits: no persist, no claim", async () => {
    runtime.queue = [message("um-1", "hi")];
    await input.whileWorking();
    expect(runtime.events).toEqual([]);
    expect(input.owed).toBe(false);
  });

  it("while working with the hint up, persists first, then claims without force, then pushes each in order", async () => {
    runtime.pending = true;
    runtime.queue = [message("um-1", "one"), message("um-2", "two")];
    await input.whileWorking();
    expect(runtime.events).toEqual(["markPersisted", "persist", "claim", `push ${sentMessageIdOf("um-1")}`, `push ${sentMessageIdOf("um-2")}`]);
    expect(runtime.pushed.map((m) => m.message.content)).toEqual(["one", "two"]);
    expect(input.owed).toBe(true);
  });

  it("at a result, claims with force whatever the hint says, after persisting", async () => {
    runtime.pending = false;
    runtime.queue = [message("um-1", "late")];
    await input.atResult();
    expect(runtime.events).toEqual(["markPersisted", "persist", "claim(force)", `push ${sentMessageIdOf("um-1")}`]);
    expect(input.owed).toBe(true);
  });

  it("owes nothing after a claim that took nothing", async () => {
    await input.atResult();
    expect(runtime.events).toEqual(["markPersisted", "persist", "claim(force)"]);
    expect(input.owed).toBe(false);
  });

  it("once halted, takes nothing at all", async () => {
    runtime.pending = true;
    runtime.queue = [message("um-1", "for the continuation")];
    input.halt();
    await input.whileWorking();
    await input.atResult();
    expect(runtime.events).toEqual([]);
    expect(runtime.queue, "the message waits for the continuation").toHaveLength(1);
  });

  it("halted while its persist is in flight, claims nothing", async () => {
    runtime.pending = true;
    runtime.queue = [message("um-1", "for the continuation")];
    runtime.duringPersist = () => input.halt();
    await input.atResult();
    expect(runtime.events).toEqual(["markPersisted", "persist"]);
    expect(runtime.queue).toHaveLength(1);
    expect(input.owed).toBe(false);
  });

  describe("reading what the engine took up", () => {
    const one = sentMessageIdOf("um-1");
    const two = sentMessageIdOf("um-2");

    beforeEach(async () => {
      runtime.queue = [message("um-1", "one"), message("um-2", "two")];
      await input.atResult();
      expect(input.owed).toBe(true);
    });

    it.each(["started", "completed", "cancelled"])("a command_lifecycle frame in state %s marks its message read", (state) => {
      input.observe(lifecycle(one, state));
      expect(input.owed, "the other is still owed").toBe(true);
      input.observe(lifecycle(two, state));
      expect(input.owed).toBe(false);
    });

    it("a queued frame, a frame naming no string id, and another message's frame mark nothing", () => {
      input.observe(lifecycle(one, "queued"));
      input.observe(lifecycle(42, "started"));
      input.observe(lifecycle(undefined, "completed"));
      input.observe(lifecycle(sentMessageIdOf("um-unknown"), "completed"));
      input.observe(lifecycle(two, "queued"));
      expect(input.owed).toBe(true);
      input.observe(lifecycle(one, "started"));
      input.observe(lifecycle(two, "completed"));
      expect(input.owed).toBe(false);
    });

    it("a main-agent reply naming the messages in user_message_uuids marks them read", () => {
      input.observe(assistant(null, [one]));
      expect(input.owed).toBe(true);
      input.observe(streamEvent(null, [two]));
      expect(input.owed).toBe(false);
    });

    it("a sub-agent's reply naming them does not, nor a reply naming none, nor another kind of frame", () => {
      input.observe(assistant("toolu_sub", [one, two]));
      input.observe(streamEvent("toolu_sub", [one, two]));
      input.observe(assistant(null));
      input.observe({ type: "result", subtype: "success", user_message_uuids: [one, two] } as unknown as SDKMessage);
      input.observe({ type: "user", user_message_uuids: [one, two], parent_tool_use_id: null } as unknown as SDKMessage);
      expect(input.owed).toBe(true);
    });
  });
});
