/**
 * What the model sees of a long tool result, and where the whole of it is
 * kept.
 *
 * Every tool result passes here (wrapToolCall). One within the bound, the
 * run's `max_tool_result_chars` (default 30,000 characters, ~7,500 tokens),
 * is untouched. A longer one keeps its START and its END, with one gap line
 * between them saying how much was left out and where the rest is.
 *
 * WHY THE START AND THE END
 * -------------------------
 * A command's verdict is at its end: the failing tests, the error a build
 * printed last, stderr and the exit status (`shell-tool.ts` writes them after
 * stdout). A document's or a JSON payload's shape is at its start. Before
 * this, the result kept its first 30,000 characters alone, so a long command
 * lost its verdict and the agent ran it again with `| tail`. Half and half,
 * cut at line ends (`shared/text-cut.ts`), serves both kinds with one rule.
 * deepagents' own preview (`createContentPreview`, head and tail) is the
 * precedent; OpenCode chose per tool (the head for most, the tail for bash),
 * which costs a rule per tool to keep what one rule keeps.
 *
 * WHY THE WHOLE RESULT IS KEPT, AND WHERE
 * ---------------------------------------
 * Through the graph's own file backend, at `/large_tool_results/<call>.txt`:
 * deepagents' offload root, which `platform-route.ts` routes to the
 * session's offload directory, outside the workspace and outside file review
 * (`routesOffloads`). The gap line names that path; the agent reads the
 * middle back with `read_file` (offset and limit) or `grep` instead of
 * re-running anything, and `read_file` reaches the route even when an
 * agent's lists exclude `Read` (`tool-scope.ts`). The write is the runner's,
 * not a tool call: no approval card, no review entry, as for deepagents' own
 * offload. A backend that does not route the root (a session without a
 * platform dir, a unit test), or a failed write, keeps nothing: the result
 * is cut the same way and the gap line says the rest could not be kept.
 * Nothing is ever written into the workspace.
 *
 * WHICH RESULTS ARE KEPT
 * ----------------------
 * Every tool's except those that page themselves ({@link NARROW_A_CALL}):
 * `read_file`, `grep`, `glob` and `ls` over files still on disk, `web_fetch`
 * over a page it windows by `start_index`. Their source can be read again a
 * window at a time, so a copy would only duplicate it; their gap line says
 * how to narrow the call instead. deepagents exempts its file tools from its
 * offload and OpenCode lets a tool that bounds itself opt out the same way.
 * The shell, MCP tools, a sub-agent's report (`task`) and every other tool
 * are kept.
 *
 * WHY A KEPT TOOL'S BOUND STOPS AT 80,000
 * --------------------------------------
 * deepagents' filesystem middleware is the outer layer and offloads any
 * result over {@link DEEPAGENTS_OFFLOAD_THRESHOLD_CHARS} itself, with its own
 * message and a ten-line preview; `createDeepAgent` passes it no threshold,
 * so the number is fixed. A tool it would offload is cut here at no more
 * than that, so nothing reaches it over its threshold and one mechanism, with
 * one message, governs every long result. Above 80,000 the run's setting had
 * no effect for those tools before either. The tools deepagents never
 * offloads ({@link DEEPAGENTS_NEVER_OFFLOADS}) keep the run's bound as given.
 * deepagents measures a result's non-text blocks too, each as its JSON
 * ({@link deepagentsMediaChars}), so their length comes off the text's room
 * under the threshold. Were the text cut without it, deepagents would still
 * offload the result, to the same file name, overwriting the whole text kept
 * here with the cut one. A result whose non-text blocks leave less than
 * {@link MIN_TEXT_ROOM_CHARS} of room is left to deepagents whole, as before.
 *
 * EVERY SHAPE A TOOL RETURNS
 * --------------------------
 * A `ToolMessage` with string content; one whose content is an array of
 * blocks (an MCP result with several blocks or structured content), measured
 * by its text blocks, which become one cut text block beside the non-text
 * blocks kept as they are (deepagents' `buildEvictedHumanContent`); and a
 * `Command` (deepagents' `task` returns one), whose tool messages are cut and
 * whose other updates are untouched (deepagents' own `wrapToolCall`). A cut
 * message keeps every field of the original: a failed tool's `status`, an MCP
 * result's `artifact`, its `id` and `metadata`. Messages are recognised with
 * `ToolMessage.isInstance` and `isCommand`, which a second copy of
 * `@langchain/core` does not defeat as `instanceof` would.
 *
 * THE GAP LINE
 * ------------
 * Model-facing text, so a prompt: its words live in {@link GAP_LINE} alone.
 * It gives the count and the line range left out, so the agent can read
 * exactly that part, and is always kept whole: the whole message, gap line
 * included, stays within the bound, except a bound smaller than the gap line
 * itself (the contract allows any positive value), which leaves the gap line
 * alone. No tool description mentions any of this; the pointer is read
 * exactly when it matters.
 *
 * The person's view is not this: a tool row's result is the tool's own
 * output (`translator.ts`, from the tool run's callback), not what the model
 * is handed here.
 */

import { createHash } from "node:crypto";
import { ToolMessage, type MessageContent } from "@langchain/core/messages";
import { Command, isCommand } from "@langchain/langgraph";
import type { AnyBackendProtocol } from "deepagents";
import { DEEPAGENTS_OFFLOAD_ROOT, routesOffloads } from "../activities/execute-deep-agent/platform-route.js";
import { ENGINE_TOOL } from "../activities/execute-deep-agent/engine-tools.js";
import { WEB_FETCH_TOOL_NAME } from "../tools/web-fetch-tool.js";
import { headCutIndex, tailCutIndex } from "../shared/text-cut.js";
import type {
  StigmerMiddleware,
  ToolCallRequest,
  ToolTruncationConfig,
} from "./types.js";

const DEFAULT_MAX_CHARS = 30_000;

/**
 * deepagents' (1.14) offload threshold: `toolTokenLimitBeforeEvict`, 20,000
 * tokens at 4 characters each, fixed by `createDeepAgent` (the header).
 */
export const DEEPAGENTS_OFFLOAD_THRESHOLD_CHARS = 80_000;

/**
 * deepagents' (1.14) `TOOLS_EXCLUDED_FROM_EVICTION`, its file tools, which its
 * offload never touches. Not exported upstream. `delete` is its tool too,
 * bound when the backend can delete; no prompt names it, so it is not in
 * `ENGINE_TOOL`.
 */
const DEEPAGENTS_NEVER_OFFLOADS: ReadonlySet<string> = new Set([
  ENGINE_TOOL.ls,
  ENGINE_TOOL.readFile,
  ENGINE_TOOL.writeFile,
  ENGINE_TOOL.editFile,
  "delete",
  ENGINE_TOOL.glob,
  ENGINE_TOOL.grep,
]);

/**
 * The least room under deepagents' threshold worth cutting a text into. A gap
 * line is under 400 characters (every number at seven digits, a 128-byte
 * file name), so below this the cut text could still pass the threshold;
 * such a result, almost all non-text blocks, is left to deepagents whole.
 */
const MIN_TEXT_ROOM_CHARS = 1_000;

/** What was left out of a cut result, for the gap line. Lines are 1-based. */
export interface Omission {
  readonly chars: number;
  readonly firstLine: number;
  readonly lastLine: number;
  readonly totalLines: number;
}

function leftOut(omission: Omission): string {
  return (
    `… ${omission.chars} characters omitted ` +
    `(lines ${omission.firstLine}–${omission.lastLine} of ${omission.totalLines})`
  );
}

/** The gap line's words, the one home of this module's model-facing text (the header). */
export const GAP_LINE = {
  /** The whole result is kept at `path`. */
  kept: (omission: Omission, path: string): string =>
    `[${leftOut(omission)}. The whole result is kept at ${path}: ` +
    `read_file it from offset ${omission.firstLine - 1}, or grep it.]`,
  /** A tool that pages itself: how to narrow the call. */
  narrow: (omission: Omission, how: string): string => `[${leftOut(omission)}. ${how}]`,
  /** Nothing could be kept. */
  notKept: (omission: Omission): string =>
    `[${leftOut(omission)}. The whole result could not be kept; narrow the call to see this part.]`,
} as const;

/**
 * The tools that page themselves, each with how its gap line tells the model
 * to narrow a call (the header). A result of one is cut, never kept.
 */
export const NARROW_A_CALL: ReadonlyMap<string, string> = new Map([
  [ENGINE_TOOL.readFile, "To see this part, call read_file again with a smaller limit."],
  [ENGINE_TOOL.grep, "To see this part, narrow the grep with a path or a glob."],
  [ENGINE_TOOL.glob, "To see this part, narrow the pattern or the path."],
  [ENGINE_TOOL.ls, "To see this part, list a deeper path."],
  [WEB_FETCH_TOOL_NAME, "To see this part, call web_fetch again with a start_index and a smaller max_length."],
]);

/** The longest a call id's file name may be, in UTF-8 bytes (deepagents' limit). */
const MAX_FILE_STEM_BYTES = 128;

/**
 * The kept file's name for a call: the id made path-safe as deepagents'
 * `sanitizeToolCallId` (1.14, not exported) does, so both write the same
 * name for the same call. An id too long for a file name is hashed where
 * deepagents draws a random one, so a retried call rewrites its own file.
 */
export function keptResultPath(toolCallId: string): string {
  const safe = toolCallId.replace(/[./\\]/g, "_");
  const stem = safe.length > 0 && Buffer.byteLength(safe, "utf8") <= MAX_FILE_STEM_BYTES
    ? safe
    : `call-${createHash("sha256").update(toolCallId).digest("hex").slice(0, 32)}`;
  return `${DEEPAGENTS_OFFLOAD_ROOT}${stem}.txt`;
}

/** The 1-based line `index` falls in. */
function lineAt(text: string, index: number): number {
  let line = 1;
  for (let at = text.indexOf("\n"); at >= 0 && at < index; at = text.indexOf("\n", at + 1)) line++;
  return line;
}

/** Lines as `read_file` numbers them: a final line end closes the last line rather than opening one. */
function lineCount(text: string): number {
  const lines = lineAt(text, text.length);
  return text.endsWith("\n") && lines > 1 ? lines - 1 : lines;
}

export interface CutResult {
  readonly text: string;
  /** Characters left out; 0 when `text` was within the bound. */
  readonly omitted: number;
}

/**
 * `text` within `bound`: its start and its end at line ends where one falls
 * near the cut, the gap line between (the header). `gap` renders the gap
 * line for an omission; its length must not grow when a number shrinks.
 */
export function cutToBound(text: string, bound: number, gap: (omission: Omission) => string): CutResult {
  if (text.length <= bound) return { text, omitted: 0 };
  const totalLines = lineCount(text);
  // The gap line at its longest: every number at its largest.
  const reserve = gap({ chars: text.length, firstLine: totalLines, lastLine: totalLines, totalLines }).length + 2;
  const budget = bound - reserve;
  if (budget <= 0) {
    return { text: gap({ chars: text.length, firstLine: 1, lastLine: totalLines, totalLines }), omitted: text.length };
  }
  const headEnd = headCutIndex(text, Math.ceil(budget / 2));
  const tailStart = tailCutIndex(text, Math.floor(budget / 2));
  const head = text.slice(0, headEnd);
  const line = gap({
    chars: tailStart - headEnd,
    firstLine: lineAt(text, headEnd),
    lastLine: Math.min(lineAt(text, tailStart - 1), totalLines),
    totalLines,
  });
  const joint = head.endsWith("\n") || head.length === 0 ? "" : "\n";
  return { text: `${head}${joint}${line}\n${text.slice(tailStart)}`, omitted: tailStart - headEnd };
}

interface TextBlock {
  readonly type: "text";
  readonly text: string;
}

function isTextBlock(block: unknown): block is TextBlock {
  return typeof block === "object" && block !== null &&
    (block as { type?: unknown }).type === "text" && typeof (block as { text?: unknown }).text === "string";
}

/** The text a result is measured and kept by: string content itself, or an array's text blocks joined by line ends. */
function textOf(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content.filter(isTextBlock).map((block) => block.text).join("\n");
}

/**
 * What deepagents (1.14) counts for a result's non-text blocks beside its
 * text: its `stringifyToolContent` (not exported) joins every block with a
 * line end, a non-text block as its JSON.
 */
export function deepagentsMediaChars(content: MessageContent): number {
  if (typeof content === "string") return 0;
  return content.filter((block) => !isTextBlock(block)).reduce((sum, block) => sum + 1 + JSON.stringify(block).length, 0);
}

/** The cut text in place of the original's: a string, or one text block before the non-text blocks kept as they are. */
function withText(content: MessageContent, text: string): MessageContent {
  if (typeof content === "string") return text;
  const media = content.filter((block) => !isTextBlock(block));
  return media.length === 0 ? text : [{ type: "text", text }, ...media];
}

type Kept = { readonly path: string } | { readonly failed: string } | null;

export type ToolTruncationMiddleware = StigmerMiddleware & {
  readonly truncationCount: number;
  readonly totalCharsTruncated: number;
};

export function createToolTruncationMiddleware(
  config: Partial<ToolTruncationConfig> = {},
): ToolTruncationMiddleware {
  const maxChars = config.maxChars ?? DEFAULT_MAX_CHARS;
  if (maxChars <= 0) {
    throw new Error(`maxChars must be positive, got ${maxChars}`);
  }
  const keeper: AnyBackendProtocol | undefined =
    config.backend !== undefined && routesOffloads(config.backend) ? config.backend : undefined;

  let truncationCount = 0;
  let totalCharsTruncated = 0;

  /** The text's bound for this result, or `null` when it is left to deepagents whole (the header). */
  function boundFor(toolName: string, content: MessageContent): number | null {
    if (DEEPAGENTS_NEVER_OFFLOADS.has(toolName)) return maxChars;
    const room = DEEPAGENTS_OFFLOAD_THRESHOLD_CHARS - deepagentsMediaChars(content);
    return room < MIN_TEXT_ROOM_CHARS ? null : Math.min(maxChars, room);
  }

  async function keep(toolCallId: string, text: string): Promise<Kept> {
    if (keeper === undefined) return null;
    const path = keptResultPath(toolCallId);
    try {
      const result = await keeper.write(path, text);
      return result.error === undefined ? { path } : { failed: result.error };
    } catch (error) {
      return { failed: error instanceof Error ? error.message : String(error) };
    }
  }

  async function shorten(message: ToolMessage, request: ToolCallRequest): Promise<ToolMessage> {
    const toolName = request.toolCall.name;
    const bound = boundFor(toolName, message.content);
    const text = textOf(message.content);
    if (bound === null || text.length <= bound) return message;

    const narrow = NARROW_A_CALL.get(toolName);
    const kept = narrow === undefined ? await keep(message.tool_call_id || request.toolCall.id, text) : null;
    const { text: cut, omitted } = cutToBound(text, bound, (omission) => {
      if (narrow !== undefined) return GAP_LINE.narrow(omission, narrow);
      return kept !== null && "path" in kept ? GAP_LINE.kept(omission, kept.path) : GAP_LINE.notKept(omission);
    });

    truncationCount++;
    totalCharsTruncated += omitted;
    console.warn(
      `[TRUNCATED] tool=${toolName} original_chars=${text.length} ` +
      `limit=${bound} chars_truncated=${omitted} kept=${kept !== null && "path" in kept ? "yes" : "no"}`,
    );
    if (kept !== null && "failed" in kept) {
      console.warn(`[TRUNCATED] tool=${toolName} could not keep the whole result: ${kept.failed}`);
    }
    config.onTruncation?.(toolName, omitted);

    return new ToolMessage({
      content: withText(message.content, cut),
      tool_call_id: message.tool_call_id,
      name: message.name,
      id: message.id,
      artifact: message.artifact,
      status: message.status,
      metadata: message.metadata,
      additional_kwargs: message.additional_kwargs,
      response_metadata: message.response_metadata,
    });
  }

  async function shortenCommand(command: Command, request: ToolCallRequest): Promise<Command> {
    const update: unknown = command.update;
    if (typeof update !== "object" || update === null || Array.isArray(update)) return command;
    const messages = (update as { messages?: unknown }).messages;
    if (!Array.isArray(messages)) return command;
    let changed = false;
    const shortened: unknown[] = [];
    for (const message of messages) {
      const next = ToolMessage.isInstance(message) ? await shorten(message, request) : message;
      changed ||= next !== message;
      shortened.push(next);
    }
    if (!changed) return command;
    return new Command({
      resume: command.resume,
      graph: command.graph,
      goto: command.goto,
      update: { ...update, messages: shortened },
    });
  }

  const middleware: ToolTruncationMiddleware = {
    name: "ToolTruncationMiddleware",

    get truncationCount() { return truncationCount; },
    get totalCharsTruncated() { return totalCharsTruncated; },

    beforeAgent() {
      truncationCount = 0;
      totalCharsTruncated = 0;
    },

    async wrapToolCall(request, handler) {
      const result = await handler(request);
      if (ToolMessage.isInstance(result)) return shorten(result, request);
      return isCommand(result) ? shortenCommand(result, request) : result;
    },

    afterAgent() {
      if (truncationCount > 0) {
        console.log(
          `[ToolTruncation] Summary: ${truncationCount} results truncated, ` +
          `${totalCharsTruncated} total chars removed (limit=${maxChars})`,
        );
      }
    },
  };

  return middleware;
}
