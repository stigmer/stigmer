// Unit arms for the wire reader the request-shape suite uses to find where a
// turn's own payload rides: the text of a captured request's last user message.
// Domain: conformance harness (execution engine).
//
// Pinned: a string content is read as it is; a block content joins its text
// blocks and skips an image; an earlier user message (a previous turn's) is
// never read when a later one exists; and a body with no user message, or no
// `messages` at all, is refused by name rather than read as empty.
import { describe, expect, it } from "vitest";
import { readLastUserText } from "../llm-wire";

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
