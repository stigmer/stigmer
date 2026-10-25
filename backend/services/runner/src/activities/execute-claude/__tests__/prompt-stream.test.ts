/**
 * Pins the held prompt stream (`prompt-stream.ts`): the engine reads what is
 * pushed, in order, waits while nothing is queued, and ends only once the
 * stream is closed and drained.
 *
 * Why it matters: the SDK answers the engine's permission and hook requests
 * over the channel this stream feeds, so a stream that ended early would
 * leave a gated call refused; and a message a person sends mid-turn reaches
 * the engine only by a push into a stream still open.
 */

import { describe, it, expect } from "vitest";
import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import { userMessageOf } from "../engine-options.js";
import { PromptStream } from "../prompt-stream.js";

function message(text: string): SDKUserMessage {
  return userMessageOf(text, `00000000-0000-5000-8000-00000000000${text.length}`);
}

describe("PromptStream", () => {
  it("yields what was queued before the read, in order, then ends once closed", async () => {
    const stream = new PromptStream();
    stream.push(message("a"));
    stream.push(message("bb"));
    stream.close();
    const read: SDKUserMessage[] = [];
    for await (const m of stream) read.push(m);
    expect(read.map((m) => m.message.content)).toEqual(["a", "bb"]);
  });

  it("holds a read open until a message is pushed", async () => {
    const stream = new PromptStream();
    const iterator = stream[Symbol.asyncIterator]();
    let settled = false;
    const next = iterator.next().then((result) => {
      settled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    stream.push(message("late"));
    const result = await next;
    expect(result.done).toBe(false);
    expect(result.value?.message.content).toBe("late");
  });

  it("ends a waiting read when closed with nothing queued", async () => {
    const stream = new PromptStream();
    const iterator = stream[Symbol.asyncIterator]();
    const next = iterator.next();
    stream.close();
    await expect(next).resolves.toEqual({ done: true, value: undefined });
  });

  it("ignores a push after close", async () => {
    const stream = new PromptStream();
    stream.close();
    stream.push(message("too late"));
    const iterator = stream[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("reports whether it is closed", () => {
    const stream = new PromptStream();
    expect(stream.isClosed).toBe(false);
    stream.close();
    expect(stream.isClosed).toBe(true);
  });

  it("drains what was queued before close, then ends", async () => {
    const stream = new PromptStream();
    const iterator = stream[Symbol.asyncIterator]();
    stream.push(message("queued"));
    stream.close();
    expect((await iterator.next()).value?.message.content).toBe("queued");
    expect((await iterator.next()).done).toBe(true);
  });

  it("keeps waiting across several pushes read one at a time", async () => {
    const stream = new PromptStream();
    const iterator = stream[Symbol.asyncIterator]();
    const first = iterator.next();
    stream.push(message("one"));
    expect((await first).value?.message.content).toBe("one");
    const second = iterator.next();
    stream.push(message("two"));
    expect((await second).value?.message.content).toBe("two");
  });
});
