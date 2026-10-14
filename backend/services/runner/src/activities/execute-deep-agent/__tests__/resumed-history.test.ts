/**
 * Pins a eval-run try's recorded conversation as the native graph's
 * messages (`resumed-history.ts`): text to human and AI messages, an
 * assistant's tool calls on its AI message under Claude Code's names, a
 * user's tool results as tool messages answering them before any text,
 * and the empty-thread test that keeps a retried turn from adding it twice.
 */

import { describe, expect, it } from "vitest";
import type { AIMessage, ToolMessage } from "@langchain/core/messages";
import { resumedMessages, threadIsEmpty } from "../resumed-history.js";

describe("resumedMessages", () => {
  it("maps each message to LangChain's kinds, results before text", () => {
    const messages = resumedMessages([
      { role: "user", blocks: [{ type: "text", text: "Read the config." }] },
      {
        role: "assistant",
        blocks: [
          { type: "text", text: "Reading it." },
          { type: "tool_use", id: "t1", name: "Read", input: { file_path: "app.yaml" } },
        ],
      },
      {
        role: "user",
        blocks: [
          { type: "tool_result", toolUseId: "t1", content: "port: 80", isError: false },
          { type: "text", text: "Now shorten it." },
        ],
      },
      { role: "assistant", blocks: [{ type: "tool_use", id: "t2", name: "Bash", input: {} }] },
      { role: "user", blocks: [{ type: "tool_result", toolUseId: "t2", content: "denied", isError: true }] },
    ]);
    expect(messages.map((m) => m.getType())).toEqual(["human", "ai", "tool", "human", "ai", "tool"]);
    const ai = messages[1] as AIMessage;
    expect([ai.content, ai.tool_calls?.map((c) => [c.id, c.name, c.args])]).toEqual(["Reading it.", [["t1", "Read", { file_path: "app.yaml" }]]]);
    const denied = messages[5] as ToolMessage;
    expect([denied.tool_call_id, denied.content, denied.status]).toEqual(["t2", "denied", "error"]);
  });
});

describe("threadIsEmpty", () => {
  it("is true for a thread with no messages, false once it holds any", () => {
    expect(threadIsEmpty({})).toBe(true);
    expect(threadIsEmpty({ messages: [] })).toBe(true);
    expect(threadIsEmpty({ messages: [{}] })).toBe(false);
  });
});
