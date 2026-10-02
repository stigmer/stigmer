// LLM provider wire shapes shared by the two fakes that speak them.
// Domain: test support (model fakes).
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
// The Anthropic encoder was ported from the retired Go harness's
// mock_llm_proxy.go (git history); the OpenAI one mirrors what the
// Java proxy's OpenAiUsageExtractor and OpenAiJsonUsageExtractor parse (the
// usage-bearing final chunk that `stream_options.include_usage` requests).
//
// The REQUEST side of the Anthropic wire lives here too (readAnthropicRequest
// and its types): what the runner's @langchain/anthropic client puts in a
// `messages` body — the model, the system prompt as a string or as text blocks
// carrying cache breakpoints, the tool declarations with their JSON schemas,
// the thinking configuration. The request-shape facet asserts on it through
// the mock's captured bodies; keeping the reader beside the response builders
// makes this file the one place a change to either direction of the wire is
// made.
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
  | { type: "thinking"; thinking: string; signature?: string }
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
        // The provider closes every thinking block with its signature, which
        // the client must send back with the block when the conversation
        // continues; a block streamed without one is a shape the provider
        // never produces.
        event("content_block_start", { type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } });
        event("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "thinking_delta", thinking: block.thinking },
        });
        event("content_block_delta", {
          type: "content_block_delta",
          index,
          delta: { type: "signature_delta", signature: block.signature ?? MOCK_THINKING_SIGNATURE },
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

// ---------------------------------------------------------------------------
// The request side of the Anthropic wire
// ---------------------------------------------------------------------------

// One block of a system prompt sent as an array. The runner's deepagents
// engine assembles the system prompt from several blocks (the agent's own
// prompt, the framework's base prompt, one block per prompt-bearing
// middleware) and marks the last with a prompt-cache breakpoint; a client
// that sends one plain prompt sends `system` as a string instead. Anthropic's
// `cache_control` is carried as received — its shape is the provider's.
export interface AnthropicSystemBlock {
  type: "text";
  text: string;
  cache_control?: Record<string, unknown>;
}

// One tool as the model sees it: the name it calls, the description that
// steers when it calls, and the JSON schema of its arguments. Carried as
// received; the facet that pins the surface renders the schema verbatim.
export interface AnthropicToolDeclaration {
  name: string;
  description?: string;
  input_schema: unknown;
}

// The fields of a `messages` request the suites assert on. `messages` itself
// is deliberately not modelled: the conversation is the transcript facet's
// business, read from execution status, not from the wire. The one wire fact
// about it a suite needs is where a turn's own payload rides, which status
// cannot show (it records the message the user typed); `readLastUserText`
// reads exactly that.
export interface AnthropicRequestBody {
  model: string;
  system?: string | AnthropicSystemBlock[];
  tools?: AnthropicToolDeclaration[];
  // Anthropic's thinking configuration as the client sent it:
  // `{ type: "enabled", budget_tokens }`, `{ type: "adaptive", display }` or
  // an explicit `{ type: "disabled" }`; absent on a request that set none.
  // Carried as received so an arm asserts the exact shape a row maps to.
  thinking?: unknown;
  temperature?: number;
  max_tokens?: number;
  // The JSON-output configuration (`{ format: { type: "json_schema", schema } }`)
  // and the tool choice, as received: the structured-output strategy is read
  // from these two.
  output_config?: unknown;
  tool_choice?: unknown;
  stream?: boolean;
}

// The signature the mock closes a scripted thinking block with when the
// script names none.
export const MOCK_THINKING_SIGNATURE = "conformance-mock-signature";

// Reads a captured request body as an Anthropic `messages` request, refusing
// by name when it is not one (a fenced call's body, an embeddings body, a
// response written by mistake): a suite asserting on the request's shape
// must fail on the shape it did not expect, never on a downstream undefined.
export function readAnthropicRequest(body: unknown): AnthropicRequestBody {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new Error(`not an Anthropic messages body: expected an object, found ${describeValue(body)}`);
  }
  const record = body as Record<string, unknown>;
  if (typeof record.model !== "string" || !Array.isArray(record.messages)) {
    throw new Error(
      `not an Anthropic messages body: expected string \`model\` and array \`messages\`, ` +
        `found keys [${Object.keys(record).join(", ")}]`,
    );
  }
  return {
    model: record.model,
    ...(record.system !== undefined ? { system: readSystem(record.system) } : {}),
    ...(record.tools !== undefined ? { tools: readTools(record.tools) } : {}),
    ...(record.thinking !== undefined ? { thinking: record.thinking } : {}),
    ...(typeof record.temperature === "number" ? { temperature: record.temperature } : {}),
    ...(typeof record.max_tokens === "number" ? { max_tokens: record.max_tokens } : {}),
    ...(record.output_config !== undefined ? { output_config: record.output_config } : {}),
    ...(record.tool_choice !== undefined ? { tool_choice: record.tool_choice } : {}),
    ...(typeof record.stream === "boolean" ? { stream: record.stream } : {}),
  };
}

function readSystem(system: unknown): string | AnthropicSystemBlock[] {
  if (typeof system === "string") return system;
  if (!Array.isArray(system)) {
    throw new Error(`Anthropic \`system\` must be a string or an array of text blocks, found ${describeValue(system)}`);
  }
  return system.map((block, index) => {
    const candidate = block as { type?: unknown; text?: unknown; cache_control?: unknown } | null;
    if (typeof candidate !== "object" || candidate === null || candidate.type !== "text" || typeof candidate.text !== "string") {
      throw new Error(`Anthropic \`system[${index}]\` must be a text block, found ${describeValue(block)}`);
    }
    const shaped: AnthropicSystemBlock = { type: "text", text: candidate.text };
    if (candidate.cache_control !== undefined) {
      if (typeof candidate.cache_control !== "object" || candidate.cache_control === null) {
        throw new Error(`Anthropic \`system[${index}].cache_control\` must be an object, found ${describeValue(candidate.cache_control)}`);
      }
      shaped.cache_control = candidate.cache_control as Record<string, unknown>;
    }
    return shaped;
  });
}

function readTools(tools: unknown): AnthropicToolDeclaration[] {
  if (!Array.isArray(tools)) {
    throw new Error(`Anthropic \`tools\` must be an array, found ${describeValue(tools)}`);
  }
  return tools.map((tool, index) => {
    const candidate = tool as { name?: unknown; description?: unknown; input_schema?: unknown } | null;
    if (typeof candidate !== "object" || candidate === null || typeof candidate.name !== "string") {
      throw new Error(`Anthropic \`tools[${index}]\` must carry a string \`name\`, found ${describeValue(tool)}`);
    }
    if (candidate.description !== undefined && typeof candidate.description !== "string") {
      throw new Error(`Anthropic \`tools[${index}].description\` must be a string when present, found ${describeValue(candidate.description)}`);
    }
    return {
      name: candidate.name,
      ...(candidate.description !== undefined ? { description: candidate.description } : {}),
      input_schema: candidate.input_schema,
    };
  });
}

// The text of a captured request's LAST user message, its text blocks joined
// by a newline (an image block contributes nothing). On a turn's first model
// call that message is the turn's own: what the runner composed around what
// the user typed. Refuses by name when the body has no user message.
export function readLastUserText(body: unknown): string {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) {
    throw new Error(`not an Anthropic messages body: found ${describeValue(body)}`);
  }
  const last = [...messages].reverse().find((message) => (message as { role?: unknown } | null)?.role === "user") as
    | { content?: unknown }
    | undefined;
  if (last === undefined) {
    throw new Error(`the request carries no user message among its ${messages.length}`);
  }
  if (typeof last.content === "string") return last.content;
  if (!Array.isArray(last.content)) {
    throw new Error(`a user message's content must be a string or blocks, found ${describeValue(last.content)}`);
  }
  return last.content
    .filter((block): block is { type: "text"; text: string } => {
      const candidate = block as { type?: unknown; text?: unknown } | null;
      return candidate?.type === "text" && typeof candidate.text === "string";
    })
    .map((block) => block.text)
    .join("\n");
}

// The shape of a captured request's conversation, one entry per message: its
// role and its content block types in order (a string content reads as one
// `text` block). No text is carried: a suite asks where a turn rides and what
// kind it is, never what it says. It is the wire's own view of the order the
// providers enforce (a `tool_use` answered by the next user turn's
// `tool_result` blocks, text after them), which the transcript in status
// cannot show for what never enters it, such as the runner's advisories.
// Refuses by name when the body has no `messages` or a message is malformed.
export interface TurnShape {
  role: string;
  blocks: string[];
}

export function readTurnShapes(body: unknown): TurnShape[] {
  const messages = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(messages)) {
    throw new Error(`not an Anthropic messages body: found ${describeValue(body)}`);
  }
  return messages.map((message, index) => {
    const { role, content } = (message ?? {}) as { role?: unknown; content?: unknown };
    if (typeof role !== "string") {
      throw new Error(`message ${index} has no string role: found ${describeValue(message)}`);
    }
    if (typeof content === "string") return { role, blocks: ["text"] };
    if (!Array.isArray(content)) {
      throw new Error(`message ${index}'s content must be a string or blocks, found ${describeValue(content)}`);
    }
    return { role, blocks: content.map((block) => String((block as { type?: unknown } | null)?.type)) };
  });
}

// A short, safe description of a value for a refusal message: the type, and
// for a small scalar its text, never a whole body.
function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `an array of ${value.length}`;
  if (typeof value === "object") return `an object with keys [${Object.keys(value).join(", ")}]`;
  if (typeof value === "string") return `a string ${JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value)}`;
  return `${typeof value} ${String(value)}`;
}
