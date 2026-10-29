/**
 * Pins the Stigmer harness's delivery of a message sent while the turn works
 * (../turn-input-middleware.ts): the thread's delivered ids are read off its
 * state; a delivery appends each message the thread does not hold, once, as
 * a human message carrying the message's id, with its files listed and its
 * images inline, and records its id; before a model call the middleware
 * takes what waits, and on an invocation's first call what the run took and
 * the thread lacks; at a round's end, an answer with no tool call, it asks
 * once more and goes back to the model with what it took; a stopped or
 * yielded turn takes nothing. The engine-level proof is the harness
 * contract kit's message arms.
 */
import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { describe, expect, it, vi } from "vitest";

import type { TurnInputChannel, TurnMessage } from "../../../harness/turn-input.js";
import {
  DELIVERED_INPUTS_KEY,
  createTurnInputMiddleware,
  deliveredInputsOf,
  deliveryOf,
  humanMessageOf,
} from "../turn-input-middleware.js";

function message(id: string, text: string, extra: Partial<TurnMessage> = {}): TurnMessage {
  return { id, text, message: [], visionImages: [], visionNotViewable: [], ...extra };
}

function channel(claims: TurnMessage[][] = [], claimed: TurnMessage[] = []): TurnInputChannel & { readonly forced: boolean[] } {
  const forced: boolean[] = [];
  return {
    forced,
    pending: () => false,
    onPending: () => () => undefined,
    claim: vi.fn(async (options?: { readonly force?: boolean }) => {
      forced.push(options?.force === true);
      return claims.shift() ?? [];
    }),
    claimed: vi.fn(async (delivered: ReadonlySet<string>) => claimed.filter((m) => !delivered.has(m.id))),
  };
}

type Hook = (state: Record<string, unknown>, runtime: unknown) => Promise<Record<string, unknown> | undefined>;

/** The middleware's two hooks, as the agent calls them. */
function hooksOf(middleware: ReturnType<typeof createTurnInputMiddleware>): { before: Hook; after: Hook } {
  const shaped = middleware as unknown as { beforeModel: Hook; afterModel: { hook: Hook; canJumpTo: string[] } };
  expect(shaped.afterModel.canJumpTo).toEqual(["model"]);
  return { before: shaped.beforeModel, after: shaped.afterModel.hook };
}

describe("deliveredInputsOf", () => {
  it("reads the ids the thread's state holds, and none from a state that holds no list", () => {
    expect([...deliveredInputsOf({ [DELIVERED_INPUTS_KEY]: ["m1", 7, "m2"] })]).toEqual(["m1", "m2"]);
    expect(deliveredInputsOf({}).size).toBe(0);
  });
});

describe("humanMessageOf", () => {
  it("is the message's text under its id, for a message without files", () => {
    const human = humanMessageOf(message("m1", "also the README"));
    expect([human.id, human.text]).toEqual(["m1", "also the README"]);
  });

  it("lists the message's files and shows its images inline before its text", () => {
    const human = humanMessageOf(
      message("m1", "what is this?", {
        message: [{ fileId: "file_1", kind: "image", mountPath: "a.png", filename: "a.png", mimeType: "image/png", sizeBytes: 3, relativePath: ".stigmer/uploads/a.png" }],
        visionImages: [{ filename: "a.png", mimeType: "image/png", base64: "AAAA", byteSize: 3 }],
      }),
    );
    const blocks = human.content as Array<{ type: string; text?: string }>;
    const image = blocks.findIndex((block) => block.type === "image_url");
    expect(image, "the image is inline").toBeGreaterThanOrEqual(0);
    expect(image, "before the text").toBeLessThan(blocks.length - 1);
    expect(blocks.at(-1)?.text).toMatch(/\.stigmer\/uploads\/a\.png[\s\S]*what is this\?$/);
  });
});

describe("deliveryOf", () => {
  it("appends each message the thread does not hold, once, in order, and records the ids", () => {
    const update = deliveryOf({ [DELIVERED_INPUTS_KEY]: ["m0"] }, [message("m0", "old"), message("m1", "one"), message("m1", "one"), message("m2", "two")]);
    expect(update?.messages.map((m) => m.text)).toEqual(["one", "two"]);
    expect(update?.[DELIVERED_INPUTS_KEY]).toEqual(["m0", "m1", "m2"]);
  });

  it("is undefined when nothing is new", () => {
    expect(deliveryOf({ [DELIVERED_INPUTS_KEY]: ["m1"] }, [message("m1", "one")])).toBeUndefined();
    expect(deliveryOf({}, [])).toBeUndefined();
  });
});

describe("createTurnInputMiddleware", () => {
  it("takes what waits before each model call, and what the run took and the thread lacks on the first", async () => {
    const input = channel([[message("m2", "two")], [message("m3", "three")]], [message("m1", "lost")]);
    const { before } = hooksOf(createTurnInputMiddleware({ input, stopped: () => false }));
    const first = await before({ messages: [] }, {});
    expect((first?.messages as HumanMessage[]).map((m) => m.text)).toEqual(["lost", "two"]);
    const second = await before({ messages: [], [DELIVERED_INPUTS_KEY]: first?.[DELIVERED_INPUTS_KEY] }, {});
    expect((second?.messages as HumanMessage[]).map((m) => m.text)).toEqual(["three"]);
    expect(input.claimed).toHaveBeenCalledTimes(1);
    expect(input.forced, "a model call asks whatever the hint says").toEqual([true, true]);
  });

  it("asks once more at a round's end and goes back to the model with what it took", async () => {
    const input = channel([], [message("m1", "sent as it answered")]);
    const { after } = hooksOf(createTurnInputMiddleware({ input, stopped: () => false }));
    const update = await after({ messages: [new AIMessage("Done.")] }, {});
    expect(update?.jumpTo).toBe("model");
    expect((update?.messages as HumanMessage[]).map((m) => m.text)).toEqual(["sent as it answered"]);
    expect(input.forced).toEqual([true]);
  });

  it("passes a model call that asked for a tool, and a round's end with nothing to read", async () => {
    const input = channel();
    const { after } = hooksOf(createTurnInputMiddleware({ input, stopped: () => false }));
    const calling = new AIMessage({ content: "", tool_calls: [{ id: "c1", name: "ls", args: {} }] });
    expect(await after({ messages: [calling] }, {})).toBeUndefined();
    expect(await after({ messages: [new HumanMessage("not the model's")] }, {})).toBeUndefined();
    expect(await after({ messages: [] }, {})).toBeUndefined();
    expect(await after({ messages: [new AIMessage("Done.")] }, {})).toBeUndefined();
    expect(input.forced).toEqual([true]);
  });

  it("takes nothing once the turn is stopped or yields", async () => {
    const input = channel([[message("m1", "one")]], [message("m0", "lost")]);
    const { before, after } = hooksOf(createTurnInputMiddleware({ input, stopped: () => true }));
    expect(await before({ messages: [] }, {})).toBeUndefined();
    expect(await after({ messages: [new AIMessage("Done.")] }, {})).toBeUndefined();
    expect(input.claim).not.toHaveBeenCalled();
    expect(input.claimed).not.toHaveBeenCalled();
  });
});
