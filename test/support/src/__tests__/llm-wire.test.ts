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
//
// And for the canned responses: every one carries its own message id, as a
// provider's do, whatever usage it states (stigmer#2437: a repeated id made
// the Stigmer harness's reducer replace each round with the next).
//
// And for Gemini's wire: a scripted turn's usage in Google's terms (the
// prompt counting its cached tokens, thinking apart and in the total), its
// function calls signed, its stream repeating the usage so far on every
// frame, and Google's rule on an unsigned function call.
import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";
import {
  anthropicText,
  anthropicToolUse,
  anthropicToolUses,
  geminiResponseOf,
  missingThoughtSignature,
  mockThoughtSignature,
  MOCK_THOUGHT_TOKENS_PER_BLOCK,
  readLastUserText,
  readTurnShapes,
  writeGeminiSse,
} from "../llm-wire.ts";

describe("the canned responses' message ids", () => {
  it("are unique across text and tool-use turns, with or without stated usage", () => {
    const ids = [
      anthropicText("a").id,
      anthropicText("b").id,
      anthropicToolUse("t1", "echo", {}).id,
      anthropicToolUses([{ toolCallId: "t2", toolName: "echo", toolInput: {} }], { inputTokens: 10 }).id,
      anthropicText("c", { inputTokens: 10 }).id,
    ];
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^msg_mock_\d+$/);
  });
});

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

describe("Gemini's wire", () => {
  it("states a turn's usage as Google does: the prompt with its cached tokens, the thinking apart and in the total", () => {
    const body = anthropicToolUse("c1", "f", {}, { inputTokens: 40, outputTokens: 9, cacheReadInputTokens: 30 });
    const response = geminiResponseOf({ ...body, content: [{ type: "thinking", thinking: "hm" }, ...body.content] });

    expect(response.usageMetadata).toEqual({
      promptTokenCount: 70,
      candidatesTokenCount: 9,
      thoughtsTokenCount: MOCK_THOUGHT_TOKENS_PER_BLOCK,
      cachedContentTokenCount: 30,
      totalTokenCount: 70 + 9 + MOCK_THOUGHT_TOKENS_PER_BLOCK,
    });
    expect(response.candidates[0]?.content.parts).toEqual([
      { text: "hm", thought: true },
      { functionCall: { id: "c1", name: "f", args: {} }, thoughtSignature: mockThoughtSignature("c1") },
    ]);
  });

  it("streams one frame per part, the last carrying the finish and the whole usage", () => {
    const written: string[] = [];
    const res = { writeHead: () => res, write: (chunk: string) => written.push(chunk), end: () => res } as unknown as ServerResponse;

    writeGeminiSse(res, anthropicToolUses([{ toolCallId: "a", toolName: "f", toolInput: {} }, { toolCallId: "b", toolName: "g", toolInput: {} }], { inputTokens: 10, outputTokens: 4 }));

    const frames = written.map((frame) => JSON.parse(frame.replace(/^data: /, "")) as { candidates: Array<{ finishReason?: string }>; usageMetadata: { candidatesTokenCount: number } });
    expect(frames).toHaveLength(2);
    expect(frames.map((frame) => frame.candidates[0]?.finishReason)).toEqual([undefined, "STOP"]);
    expect(frames.map((frame) => frame.usageMetadata.candidatesTokenCount)).toEqual([0, 4]);
  });

  it("names the first unsigned function call of a model turn, and passes a signed conversation", () => {
    const ask = { role: "user" as const, parts: [{ text: "go" }] };
    const signed = { role: "model" as const, parts: [{ functionCall: { name: "f", args: {} }, thoughtSignature: "s" }, { functionCall: { name: "g", args: {} } }] };
    const unsigned = { role: "model" as const, parts: [{ functionCall: { name: "h", args: {} } }] };

    expect(missingThoughtSignature({ contents: [ask, signed] })).toBeUndefined();
    expect(missingThoughtSignature({ contents: [ask, signed, unsigned] })).toContain("function call `h`, position 2");
  });
});
