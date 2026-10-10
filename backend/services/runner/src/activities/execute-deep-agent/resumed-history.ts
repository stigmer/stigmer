/**
 * A plugin-eval try's recorded conversation as the native graph's messages,
 * so the try resumes it the way Claude Code resumes a `--resume` session:
 * the case's prompt is the next user turn after it.
 *
 * The transcript arrives already read and checked (`@stigmer/eval-runtime`
 * `parseTranscript`, tool calls and results paired). Each message maps to
 * LangChain's own kinds: a user message's text to a `HumanMessage`, its
 * tool results to `ToolMessage`s answering the calls before them (results
 * first, as a model API orders them), an assistant message to one
 * `AIMessage` carrying its text and its tool calls. The calls keep Claude
 * Code's tool names (`Read`, `Bash`): the history is what happened there,
 * not rewritten into this engine's names.
 *
 * The messages ride the turn's first input (`composeGraphInput`), so the
 * graph's messages reducer stores them in the thread with the turn, as any
 * input is stored; nothing writes the checkpointer outside a turn. A retried
 * turn finds the thread no longer empty and adds nothing.
 */

import { AIMessage, type BaseMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import type { TranscriptMessage } from "@stigmer/eval-runtime";

/** The transcript as the graph's messages, in order. */
export function resumedMessages(history: readonly TranscriptMessage[]): BaseMessage[] {
  const messages: BaseMessage[] = [];
  for (const message of history) {
    if (message.role === "assistant") {
      const text = message.blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
      const toolCalls = message.blocks.flatMap((b) =>
        b.type === "tool_use" ? [{ id: b.id, name: b.name, args: { ...b.input }, type: "tool_call" as const }] : [],
      );
      messages.push(new AIMessage({ content: text, tool_calls: toolCalls }));
      continue;
    }
    for (const block of message.blocks) {
      if (block.type !== "tool_result") continue;
      messages.push(
        new ToolMessage({ content: block.content, tool_call_id: block.toolUseId, ...(block.isError && { status: "error" as const }) }),
      );
    }
    const text = message.blocks.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    if (text !== "") messages.push(new HumanMessage(text));
  }
  return messages;
}

/** Whether a graph state holds no conversation yet. */
export function threadIsEmpty(values: Record<string, unknown>): boolean {
  const messages = values["messages"];
  return !Array.isArray(messages) || messages.length === 0;
}
