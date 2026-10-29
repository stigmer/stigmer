// How a test scripts the Claude engine's model on the wire mock.
// Domain: test support (model fakes).
//
// The Claude engine is a real program the runner starts, running its own
// loop, so the order of its model calls is the engine's, not the test's. It
// counts tokens beside the loop, compacts its conversation with a prompt of
// its own, runs sub-agents, and re-sends a session's whole history when it
// resumes. A FIFO cannot script it: a replay would be answered with the next
// step. So a test answers each request from the conversation it carries,
// and the same conversation state gets the same answer however often it
// arrives.
//
// This module is the one reading of the engine's requests, shared by the
// runner's hermetic suites (execute-claude/__test-utils__/claude-wire.ts and
// its contract subject) and the execution conformance suite's Claude arms:
//   - readConversation: one request as a script reads it (the user texts,
//     the tool results, what each assistant message issued, the headers);
//   - claudeEngineRoute: a router for MockLlmProxy (its constructor option,
//     or routeWith for one test) that answers the engine's background calls
//     out of band, a token count and its compaction summary, counted like
//     the mock counts the Stigmer harness's summaries and never handed to the script, and
//     hands every agent-loop request to the script.
//
// A background call the router does not know reaches the script, which
// answers it as a step; a new background call class is taught here, in one
// place, never in each script.
import { anthropicText, type AnthropicMessageBody } from "./llm-wire.ts";
import type { RoutableRequest, RoutedResponse } from "./mock-llm.ts";

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

/**
 * How the engine's own compaction asks the model for its summary (the
 * engine's prompt, SDK 0.3.310): a request carrying it is the engine
 * summarizing, never a step of a script.
 */
export const COMPACTION_PROMPT_MARK = "Your task is to create a detailed summary of the conversation so far";

/** The summary a compaction is answered with when the router is given none. */
export const MOCK_ENGINE_SUMMARY = "Summary (mock): the engine's conversation so far, condensed.";

/** The input tokens every token count answers. */
export const MOCK_TOKEN_COUNT = 100;

/** A request's conversation, read structurally. */
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

/** Whether a request is the engine summarizing its conversation (its compaction prompt). */
export function isCompaction(conversation: WireConversation): boolean {
  return conversation.userTexts.some((text) => text.includes(COMPACTION_PROMPT_MARK));
}

/** One request header's first value. */
export function headerOf(conversation: WireConversation, name: string): string | undefined {
  const value = conversation.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

export interface ClaudeEngineRouteOptions {
  /**
   * The summary a compaction is answered with, or how to write it from the
   * conversation being compacted (what a model would keep of it: the task,
   * what is done); {@link MOCK_ENGINE_SUMMARY} when unset.
   */
  readonly compactionSummary?: string | ((conversation: WireConversation) => string);
  /** Called with each compaction before it is answered: a script that tracks the engine's compactions per run reads them here. */
  readonly onCompaction?: (conversation: WireConversation) => void;
  /** Called with each agent-loop conversation before the script answers it. */
  readonly onConversation?: (conversation: WireConversation) => void;
}

/** A router for the Claude engine (the header), and what it answered out of band. */
export interface ClaudeEngineRoute {
  /** The router to install on a MockLlmProxy. */
  readonly route: (request: RoutableRequest) => RoutedResponse;
  /** The engine's compactions answered so far. */
  compactions(): number;
  /** The token counts answered so far. */
  tokenCounts(): number;
}

/** Build the router (the header): background calls out of band, every agent-loop request to `script`. */
export function claudeEngineRoute(script: WireScript, options: ClaudeEngineRouteOptions = {}): ClaudeEngineRoute {
  let compactions = 0;
  let tokenCounts = 0;
  const summaryOf = (conversation: WireConversation): string => {
    const summary = options.compactionSummary ?? MOCK_ENGINE_SUMMARY;
    return typeof summary === "string" ? summary : summary(conversation);
  };
  return {
    route: (request) => {
      if (request.path.includes("count_tokens")) {
        tokenCounts += 1;
        return { json: { input_tokens: MOCK_TOKEN_COUNT }, outOfBand: true };
      }
      const conversation = readConversation(request);
      if (isCompaction(conversation)) {
        compactions += 1;
        options.onCompaction?.(conversation);
        // The engine keeps what the <summary> tags hold; usage is zero, so a
        // run's sums are its script's alone.
        return { body: anthropicText(`<analysis>The conversation so far.</analysis>\n<summary>${summaryOf(conversation)}</summary>`, { inputTokens: 0, outputTokens: 0 }), outOfBand: true };
      }
      options.onConversation?.(conversation);
      const answer = script(conversation);
      return "type" in answer ? { body: answer } : answer;
    },
    compactions: () => compactions,
    tokenCounts: () => tokenCounts,
  };
}
