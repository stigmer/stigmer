// Unit arms for the wire reader the request-shape suite uses to find where a
// turn's own payload rides: the text of a captured request's last user message.
// Domain: test support (model fakes).
//
// Pinned: a string content is read as it is; a block content joins its text
// blocks and skips an image; an earlier user message (a previous turn's) is
// never read when a later one exists; and a body with no user message, or no
// `messages` at all, is refused by name rather than read as empty.
//
// And for `readTurnShapes`, the conversation's shape the advisories facet
// reads: one entry per message with its role and block types in order, a
// string content as one `text` block, and a missing `messages`, a roleless
// message or a non-block content refused by name.
import { describe, expect, it } from "vitest";
import { readLastUserText, readTurnShapes } from "../llm-wire.ts";

describe("readTurnShapes", () => {
  it("reads each message's role and block types in order, a string content as one text block", () => {
    const body = {
      model: "m",
      messages: [
        { role: "user", content: "go" },
        { role: "assistant", content: [{ type: "text", text: "on it" }, { type: "tool_use", id: "t1", name: "echo", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
        { role: "user", content: [{ type: "text", text: "an advisory" }] },
      ],
    };
    expect(readTurnShapes(body)).toEqual([
      { role: "user", blocks: ["text"] },
      { role: "assistant", blocks: ["text", "tool_use"] },
      { role: "user", blocks: ["tool_result"] },
      { role: "user", blocks: ["text"] },
    ]);
  });

  it("refuses a body without messages, a roleless message and a non-block content, by name", () => {
    expect(() => readTurnShapes({ model: "m" })).toThrow(/not an Anthropic messages body/);
    expect(() => readTurnShapes({ model: "m", messages: [{ content: "x" }] })).toThrow(/message 0 has no string role/);
    expect(() => readTurnShapes({ model: "m", messages: [{ role: "user", content: 7 }] })).toThrow(
      /message 0's content must be a string or blocks/,
    );
  });
});

describe("readLastUserText", () => {
  it("reads a string content as it is", () => {
    expect(readLastUserText({ model: "m", messages: [{ role: "user", content: "hello" }] })).toBe("hello");
  });

  it("joins the text blocks of a block content and skips an image", () => {
    const body = {
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: "" } },
            { type: "text", text: "first" },
            { type: "text", text: "second" },
          ],
        },
      ],
    };
    expect(readLastUserText(body)).toBe("first\nsecond");
  });

  it("reads the last user message, never an earlier turn's", () => {
    const body = {
      model: "m",
      messages: [
        { role: "user", content: "turn one" },
        { role: "assistant", content: "reply" },
        { role: "user", content: "turn two" },
      ],
    };
    expect(readLastUserText(body)).toBe("turn two");
  });

  it("refuses a body with no user message, or no messages, by name", () => {
    expect(() => readLastUserText({ model: "m", messages: [{ role: "assistant", content: "x" }] })).toThrow(
      /no user message/,
    );
    expect(() => readLastUserText({ model: "m" })).toThrow(/not an Anthropic messages body/);
  });
});
