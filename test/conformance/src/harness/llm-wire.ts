// LLM provider wire shapes shared by the two fakes that speak them.
// Domain: conformance harness (LLM fixtures).
//
// Two fixtures emit provider responses: MockLlmProxy (mock-llm.ts) stands in
// for the PROXY the runner dials, and FakeLlmUpstream (fake-llm-upstream.ts)
// stands in for the PROVIDER behind the real proxy. The proxy is transparent,
// so the bytes both must produce are the same bytes — Anthropic's `messages`
// SSE sequence, OpenAI's `chat.completion.chunk` SSE sequence with its final
// usage chunk, and the plain-JSON non-streaming bodies. They live here once,
// so a change to either fake's understanding of a provider cannot drift from
// the other's.
//
// The Anthropic encoder mirrors the Go reference in
// test/integration/harness/mock_llm_proxy.go; the OpenAI one mirrors what the
// Java proxy's OpenAiUsageExtractor and OpenAiJsonUsageExtractor parse (the
// usage-bearing final chunk that `stream_options.include_usage` requests).
import type { ServerResponse } from "node:http";

// An Anthropic message body, in the shape the provider's `messages` endpoint
// returns. The SSE encoder expands this into the streaming event sequence.
export interface AnthropicMessageBody {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: AnthropicUsage;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };

export interface TokenUsageOptions {
  inputTokens?: number;
  outputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

function anthropicUsage(usage: TokenUsageOptions): AnthropicUsage {
  const shaped: AnthropicUsage = {
    input_tokens: usage.inputTokens ?? 10,
    output_tokens: usage.outputTokens ?? 5,
  };
  if (usage.cacheCreationInputTokens !== undefined) shaped.cache_creation_input_tokens = usage.cacheCreationInputTokens;
  if (usage.cacheReadInputTokens !== undefined) shaped.cache_read_input_tokens = usage.cacheReadInputTokens;
  return shaped;
}

// A canned Anthropic text turn that ends the agent loop (stop_reason end_turn).
// The model name maps to the Anthropic provider path; token counts default to
// cosmetic values and are set explicitly by the usage-extraction arms.
export function anthropicText(text: string, usage: TokenUsageOptions = {}): AnthropicMessageBody {
  return {
    id: `msg_mock_${usage.inputTokens ?? 10}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage: anthropicUsage(usage),
  };
}

// One tool_use block in a multi-call turn.
export interface ToolUseBlock {
  toolCallId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

// A canned Anthropic tool_use turn (stop_reason tool_use). The agent will
// dispatch the named tool; queue a following text turn for the post-tool
// response.
export function anthropicToolUse(
  toolCallId: string,
  toolName: string,
  toolInput: Record<string, unknown>,
  usage: TokenUsageOptions = {},
): AnthropicMessageBody {
  return anthropicToolUses([{ toolCallId, toolName, toolInput }], usage);
}

// A canned Anthropic turn with one or more tool_use blocks (stop_reason
// tool_use). Multiple blocks model parallel tool calls in a single assistant
// turn, so they are dispatched together and — when each is approval-gated —
// become co-pending approvals at once. That is the lever for the APPROVE_ALL
// contract (resolve every co-pending gate with a single decision).
export function anthropicToolUses(blocks: ToolUseBlock[], usage: TokenUsageOptions = {}): AnthropicMessageBody {
  return {
    id: `msg_mock_${usage.inputTokens ?? 10}`,
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: blocks.map((b) => ({
      type: "tool_use" as const,
      id: b.toolCallId,
      name: b.toolName,
      input: b.toolInput,
    })),
    stop_reason: "tool_use",
    usage: anthropicUsage(usage),
  };
}

// The SSE frame both providers use: an optional event name, one JSON data line.
export function writeSseFrame(res: ServerResponse, data: unknown, eventName?: string): void {
  const head = eventName === undefined ? "" : `event: ${eventName}\n`;
  res.write(`${head}data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

// Expands an Anthropic message body into the SSE event sequence the
// @langchain/anthropic streaming parser (and the Java proxy's
// AnthropicUsageExtractor) expect, flushing each event.
export function writeAnthropicSse(res: ServerResponse, body: AnthropicMessageBody): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  writeAnthropicSseEvents(res, body);
  res.end();
}

// The event sequence without the head/end, so a fixture can cut the stream
// short after N events (the upstream-aborted-mid-stream arm).
export function writeAnthropicSseEvents(res: ServerResponse, body: AnthropicMessageBody, limit = Infinity): void {
  let written = 0;
  const event = (name: string, data: unknown): void => {
    if (written >= limit) return;
    written += 1;
    writeSseFrame(res, data, name);
  };

  event("message_start", {
    type: "message_start",
    message: {
      id: body.id,
      type: "message",
      role: "assistant",
      content: [],
      model: body.model,
      stop_reason: null,
      stop_sequence: null,
      usage: { ...body.usage, output_tokens: 0 },
    },
  });

  body.content.forEach((block, index) => {
    switch (block.type) {
      case "text":
        event("content_block_start", { type: "content_block_start", index, content_block: { type: "text", text: "" } });
        event("content_block_delta", { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
        event("content_block_stop", { type: "content_block_stop", index });
        break;
      case "thinking":
        event("content_block_start", { type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } });
        event("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "thinking_delta", thinking: block.thinking },
        });
        event("content_block_stop", { type: "content_block_stop", index });
        break;
      case "tool_use":
        event("content_block_start", {
          type: "content_block_start",
          index,
          content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
        });
        event("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
        });
        event("content_block_stop", { type: "content_block_stop", index });
        break;
      default: {
        const exhaustive: never = block;
        throw new Error(`unknown Anthropic content block: ${JSON.stringify(exhaustive)}`);
      }
    }
  });

  event("message_delta", {
    type: "message_delta",
    delta: { stop_reason: body.stop_reason, stop_sequence: null },
    usage: { output_tokens: body.usage.output_tokens },
  });
  event("message_stop", { type: "message_stop" });
}

// An OpenAI chat completion, in the shape the provider's non-streaming
// `chat/completions` endpoint returns; the SSE encoder chunks it.
export interface OpenAiChatCompletionBody {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string };
    finish_reason: "stop" | "tool_calls" | "length";
  }>;
  usage: OpenAiUsage;
}

export interface OpenAiUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: { cached_tokens: number };
}

export function openAiText(text: string, usage: TokenUsageOptions = {}): OpenAiChatCompletionBody {
  const prompt = usage.inputTokens ?? 10;
  const completion = usage.outputTokens ?? 5;
  const shaped: OpenAiUsage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
  if (usage.cacheReadInputTokens !== undefined) shaped.prompt_tokens_details = { cached_tokens: usage.cacheReadInputTokens };
  return {
    id: `chatcmpl_mock_${prompt}`,
    object: "chat.completion",
    created: 1_700_000_000,
    model: "gpt-4.1",
    choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
    usage: shaped,
  };
}

// Streams an OpenAI completion as `chat.completion.chunk` frames: role, the
// content, the finish, then — as `stream_options.include_usage` requests — one
// final chunk with empty choices carrying `usage`, then `[DONE]`. Setting
// includeUsage false models an upstream that was NOT asked for usage (the
// proxy injects the option; the arm asserts it did).
export function writeOpenAiSse(res: ServerResponse, body: OpenAiChatCompletionBody, includeUsage = true): void {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  const chunk = (delta: Record<string, unknown>, finish: string | null): void => {
    writeSseFrame(res, {
      id: body.id,
      object: "chat.completion.chunk",
      created: body.created,
      model: body.model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    });
  };
  chunk({ role: "assistant", content: "" }, null);
  for (const choice of body.choices) chunk({ content: choice.message.content }, null);
  chunk({}, body.choices[0]?.finish_reason ?? "stop");
  if (includeUsage) {
    writeSseFrame(res, { id: body.id, object: "chat.completion.chunk", created: body.created, model: body.model, choices: [], usage: body.usage });
  }
  writeSseFrame(res, "[DONE]");
  res.end();
}

export function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}
