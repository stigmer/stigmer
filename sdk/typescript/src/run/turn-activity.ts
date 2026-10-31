// What a working turn is doing, for how long, and how far it has got: one
// derivation every surface reads (the React kit's activity line, the Ink
// terminal's working indicator), so the browser and the terminal cannot
// describe the same turn two ways.
//
// It reads only what a session's events fold into a turn
// (@stigmer/session-log): the open tool calls and their kinds
// (`resolveToolKind`, so the Stigmer harness's `execute` and the Claude
// harness's `Bash` read alike), the asks waiting on a person, a message or
// thinking still streaming, and the to-do list.
// It returns structure, never prose; `activityPhrase` beside it gives the
// present-tense words, so a surface may lay the parts out as it likes.
//
// Trade-offs:
// - "How far" is a fraction only when the agent keeps a to-do list. Without
//   one it is the steps settled and the time; no fraction is invented.
// - The newest open call on the primary thread is "now": it is the one the
//   agent started last, and a subagent's own calls belong to its card. A
//   turn with nothing open and nothing streaming is waiting on its model.
// - Time is the caller's clock (`nowMs`) against the turn's own start, the
//   person's message as the log stamped it, so a page that reloads mid-turn
//   reads the same elapsed time.
// - A span of time reads one way wherever a terminal writes it
//   (`formatElapsed`): the working line, a subagent's row, the CLI's exit
//   summary and `stigmer status` all say "1h 3m", never "63m 0s".

import type { ToolUse, Turn } from "@stigmer/session-log";
import { resolveToolKind, type ToolKind } from "./tool-view.js";

/** What a working turn is doing now. */
export type TurnActivity =
  /** A tool call is open: its kind and what it acts on ("" when its input names nothing short). */
  | { readonly kind: "tool"; readonly toolKind: ToolKind; readonly target: string; readonly toolUseId: string }
  /** A question or approval waits for the person; `count` of them. */
  | { readonly kind: "waiting_for_you"; readonly count: number }
  /** The agent's reply is streaming. */
  | { readonly kind: "writing" }
  /** The agent is thinking (its thinking is streaming). */
  | { readonly kind: "thinking" }
  /** Nothing is open: the turn waits on its model's next step. */
  | { readonly kind: "waiting_on_model" };

/** How far a turn's to-do list has got. */
export interface TodoProgress {
  /** Items completed. Cancelled items count neither as done nor toward the total. */
  readonly done: number;
  readonly total: number;
  /** The item in progress, when one is. */
  readonly current: string | undefined;
}

/** A turn's activity, time and progress, at one instant. */
export interface TurnProgress {
  readonly activity: TurnActivity;
  /** When the turn started (ISO); "" when the log holds nothing stamped for it. */
  readonly startedAt: string;
  /** Milliseconds from the start to `nowMs`, or to the turn's end once it ended; 0 with no start. */
  readonly elapsedMs: number;
  /** Tool calls of the primary thread that returned, to-do writes left out. */
  readonly stepsSettled: number;
  /** Tool calls of the primary thread still open, the one in `activity` included. */
  readonly openOperations: number;
  /** The to-do list's progress; undefined when the agent keeps none. */
  readonly todos: TodoProgress | undefined;
}

/** The longest target a phrase carries before it is cut. */
const TARGET_MAX = 48;

/**
 * A span of time in at most two units, the larger first: "42s", "1m 12s",
 * "1h 3m", "2d 5h". Seconds are floored, so a span never reads longer than it
 * was; a negative span reads "0s".
 */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/** The activity, time and progress of `turn` at `nowMs` (module header). */
export function describeTurnActivity(turn: Turn, nowMs: number): TurnProgress {
  const tools = turn.items.filter((item): item is ToolUse => item.kind === "tool_use");
  const open = tools.filter((tool) => tool.result === undefined && !isBookkeeping(tool));
  const settled = tools.filter((tool) => tool.result !== undefined && !isBookkeeping(tool));
  const startedAt = turn.userMessage?.processedAt ?? turn.items[0]?.processedAt ?? turn.status?.processedAt ?? "";
  const start = Date.parse(startedAt);
  const end = turn.ended && turn.status !== undefined ? Date.parse(turn.status.processedAt) : nowMs;
  return {
    activity: activityOf(turn, open),
    startedAt: Number.isNaN(start) ? "" : startedAt,
    elapsedMs: Number.isNaN(start) || Number.isNaN(end) ? 0 : Math.max(0, end - start),
    stepsSettled: settled.length,
    openOperations: open.length,
    todos: todoProgress(turn),
  };
}

function activityOf(turn: Turn, open: readonly ToolUse[]): TurnActivity {
  if (turn.asks.length > 0) return { kind: "waiting_for_you", count: turn.asks.length };
  const last = turn.items.at(-1);
  if (last?.kind === "message" && last.live) return { kind: "writing" };
  if (last?.kind === "thinking" && last.live) return { kind: "thinking" };
  const now = open.at(-1);
  if (now !== undefined) return { kind: "tool", toolKind: resolveToolKind(now), target: targetOf(now), toolUseId: now.id };
  return { kind: "waiting_on_model" };
}

/** A to-do write is the agent keeping its list, not a step of the work. */
function isBookkeeping(tool: ToolUse): boolean {
  return resolveToolKind(tool) === "todo";
}

function todoProgress(turn: Turn): TodoProgress | undefined {
  const counted = turn.todos.filter((todo) => todo.status !== "cancelled");
  if (counted.length === 0) return undefined;
  return {
    done: counted.filter((todo) => todo.status === "completed").length,
    total: counted.length,
    current: counted.find((todo) => todo.status === "in_progress")?.content,
  };
}

/** What a call acts on, in a few characters: a file's name, a search's pattern, a page's host, a subagent's task. */
function targetOf(tool: ToolUse): string {
  const input = tool.input;
  const text = (key: string): string => {
    const value = input[key];
    return typeof value === "string" ? value : "";
  };
  const kind = resolveToolKind(tool);
  switch (kind) {
    case "file_read":
    case "file_write":
    case "file_edit":
    case "file_delete":
      return short(baseName(text("path") || text("file_path") || text("notebook_path")));
    case "search":
      return short(text("pattern") || text("query"));
    case "fetch":
      return short(hostOf(text("url")));
    case "web_search":
      return short(text("query"));
    case "subagent":
      return short(text("description"));
    case "mcp":
      return short(tool.name);
    case "skill":
      return short(text("skill") || text("name"));
    case "list":
      return short(baseName(text("path")));
    case "shell":
    case "think":
    case "todo":
    case "memory":
    case "background_stop":
    case "unknown":
      return "";
    /* v8 ignore next -- @preserve: the exhaustiveness guard over ToolKind; resolveToolKind answers only the arms above */
    default: {
      const never: never = kind;
      return never;
    }
  }
}

// The path is the model's, so the trailing separators are trimmed by a loop:
// a regular expression like /[\\/]+$/ backtracks quadratically on a long run
// of them, and the activity line reads this every second.
function baseName(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end -= 1;
  const trimmed = path.slice(0, end);
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function short(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= TARGET_MAX ? flat : `${flat.slice(0, TARGET_MAX - 1)}…`;
}

/**
 * The activity in present-tense words: "Editing invoice.ts", "Running a
 * command", "Waiting for you". A kind's words name the work, whichever
 * harness ran it; a target the input did not name leaves the generic words.
 */
export function activityPhrase(activity: TurnActivity): string {
  switch (activity.kind) {
    case "waiting_for_you":
      return "Waiting for you";
    case "writing":
      return "Writing the answer";
    case "thinking":
      return "Thinking";
    case "waiting_on_model":
      return "Working";
    case "tool":
      return toolPhrase(activity.toolKind, activity.target);
    /* v8 ignore next -- @preserve: the exhaustiveness guard over TurnActivity; describeTurnActivity answers only the arms above */
    default: {
      const never: never = activity;
      return never;
    }
  }
}

function toolPhrase(kind: ToolKind, target: string): string {
  const on = (verb: string, fallback: string): string => (target === "" ? fallback : `${verb} ${target}`);
  switch (kind) {
    case "file_read":
      return on("Reading", "Reading a file");
    case "file_write":
      return on("Writing", "Writing a file");
    case "file_edit":
      return on("Editing", "Editing a file");
    case "file_delete":
      return on("Deleting", "Deleting a file");
    case "shell":
      return "Running a command";
    case "search":
      return on("Searching for", "Searching");
    case "list":
      return on("Looking in", "Looking through files");
    case "fetch":
      return on("Reading", "Reading a page");
    case "web_search":
      return on("Searching the web for", "Searching the web");
    case "think":
      return "Thinking";
    case "todo":
      return "Planning";
    case "subagent":
      return target === "" ? "A helper is working" : `A helper is working on ${target}`;
    case "mcp":
      return on("Using", "Using a tool");
    case "memory":
      return "Remembering";
    case "background_stop":
      return "Stopping a command";
    case "skill":
      return on("Using the skill", "Using a skill");
    case "unknown":
      return "Working";
    /* v8 ignore next -- @preserve: the exhaustiveness guard over ToolKind; resolveToolKind answers only the arms above */
    default: {
      const never: never = kind;
      return never;
    }
  }
}

/** The past-tense verb and the counted noun a settled call of each kind reads as. */
const SETTLED_WORDS: Readonly<Partial<Record<ToolKind, readonly [verb: string, noun: string]>>> = {
  file_read: ["read", "file"],
  file_write: ["wrote", "file"],
  file_edit: ["edited", "file"],
  file_delete: ["deleted", "file"],
  shell: ["ran", "command"],
  search: ["searched", "pattern"],
  list: ["looked through", "folder"],
  fetch: ["read", "page"],
  web_search: ["searched the web", "time"],
  mcp: ["used", "tool"],
  skill: ["used", "skill"],
  unknown: ["used", "tool"],
};

/**
 * A stretch of settled calls in a few words, kinds in the order the agent
 * first used them: "Searched 1 pattern, read 1 file, edited invoice.ts,
 * ran 1 command". A single edited file is named. To-do writes, thinking,
 * memory and subagents are left out (a subagent has its own card); ""
 * when nothing is left to say.
 */
export function settledStepsPhrase(tools: readonly ToolUse[]): string {
  const byKind = new Map<ToolKind, ToolUse[]>();
  for (const tool of tools) {
    const kind = resolveToolKind(tool);
    if (SETTLED_WORDS[kind] === undefined) continue;
    byKind.set(kind, [...(byKind.get(kind) ?? []), tool]);
  }
  const parts = [...byKind].map(([kind, uses]) => {
    const [verb, noun] = SETTLED_WORDS[kind]!;
    const only = uses.length === 1 ? targetOf(uses[0]!) : "";
    if (kind === "file_edit" && only !== "") return `${verb} ${only}`;
    return `${verb} ${uses.length} ${noun}${uses.length === 1 ? "" : "s"}`;
  });
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** From the first call's start to the last result, in milliseconds; 0 when the log stamps neither. */
export function stepsSpanMs(tools: readonly ToolUse[]): number {
  const start = Date.parse(tools[0]?.processedAt ?? "");
  const ends = tools.map((tool) => Date.parse(tool.result?.processedAt ?? tool.processedAt)).filter((at) => !Number.isNaN(at));
  if (Number.isNaN(start) || ends.length === 0) return 0;
  return Math.max(0, Math.max(...ends) - start);
}
