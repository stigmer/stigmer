/**
 * The model the Claude engine talks to in a hermetic run: the conformance
 * suite's wire-level mock (`test/support/src/mock-llm.ts`), answering every
 * request from its conversation, behind the runner's real local proxy.
 *
 * There is no SDK double for this harness. The engine is the real program,
 * and a test scripts only what its model says: a {@link WireScript} reads the
 * conversation a request carries (the run's messages, the tool results, the
 * system prompt, the headers) and answers it. The engine makes its own
 * requests beside the agent loop (token counts) and replays a session's
 * history when it resumes, so a script answers from the conversation's
 * state, never from a queue: the same state gets the same answer however
 * often it arrives.
 *
 * The stack ({@link startClaudeWire}): the mock, and the production proxy
 * (`agent-proxy/server.ts`) in forward mode pointed at it, so every model
 * call the engine makes crosses the turn-credential rule, the Anthropic
 * lane's path rule and the forward relay exactly as in a cloud runner, and
 * arrives at the mock with the runner's credential and the run's execution
 * id. The proxy is handed to the hosted row (`__test-utils__/loopback-host.ts`).
 */

import { MockLlmProxy, type CapturedLlmRequest, type RoutableRequest, type RoutedResponse } from "@stigmer/test-support/mock-llm";
import { anthropicText, anthropicToolUses, type AnthropicMessageBody, type TokenUsageOptions } from "@stigmer/test-support/llm-wire";

import type { Config } from "../../../config.js";
import { AgentProxy } from "../../../agent-proxy/server.js";

export { anthropicText, anthropicToolUses, type AnthropicMessageBody, type TokenUsageOptions };

/** One tool result as a request carries it. */
export interface WireToolResult {
  readonly toolUseId: string;
  readonly text: string;
  readonly isError: boolean;
}

/** The conversation one request carries, read for a script. */
export interface WireConversation {
  readonly path: string;
  readonly model: string;
  /** The system prompt's text, its blocks joined. */
  readonly system: string;
  readonly toolNames: readonly string[];
  /** Every user text, oldest first, the engine's own reminders included. */
  readonly userTexts: readonly string[];
  /** The last message's tool results, when it is the user's. */
  readonly lastToolResults: readonly WireToolResult[];
  /** Every tool result in the conversation, by tool-use id. */
  readonly toolResults: ReadonlyMap<string, WireToolResult>;
  /** Every tool-use id an assistant message in the conversation issued. */
  readonly issued: ReadonlySet<string>;
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  readonly body: Readonly<Record<string, unknown>>;
}

/** What a script answers one agent-loop request with: a body, or a routed answer (an error, a hold). */
export type WireScript = (conversation: WireConversation) => AnthropicMessageBody | RoutedResponse;

/** The running stack: the mock, the proxy in front of it, and what each saw. */
export interface ClaudeWire {
  readonly mock: MockLlmProxy;
  readonly proxy: AgentProxy;
  /** Every agent-loop conversation the mock answered, in order. */
  readonly conversations: WireConversation[];
  /** Every request the mock received, its own capture. */
  requests(): readonly CapturedLlmRequest[];
  /** Replace the script for the requests that follow. */
  script(next: WireScript): void;
  close(): Promise<void>;
}

/** The token the proxy forwards with, standing for the runner's control-plane credential. */
export const WIRE_RUNNER_TOKEN = "hermetic-runner-token";

/** Start the mock and the proxy in front of it (the header), answering with `script`. */
export async function startClaudeWire(config: Config, script: WireScript, onRequest?: (conversation: WireConversation) => void): Promise<ClaudeWire> {
  let current = script;
  const conversations: WireConversation[] = [];
  const mock = new MockLlmProxy({
    route: (request: RoutableRequest) => {
      if (request.path.includes("count_tokens")) return { json: { input_tokens: 100 } };
      const conversation = readConversation(request);
      conversations.push(conversation);
      onRequest?.(conversation);
      const answer = current(conversation);
      return "type" in answer ? { body: answer } : answer;
    },
  });
  await mock.start();
  const proxy = await AgentProxy.start({ ...config, proxyEndpoint: mock.url(), stigmerTokenRef: { current: WIRE_RUNNER_TOKEN } });
  return {
    mock,
    proxy,
    conversations,
    requests: () => mock.requests(),
    script: (next) => {
      current = next;
    },
    close: async () => {
      await proxy.close();
      await mock.close();
    },
  };
}

/** A request's conversation, read structurally (the header). */
export function readConversation(request: RoutableRequest): WireConversation {
  const body = (typeof request.body === "object" && request.body !== null ? request.body : {}) as Record<string, unknown>;
  const messages = Array.isArray(body.messages) ? (body.messages as { role?: unknown; content?: unknown }[]) : [];
  const userTexts: string[] = [];
  const toolResults = new Map<string, WireToolResult>();
  const issued = new Set<string>();
  let lastToolResults: WireToolResult[] = [];
  messages.forEach((message, index) => {
    const blocks = Array.isArray(message.content) ? (message.content as Record<string, unknown>[]) : [{ type: "text", text: message.content }];
    const results: WireToolResult[] = [];
    for (const block of blocks) {
      if (message.role === "user" && block.type === "text" && typeof block.text === "string") userTexts.push(block.text);
      if (message.role === "assistant" && block.type === "tool_use" && typeof block.id === "string") issued.add(block.id);
      if (message.role === "user" && block.type === "tool_result" && typeof block.tool_use_id === "string") {
        const result = { toolUseId: block.tool_use_id, text: textOf(block.content), isError: block.is_error === true };
        results.push(result);
        toolResults.set(result.toolUseId, result);
      }
    }
    if (index === messages.length - 1 && message.role === "user") lastToolResults = results;
  });
  const tools = Array.isArray(body.tools) ? (body.tools as { name?: unknown }[]) : [];
  return {
    path: request.path,
    model: typeof body.model === "string" ? body.model : "",
    system: typeof body.system === "string" ? body.system : textOf(body.system),
    toolNames: tools.map((tool) => String(tool.name ?? "")),
    userTexts,
    lastToolResults,
    toolResults,
    issued,
    headers: request.headers,
    body,
  };
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) => {
      const b = block as { type?: unknown; text?: unknown; content?: unknown };
      if (b.type === "text" && typeof b.text === "string") return b.text;
      if (b.type === "tool_result") return textOf(b.content);
      return "";
    })
    .join("\n");
}

/** Whether a conversation carries `text` in any user message (the person's, or a mid-turn one). */
export function saidByUser(conversation: WireConversation, text: string): boolean {
  return conversation.userTexts.some((said) => said.includes(text));
}
