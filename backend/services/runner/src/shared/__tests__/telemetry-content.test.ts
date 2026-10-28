/**
 * The conversation's text as a trace carries it (`shared/telemetry-content.ts`):
 * never more than the saved conversation shows (a secret-named argument
 * redacted wherever it appears, a write to a secret-like path reduced to its
 * path with no result, matched by call id in later input; a read not
 * withheld, as the console does not withhold it), in the GenAI conventions'
 * message shape, and bounded so every attribute stays valid JSON: a text cut
 * around a marker, a span's content under 64 KiB with the oldest input
 * messages dropped first behind one marker.
 */

import { describe, expect, it } from "vitest";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

import {
  SPAN_CONTENT_BYTES,
  TEXT_KEEP,
  chatContent,
  cutText,
  exportedArguments,
  exportedResult,
  renderMessages,
  toolCallContent,
  turnContent,
  type ChatMessage,
} from "../telemetry-content.js";

describe("cutText", () => {
  it("keeps a text up to both kept ends whole", () => {
    const text = "a".repeat(2 * TEXT_KEEP);
    expect(cutText(text)).toBe(text);
  });

  it("cuts a longer text to its first and last 4,000 characters around a marker naming the cut", () => {
    const text = `${"h".repeat(TEXT_KEEP)}${"m".repeat(2000)}${"t".repeat(TEXT_KEEP)}`;
    expect(cutText(text)).toBe(`${"h".repeat(TEXT_KEEP)}[cut 2000 characters]${"t".repeat(TEXT_KEEP)}`);
  });

  it("never splits a surrogate pair at either end", () => {
    // An emoji straddles the head's last index and the tail's first.
    const text = `${"a".repeat(TEXT_KEEP - 1)}😀${"b".repeat(3000)}😀${"c".repeat(TEXT_KEEP - 1)}`;
    const cut = cutText(text);
    expect(cut.startsWith(`${"a".repeat(TEXT_KEEP - 1)}[cut`)).toBe(true);
    expect(cut.endsWith(`]${"c".repeat(TEXT_KEEP - 1)}`)).toBe(true);
    expect(cut).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(cut).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
    const marker = /\[cut (\d+) characters\]/.exec(cut);
    expect(Number(marker?.[1])).toBe(text.length - 2 * (TEXT_KEEP - 1));
  });
});

describe("exportedArguments", () => {
  it("redacts a top-level secret-named argument and leaves the rest", () => {
    expect(exportedArguments("http_call", { token: "sk-live", password: "hunter2", url: "https://x" })).toEqual({
      arguments: { token: "[REDACTED]", password: "[REDACTED]", url: "https://x" },
      withheld: false,
    });
  });

  it("cuts long string values", () => {
    const { arguments: args } = exportedArguments("http_call", { body: "x".repeat(20_000) });
    expect(String(args.body)).toMatch(/\[cut 12000 characters\]/);
  });

  it.each(["write_file", "edit_file", "Write", "Edit"])("reduces a %s to a secret-like path to the path, withheld", (name) => {
    expect(exportedArguments(name, { file_path: "/x/.env", content: "API_KEY=sk-live" })).toEqual({
      arguments: { path: "/x/.env" },
      withheld: true,
    });
  });

  it("shows a write to an ordinary path", () => {
    expect(exportedArguments("write_file", { file_path: "/x/notes.md", content: "hello" })).toEqual({
      arguments: { file_path: "/x/notes.md", content: "hello" },
      withheld: false,
    });
  });

  it("does not withhold a read of a secret-like path, as the saved conversation does not", () => {
    expect(exportedArguments("read_file", { file_path: "/x/.env" })).toEqual({
      arguments: { file_path: "/x/.env" },
      withheld: false,
    });
  });

  it("withholds a result exactly when the arguments are", () => {
    expect(exportedResult("Updated file", true)).toBeNull();
    expect(exportedResult("Updated file", false)).toBe("Updated file");
  });
});

describe("renderMessages", () => {
  const conversation = [
    new SystemMessage("You are a helper."),
    new HumanMessage("Set up the key."),
    new AIMessage({
      content: [
        { type: "thinking", thinking: "I will write .env", signature: "sig" },
        { type: "text", text: "Writing it." },
      ],
      tool_calls: [
        { id: "call_env", name: "write_file", args: { file_path: "/w/.env", content: "API_KEY=sk-live" } },
        { id: "call_api", name: "http_call", args: { token: "sk-live", url: "https://x" } },
      ],
    }),
    new ToolMessage({ tool_call_id: "call_env", content: "Wrote /w/.env" }),
    new ToolMessage({ tool_call_id: "call_api", content: "200 OK" }),
    new HumanMessage({ content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }, { type: "text", text: "and this?" }] }),
  ];

  it("gives each message its role and the conventions' parts, with the saved conversation's rules applied", () => {
    expect(renderMessages(conversation)).toEqual([
      { role: "system", parts: [{ type: "text", content: "You are a helper." }] },
      { role: "user", parts: [{ type: "text", content: "Set up the key." }] },
      {
        role: "assistant",
        parts: [
          { type: "reasoning", content: "I will write .env" },
          { type: "text", content: "Writing it." },
          { type: "tool_call", id: "call_env", name: "write_file", arguments: { path: "/w/.env" } },
          { type: "tool_call", id: "call_api", name: "http_call", arguments: { token: "[REDACTED]", url: "https://x" } },
        ],
      },
      { role: "tool", parts: [{ type: "tool_call_response", id: "call_env", response: null }] },
      { role: "tool", parts: [{ type: "tool_call_response", id: "call_api", response: "200 OK" }] },
      { role: "user", parts: [{ type: "text", content: "[image]" }, { type: "text", content: "and this?" }] },
    ]);
  });

  it("never carries a secret value anywhere in its output", () => {
    expect(JSON.stringify(renderMessages(conversation))).not.toContain("sk-live");
  });
});

describe("chatContent", () => {
  it("renders the three attributes as JSON in the conventions' shape, the output with its finish reason", () => {
    const content = chatContent({
      system: "Be brief.",
      messages: [new HumanMessage("hi")],
      response: new AIMessage("hello"),
      finishReason: "end_turn",
    });
    expect(JSON.parse(content.systemInstructions ?? "null")).toEqual([{ type: "text", content: "Be brief." }]);
    expect(JSON.parse(content.inputMessages)).toEqual([{ role: "user", parts: [{ type: "text", content: "hi" }] }]);
    expect(JSON.parse(content.outputMessages)).toEqual([
      { role: "assistant", parts: [{ type: "text", content: "hello" }], finish_reason: "end_turn" },
    ]);
  });

  it("sets no system instructions when there are none", () => {
    expect(chatContent({ system: undefined, messages: [], response: new AIMessage("x"), finishReason: undefined }).systemInstructions).toBeUndefined();
  });

  it("stays under the span's bound, dropping the oldest input messages behind one marker", () => {
    const messages = Array.from({ length: 40 }, (_, i) => new HumanMessage(`${i}:${"x".repeat(7_000)}`));
    const content = chatContent({ system: "s".repeat(9_000), messages, response: new AIMessage("y".repeat(9_000)), finishReason: "end_turn" });
    const total =
      Buffer.byteLength(content.inputMessages) + Buffer.byteLength(content.outputMessages) + Buffer.byteLength(content.systemInstructions ?? "");
    expect(total).toBeLessThanOrEqual(SPAN_CONTENT_BYTES);

    const input = JSON.parse(content.inputMessages) as [{ elided_messages: number }, ...ChatMessage[]];
    const [marker, ...kept] = input;
    expect(marker.elided_messages).toBeGreaterThan(0);
    expect(marker.elided_messages + kept.length).toBe(40);
    const last = kept[kept.length - 1]?.parts[0];
    expect(last?.type === "text" ? last.content.startsWith("39:") : false).toBe(true);
    expect(() => JSON.parse(content.outputMessages)).not.toThrow();
    expect(() => JSON.parse(content.systemInstructions ?? "null")).not.toThrow();
  });
});

describe("turnContent", () => {
  it("shapes the turn's request as a user message and its answer as the assistant's", () => {
    const { input, output } = turnContent("Fix the build", "Fixed.");
    expect(JSON.parse(input)).toEqual([{ role: "user", parts: [{ type: "text", content: "Fix the build" }] }]);
    expect(JSON.parse(output ?? "null")).toEqual([{ role: "assistant", parts: [{ type: "text", content: "Fixed." }], finish_reason: "stop" }]);
  });

  it("has no output before there is an answer", () => {
    expect(turnContent("Fix the build", undefined).output).toBeUndefined();
  });
});

describe("the shapes a message's content can take", () => {
  it("cuts every string inside nested arguments and keeps other values as they are", () => {
    const long = "y".repeat(2 * TEXT_KEEP + 10);
    const { arguments: args } = exportedArguments("execute", { list: [long, 3, null], nested: { deep: long }, flag: true });
    expect((args.list as unknown[])[0]).toBe(cutText(long));
    expect((args.list as unknown[]).slice(1)).toEqual([3, null]);
    expect((args.nested as { deep: string }).deep).toBe(cutText(long));
    expect(args.flag).toBe(true);
  });

  it("skips what is not a message, a message of no known role, and blocks that carry no text", () => {
    const rendered = renderMessages([
      null,
      "a bare string",
      { type: "function", content: "an unknown role" },
      new HumanMessage({ content: [{ type: "text", text: "kept" }, "a raw string block", { type: "unknown" }, null, 7] as never }),
      { type: "ai", content: undefined },
    ]);
    expect(rendered).toEqual([
      { role: "user", parts: [{ type: "text", content: "kept" }, { type: "text", content: "a raw string block" }] },
      { role: "assistant", parts: [] },
    ]);
  });

  it("reads a tool message whose content is a list of blocks as its text", () => {
    const rendered = renderMessages([new ToolMessage({ content: [{ type: "text", text: "line one" }, { type: "text", text: " and two" }] as never, tool_call_id: "c1" })]);
    expect(rendered).toEqual([{ role: "tool", parts: [{ type: "tool_call_response", id: "c1", response: "line one and two" }] }]);
  });

  it("puts a marker naming the size in place of arguments too large for a span", () => {
    const wide = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`k${i}`, "z".repeat(2 * TEXT_KEEP)]));
    const content = toolCallContent("execute", wide);
    const parsed = JSON.parse(content.arguments) as { elided_bytes: number };
    expect(parsed.elided_bytes).toBeGreaterThan(SPAN_CONTENT_BYTES / 2);
    expect(content.withheld).toBe(false);
  });
});
