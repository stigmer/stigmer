/**
 * Session Memory Extraction — builds durable conversation state from
 * completed execution turns.
 *
 * SessionMemory survives Cursor agent eviction, process restarts, and
 * SDK "agent not found" failures. When a fresh agent is created, the
 * continuation prompt (built by Task 2b) uses this memory to give the
 * new agent full context of the prior conversation.
 *
 * Design: Structured extraction, not LLM summarization. This module
 * parses the finalized AgentMessage array (produced by MessageAccumulator)
 * and extracts structured fields — changed files, tool observations,
 * recent turns, decisions, failed attempts, and open tasks.
 *
 * Extraction runs once after execution completes (not during streaming),
 * so it has access to the complete, finalized message array with all
 * tool calls attached and all streaming markers cleared.
 *
 * Token budgets are enforced at persist-time using character-based
 * approximation (~4 chars/token). This avoids a tokenizer dependency
 * for v1's structured extraction output.
 */

import { create } from "@bufbuild/protobuf";
import {
  SessionMemorySchema,
  ToolObservationSchema,
  ConversationTurnSchema,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb";
import type {
  SessionMemory,
  ToolObservation,
  ConversationTurn,
} from "@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { TodoItem } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/todo_pb";
import { MessageType, ToolCallStatus, TodoStatus } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { StigmerClient } from "../client/stigmer-client.js";
import { utcTimestamp } from "./message-translator.js";

// ---------------------------------------------------------------------------
// Token budget constants
// ---------------------------------------------------------------------------

const CHARS_PER_TOKEN = 4;
const MAX_SUMMARY_TOKENS = 1_000;
const MAX_TURNS_TOKENS = 3_000;
const MAX_OBSERVATIONS_TOKENS = 500;
const MAX_TURN_TOKENS = 800;
const MAX_RECENT_TURNS = 4;
const MAX_OBSERVATIONS = 5;
const MAX_DECISIONS = 15;
const MAX_FAILED_ATTEMPTS = 10;
const MAX_OBSERVATION_SUMMARY_CHARS = 150;
const MAX_FAILED_ATTEMPT_CHARS = 150;

/**
 * Tool names that represent file mutations. When a completed tool call
 * uses one of these names, its `path` argument is captured in
 * `changed_files`.
 */
const FILE_MUTATION_TOOLS = new Set([
  "Write",
  "Edit",
  "StrReplace",
  "Delete",
  "EditNotebook",
]);

/**
 * Regex matching explicit decision markers at the start of a line.
 * Only high-signal patterns to avoid false positives from conversational
 * language. Forward-compatible with Task 2b prompt engineering that can
 * instruct agents to use these markers.
 */
const DECISION_MARKER = /^\s*(?:Decision|Design choice)\s*:\s*(.+)/i;

// ---------------------------------------------------------------------------
// Token budget utilities
// ---------------------------------------------------------------------------

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function truncateToTokenBudget(text: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  if (text.length <= maxChars) return text;
  return "[truncated] " + text.slice(-maxChars);
}

// ---------------------------------------------------------------------------
// Extraction functions
// ---------------------------------------------------------------------------

/**
 * Scan finalized messages for tool calls that mutated files and return
 * a deduplicated, sorted list of file paths.
 */
export function extractChangedFiles(messages: AgentMessage[]): string[] {
  const paths = new Set<string>();

  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (!FILE_MUTATION_TOOLS.has(tc.name)) continue;
      if (tc.status !== ToolCallStatus.TOOL_CALL_COMPLETED) continue;

      const filePath = parsePathFromArgs(tc);
      if (filePath) paths.add(filePath);
    }
  }

  return [...paths].sort();
}

/**
 * Extract significant shell command observations from tool calls.
 *
 * Only completed or failed Shell commands are captured — read-only tools
 * (Read, Glob, Grep) are not meaningful for continuation context.
 *
 * Returns at most MAX_OBSERVATIONS entries (most recent), enforcing the
 * token budget by truncating observation summaries.
 */
export function extractToolObservations(messages: AgentMessage[]): ToolObservation[] {
  const observations: ToolObservation[] = [];

  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.name !== "Shell") continue;
      if (
        tc.status !== ToolCallStatus.TOOL_CALL_COMPLETED &&
        tc.status !== ToolCallStatus.TOOL_CALL_FAILED
      ) continue;

      const args = parseArgsPreview(tc.argsPreview);
      const command = args.command ?? args.description ?? "";
      if (!command) continue;

      const cwd = args.working_directory ?? args.cwd ?? "";
      const exitCode = tc.status === ToolCallStatus.TOOL_CALL_FAILED ? 1 : 0;
      const summary = (tc.result || tc.error || "").slice(0, MAX_OBSERVATION_SUMMARY_CHARS);

      observations.push(create(ToolObservationSchema, {
        command: String(command),
        cwd: String(cwd),
        exitCode,
        summary,
      }));
    }
  }

  const pruned = observations.slice(-MAX_OBSERVATIONS);
  return enforceObservationsTokenBudget(pruned);
}

/**
 * Build the recent conversation turns list by merging previous turns
 * with the current execution's user message and assistant response.
 *
 * FIFO-prunes to MAX_RECENT_TURNS entries. Each turn is individually
 * truncated to MAX_TURN_TOKENS, then the total is capped at
 * MAX_TURNS_TOKENS.
 */
export function extractRecentTurns(
  userMessage: string,
  messages: AgentMessage[],
  previousTurns: ConversationTurn[],
): ConversationTurn[] {
  const turns = [...previousTurns];

  if (userMessage) {
    turns.push(create(ConversationTurnSchema, {
      role: "user",
      content: truncateToTokenBudget(userMessage, MAX_TURN_TOKENS),
      timestamp: utcTimestamp(),
    }));
  }

  const assistantContent = messages
    .filter((m) => m.type === MessageType.MESSAGE_AI)
    .map((m) => m.content)
    .join("\n\n");

  if (assistantContent) {
    turns.push(create(ConversationTurnSchema, {
      role: "assistant",
      content: truncateToTokenBudget(assistantContent, MAX_TURN_TOKENS),
      timestamp: utcTimestamp(),
    }));
  }

  const pruned = turns.slice(-MAX_RECENT_TURNS);
  return enforceTurnsTokenBudget(pruned);
}

/**
 * Scan assistant messages for explicit decision markers and merge
 * with previous decisions.
 *
 * Only captures lines that start with "Decision:" or "Design choice:"
 * (case-insensitive). This avoids false positives from conversational
 * language like "I decided to read the file."
 */
export function extractDecisions(
  messages: AgentMessage[],
  previousDecisions: string[],
): string[] {
  const newDecisions: string[] = [];

  for (const msg of messages) {
    if (msg.type !== MessageType.MESSAGE_AI) continue;

    for (const line of msg.content.split("\n")) {
      const match = DECISION_MARKER.exec(line);
      if (match?.[1]) {
        newDecisions.push(match[1].trim());
      }
    }
  }

  const combined = [...previousDecisions];
  for (const d of newDecisions) {
    if (!combined.includes(d)) {
      combined.push(d);
    }
  }

  if (combined.length > MAX_DECISIONS) {
    return combined.slice(-MAX_DECISIONS);
  }
  return combined;
}

/**
 * Extract failed tool call descriptions and merge with previous failures.
 *
 * Each failed attempt is formatted as "ToolName: error message" to give
 * the continuation agent concise context about what went wrong.
 */
export function extractFailedAttempts(
  messages: AgentMessage[],
  previousAttempts: string[],
): string[] {
  const newAttempts: string[] = [];

  for (const msg of messages) {
    for (const tc of msg.toolCalls) {
      if (tc.status !== ToolCallStatus.TOOL_CALL_FAILED) continue;

      const errorDetail = tc.error || tc.result || "unknown error";
      const entry = `${tc.name}: ${errorDetail}`.slice(0, MAX_FAILED_ATTEMPT_CHARS);
      newAttempts.push(entry);
    }
  }

  const combined = [...previousAttempts];
  for (const a of newAttempts) {
    if (!combined.includes(a)) {
      combined.push(a);
    }
  }

  if (combined.length > MAX_FAILED_ATTEMPTS) {
    return combined.slice(-MAX_FAILED_ATTEMPTS);
  }
  return combined;
}

/**
 * Extract outstanding tasks from the current TodoTracker state.
 *
 * Only pending and in-progress items are included. Completed and
 * cancelled items are filtered out. Unlike other fields, open tasks
 * are NOT merged with previous memory — they reflect the current
 * execution's final state.
 */
export function extractOpenTasks(
  todos: { [key: string]: TodoItem },
): string[] {
  return Object.values(todos)
    .filter(
      (t) =>
        t.status === TodoStatus.TODO_PENDING ||
        t.status === TodoStatus.TODO_IN_PROGRESS,
    )
    .map((t) => t.content);
}

/**
 * Build a durable summary from the last assistant message.
 *
 * The final assistant message typically contains a summary of what was
 * accomplished and any remaining work. If no assistant messages exist
 * (e.g., immediate error), the previous summary is carried forward.
 */
export function buildDurableSummary(
  messages: AgentMessage[],
  previousSummary: string,
): string {
  const aiMessages = messages.filter((m) => m.type === MessageType.MESSAGE_AI);
  if (aiMessages.length === 0) return previousSummary;

  const lastAiContent = aiMessages[aiMessages.length - 1].content;
  if (!lastAiContent) return previousSummary;

  return truncateToTokenBudget(lastAiContent, MAX_SUMMARY_TOKENS);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export interface BuildSessionMemoryOptions {
  previousMemory: SessionMemory | undefined;
  messages: AgentMessage[];
  todos: { [key: string]: TodoItem };
  userMessage: string;
}

/**
 * Build a complete SessionMemory proto by extracting structured data
 * from the current execution and merging with previous memory.
 *
 * This is the single entry point called by execute-cursor.ts after
 * each completed execution turn (success or failure).
 */
export function buildSessionMemory(options: BuildSessionMemoryOptions): SessionMemory {
  const prev = options.previousMemory;

  return create(SessionMemorySchema, {
    durableSummary: buildDurableSummary(
      options.messages,
      prev?.durableSummary ?? "",
    ),
    changedFiles: extractChangedFiles(options.messages),
    openTasks: extractOpenTasks(options.todos),
    toolObservations: extractToolObservations(options.messages),
    recentTurns: extractRecentTurns(
      options.userMessage,
      options.messages,
      prev?.recentTurns ?? [],
    ),
    decisions: extractDecisions(
      options.messages,
      prev?.decisions ?? [],
    ),
    failedAttempts: extractFailedAttempts(
      options.messages,
      prev?.failedAttempts ?? [],
    ),
  });
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Persist session memory via the atomic updateSessionMemory RPC.
 *
 * This uses a dedicated field-level update that atomically sets only
 * status.session_memory on the server — no read-before-write, no race
 * with concurrent subject generation or thread_id writes.
 *
 * Errors are logged and swallowed — memory loss is acceptable (next
 * execution will rebuild from whatever is available), but execution
 * failure is not.
 */
export async function persistSessionMemory(
  client: StigmerClient,
  sessionId: string,
  memory: SessionMemory,
): Promise<void> {
  try {
    await client.updateSessionMemory(sessionId, memory);
    console.log(
      `Session memory persisted: session=${sessionId}, ` +
      `turns=${memory.recentTurns.length}, ` +
      `files=${memory.changedFiles.length}, ` +
      `observations=${memory.toolObservations.length}`,
    );
  } catch (err) {
    console.warn(
      `Failed to persist session memory for ${sessionId} (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}
// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse the `argsPreview` string from a ToolCall into a key-value object.
 * Handles JSON strings, raw strings, and null gracefully.
 */
function parseArgsPreview(argsPreview: string): Record<string, unknown> {
  if (!argsPreview) return {};
  try {
    const parsed = JSON.parse(argsPreview);
    if (typeof parsed === "object" && parsed !== null) return parsed;
  } catch {
    // argsPreview is not valid JSON — return empty
  }
  return {};
}

/**
 * Extract the file path from a tool call's arguments.
 *
 * File mutation tools use `path` (Write, Edit, StrReplace, Delete)
 * or `target_notebook` (EditNotebook).
 */
function parsePathFromArgs(tc: ToolCall): string {
  const args = parseArgsPreview(tc.argsPreview);
  const path = args.path ?? args.target_notebook;
  return typeof path === "string" ? path : "";
}

/**
 * Enforce the total token budget across all tool observations by
 * progressively truncating summaries from oldest to newest.
 */
function enforceObservationsTokenBudget(observations: ToolObservation[]): ToolObservation[] {
  let totalTokens = observations.reduce(
    (sum, o) => sum + estimateTokens(`${o.command} ${o.cwd} ${o.summary}`),
    0,
  );

  if (totalTokens <= MAX_OBSERVATIONS_TOKENS) return observations;

  const result = [...observations];
  for (let i = 0; i < result.length && totalTokens > MAX_OBSERVATIONS_TOKENS; i++) {
    const obs = result[i];
    const oldContent = `${obs.command} ${obs.cwd} ${obs.summary}`;
    const oldTokens = estimateTokens(oldContent);

    result[i] = create(ToolObservationSchema, {
      command: obs.command,
      cwd: obs.cwd,
      exitCode: obs.exitCode,
      summary: obs.summary.slice(0, 50),
    });

    const newContent = `${result[i].command} ${result[i].cwd} ${result[i].summary}`;
    totalTokens -= oldTokens - estimateTokens(newContent);
  }

  return result;
}

/**
 * Enforce the total token budget across all conversation turns by
 * removing the oldest turns until the budget is met.
 */
function enforceTurnsTokenBudget(turns: ConversationTurn[]): ConversationTurn[] {
  let totalTokens = turns.reduce((sum, t) => sum + estimateTokens(t.content), 0);
  const result = [...turns];

  while (result.length > 0 && totalTokens > MAX_TURNS_TOKENS) {
    const removed = result.shift()!;
    totalTokens -= estimateTokens(removed.content);
  }

  return result;
}
