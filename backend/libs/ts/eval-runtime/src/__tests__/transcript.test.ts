/**
 * Pins the transcript reader (transcript.ts): which records and blocks a
 * resumed conversation keeps, how split records join, the pairing rule a
 * model API requires, and the judge's text rendering.
 */

import { describe, expect, it } from "vitest";
import { parseTranscript, renderTranscript } from "../transcript.js";

const line = (record: unknown): string => JSON.stringify(record);

const user = (content: unknown, extra: Record<string, unknown> = {}): string =>
  line({ type: "user", message: { role: "user", content }, ...extra });
const assistant = (content: unknown, extra: Record<string, unknown> = {}): string =>
  line({ type: "assistant", message: { role: "assistant", content }, ...extra });

describe("parseTranscript", () => {
  it("keeps the main conversation's user and assistant messages", () => {
    const text = [
      line({ type: "summary", summary: "earlier" }),
      user("write a haiku"),
      assistant([{ type: "text", text: "Autumn moon" }]),
      line({ type: "system", content: "compacted" }),
    ].join("\n");
    const parsed = parseTranscript(text, { requirePairing: true });
    expect(parsed).toEqual({
      ok: true,
      messages: [
        { role: "user", blocks: [{ type: "text", text: "write a haiku" }] },
        { role: "assistant", blocks: [{ type: "text", text: "Autumn moon" }] },
      ],
    });
  });

  it("drops sidechain records and thinking blocks, and names images", () => {
    const text = [
      user([{ type: "text", text: "look" }, { type: "image", source: {} }]),
      assistant([{ type: "text", text: "sub" }], { isSidechain: true }),
      assistant([
        { type: "thinking", thinking: "hmm", signature: "sig" },
        { type: "redacted_thinking", data: "x" },
        { type: "text", text: "a cat" },
      ]),
    ].join("\n");
    const parsed = parseTranscript(text, { requirePairing: true });
    expect(parsed.ok && parsed.messages).toEqual([
      { role: "user", blocks: [{ type: "text", text: "look" }, { type: "text", text: "[image]" }] },
      { role: "assistant", blocks: [{ type: "text", text: "a cat" }] },
    ]);
  });

  it("joins an assistant reply split over records, and its results", () => {
    const text = [
      user("read both"),
      assistant([{ type: "tool_use", id: "t1", name: "Read", input: { file_path: "a" } }]),
      assistant([{ type: "tool_use", id: "t2", name: "Read", input: { file_path: "b" } }]),
      user([{ type: "tool_result", tool_use_id: "t1", content: "A" }]),
      user([{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "B" }], is_error: true }]),
      assistant([{ type: "text", text: "done" }]),
    ].join("\n");
    const parsed = parseTranscript(text, { requirePairing: true });
    expect(parsed.ok && parsed.messages.map((m) => [m.role, m.blocks.length])).toEqual([
      ["user", 1],
      ["assistant", 2],
      ["user", 2],
      ["assistant", 1],
    ]);
    expect(parsed.ok && parsed.messages[2]?.blocks[1]).toEqual({
      type: "tool_result",
      toolUseId: "t2",
      content: "B",
      isError: true,
    });
  });

  it("refuses an unanswered call, a stray result, a bad line and an empty file", () => {
    const call = assistant([{ type: "tool_use", id: "t1", name: "Bash", input: {} }]);
    expect(parseTranscript([user("go"), call].join("\n"), { requirePairing: true })).toEqual({
      ok: false,
      error: "the call Bash (t1) has no tool_result in the next user message",
    });
    expect(
      parseTranscript([user("go"), assistant("ok"), user([{ type: "tool_result", tool_use_id: "zz", content: "" }])].join("\n"), {
        requirePairing: true,
      }),
    ).toEqual({ ok: false, error: "the tool_result for zz answers no call of the assistant message before it" });
    expect(parseTranscript(`${user("go")}\n{nope`, { requirePairing: true })).toEqual({
      ok: false,
      error: "line 2 is not JSON",
    });
    expect(parseTranscript(line({ type: "summary" }), { requirePairing: false })).toEqual({
      ok: false,
      error: "it holds no user or assistant message",
    });
  });

  it("reads an unpaired transcript when pairing is not asked", () => {
    const text = [user("go"), assistant([{ type: "tool_use", id: "t1", name: "Bash", input: {} }])].join("\n");
    expect(parseTranscript(text, { requirePairing: false }).ok).toBe(true);
  });
});

describe("renderTranscript", () => {
  it("renders one line per message, tool calls and results named", () => {
    const text = [
      user("list files"),
      assistant([{ type: "text", text: "Sure." }, { type: "tool_use", id: "t", name: "Bash", input: { command: "ls" } }]),
      user([{ type: "tool_result", tool_use_id: "t", content: "a.txt" }]),
    ].join("\n");
    expect(renderTranscript(text)).toBe(
      ['user: list files', 'assistant: Sure. [called Bash {"command":"ls"}]', "user: [tool result: a.txt]"].join("\n"),
    );
  });

  it("keeps a line that is not JSON where it stands, and drops records that are not the conversation", () => {
    expect(renderTranscript("not json")).toBe("not json");
    expect(renderTranscript([user("a"), "oops", user("b"), line({ type: "summary" }), assistant("c")].join("\n"))).toBe(
      ["user: a", "oops", "user: b", "assistant: c"].join("\n"),
    );
  });
});
