// The words a tool call reads as: one table of every kind's verbs, in the
// present (while it runs), the past (once it returned) and the failed form,
// beside the noun a settled stretch counts it by. The working turn's phrase
// (`activityPhrase`), the settled stretch's roll-up (`settledStepsPhrase`)
// and each step's own line (`stepPhrase`) all read this table, so the three
// cannot describe one call three ways.
//
// A step's line reads only what the call carries: its kind
// (`resolveToolKind`), its input (a file's path, a search's pattern and
// folder, a page's address, the agent's own description of a command) and
// whether it returned, failed, or is still open. A command that exited
// non-zero failed even when the engine did not mark it an error.
//
// Trade-offs:
// - A connected app's tool (MCP) and a tool the kit does not know read as
//   the tool's own name, humanized ("Create issue"), with no tense: a past
//   tense guessed from an arbitrary name ("Get status", "List merge
//   requests") would misread, and the name is exact.
// - A search for files by name (glob) reads "Found files matching", told
//   apart from a search in files' text by the tool's name, as the kind
//   table itself is.
// - Targets are cut short (`TARGET_MAX`) so a line stays one line.

import type { ToolUse } from "@stigmer/session-log";
import { normalizeToolResult, resolveToolKind, type FileLineRange, type ToolKind, type ToolResultView } from "./tool-view.js";

/** How a step stands: running, returned, failed, or stopped before it returned (its turn ended). */
export type StepTense = "present" | "past" | "failed" | "stopped";

/** A step's words: the line, how it stands, and what it names beside the line. */
export interface StepPhrase {
  /** The line: "Edited invoice.ts", "Searched for round( in src/billing", "Couldn't read notes.md". */
  readonly text: string;
  readonly tense: StepTense;
  /** The folder of the file the line names, or where a search at work looks ("src/billing"); "" when it names none or the file sits at the root. */
  readonly folder: string;
  /** The connected app an MCP call belongs to; "" for a built-in tool. */
  readonly app: string;
}

/** One form of a kind's words: with a target ("Reading" + " invoice.ts") and without one ("Reading a file"). */
type Form = readonly [withTarget: string, alone: string];

/** Every kind's words in each tense, and the past verb and noun a settled stretch counts it by. */
interface KindWords {
  readonly present: Form;
  readonly past: Form;
  readonly failed: Form;
  /** The roll-up's verb and counted noun; undefined for a kind the roll-up leaves out. */
  readonly counted?: readonly [verb: string, noun: string];
}

/** The words of every kind (module header). */
export const KIND_WORDS: Readonly<Record<ToolKind, KindWords>> = {
  file_read: { present: ["Reading", "Reading a file"], past: ["Read", "Read a file"], failed: ["Couldn't read", "Couldn't read a file"], counted: ["read", "file"] },
  file_write: { present: ["Writing", "Writing a file"], past: ["Wrote", "Wrote a file"], failed: ["Couldn't write", "Couldn't write a file"], counted: ["wrote", "file"] },
  file_edit: { present: ["Editing", "Editing a file"], past: ["Edited", "Edited a file"], failed: ["Couldn't edit", "Couldn't edit a file"], counted: ["edited", "file"] },
  file_delete: {
    present: ["Deleting", "Deleting a file"],
    past: ["Deleted", "Deleted a file"],
    failed: ["Couldn't delete", "Couldn't delete a file"],
    counted: ["deleted", "file"],
  },
  shell: { present: ["Running a command", "Running a command"], past: ["Ran a command", "Ran a command"], failed: ["Command failed", "Command failed"], counted: ["ran", "command"] },
  search: { present: ["Searching for", "Searching"], past: ["Searched for", "Searched"], failed: ["Couldn't search for", "Couldn't search"], counted: ["searched", "pattern"] },
  list: {
    present: ["Looking in", "Looking through files"],
    past: ["Looked in", "Looked through files"],
    failed: ["Couldn't look in", "Couldn't look through files"],
    counted: ["looked through", "folder"],
  },
  fetch: { present: ["Reading", "Reading a page"], past: ["Read", "Read a page"], failed: ["Couldn't read", "Couldn't read a page"], counted: ["read", "page"] },
  web_search: {
    present: ["Searching the web for", "Searching the web"],
    past: ["Searched the web for", "Searched the web"],
    failed: ["Couldn't search the web for", "Couldn't search the web"],
    counted: ["searched the web", "time"],
  },
  think: { present: ["Thinking", "Thinking"], past: ["Thought it through", "Thought it through"], failed: ["Thought it through", "Thought it through"] },
  todo: { present: ["Planning", "Planning"], past: ["Updated the plan", "Updated the plan"], failed: ["Couldn't update the plan", "Couldn't update the plan"] },
  subagent: {
    present: ["A helper is working on", "A helper is working"],
    past: ["A helper worked on", "A helper worked"],
    failed: ["A helper couldn't finish", "A helper couldn't finish"],
  },
  mcp: { present: ["Using", "Using a tool"], past: ["Used", "Used a tool"], failed: ["Couldn't use", "Couldn't use a tool"], counted: ["used", "tool"] },
  memory: { present: ["Remembering", "Remembering"], past: ["Remembered", "Remembered"], failed: ["Couldn't remember", "Couldn't remember"] },
  background_stop: {
    present: ["Stopping a command", "Stopping a command"],
    past: ["Stopped a command", "Stopped a command"],
    failed: ["Couldn't stop a command", "Couldn't stop a command"],
  },
  skill: {
    present: ["Using the skill", "Using a skill"],
    past: ["Used the skill", "Used a skill"],
    failed: ["Couldn't use the skill", "Couldn't use a skill"],
    counted: ["used", "skill"],
  },
  unknown: { present: ["Working", "Working"], past: ["Used a tool", "Used a tool"], failed: ["A tool failed", "A tool failed"], counted: ["used", "tool"] },
};

/** `form` with `target` after its verb, or alone when there is none. */
export function phraseOf(form: Form, target: string): string {
  return target === "" ? form[1] : `${form[0]} ${target}`;
}

/** The longest target a phrase carries before it is cut. */
const TARGET_MAX = 48;

/** Names that search for files by name, not in their text. */
const FILE_NAME_SEARCHES: ReadonlySet<string> = new Set(["glob", "Glob", "find_files"]);

/** The input's text at `key`, or "". */
function textAt(tool: Pick<ToolUse, "input">, key: string): string {
  const value = tool.input[key];
  return typeof value === "string" ? value : "";
}

/** The path a file call names, from the fields the engines use. */
function pathOf(tool: Pick<ToolUse, "input">): string {
  return textAt(tool, "path") || textAt(tool, "file_path") || textAt(tool, "notebook_path");
}

/** What a call acts on, in a few characters: a file's name, a search's pattern, a page's host, a subagent's task. */
export function targetOf(tool: Pick<ToolUse, "name" | "mcpServerName" | "input">): string {
  const kind = resolveToolKind(tool);
  switch (kind) {
    case "file_read":
    case "file_write":
    case "file_edit":
    case "file_delete":
      return short(baseName(pathOf(tool)));
    case "search":
      return short(textAt(tool, "pattern") || textAt(tool, "query"));
    case "fetch":
      return short(hostOf(textAt(tool, "url")));
    case "web_search":
      return short(textAt(tool, "query"));
    case "subagent":
      return short(textAt(tool, "description"));
    case "mcp":
      return short(tool.name);
    case "skill":
      return short(textAt(tool, "skill") || textAt(tool, "name"));
    case "list":
      // The folder's last two segments ("src/billing"): its last alone
      // ("billing") leaves a reader guessing which, and a whole absolute
      // path crowds the line.
      return short(folderWords(textAt(tool, "path")));
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

/**
 * Whether `tool` waits on someone's answer: a person's approval
 * (`waiting`) or the app's answer to a call of its own tool
 * (`waiting_on_host`). A waiting call is open, never settled, whoever it
 * waits on; only an approval offers a decision.
 *
 * @example
 * ```ts
 * awaitsAnswer({ state: "waiting_on_host" }); // true
 * awaitsAnswer({ state: "completed" }); // false
 * ```
 */
export function awaitsAnswer(tool: Pick<ToolUse, "state">): boolean {
  return tool.state === "waiting" || tool.state === "waiting_on_host";
}

/**
 * How `tool` stands: open, returned, failed (an error result, a denial, or a
 * command that exited non-zero), or stopped before it returned. A background
 * command's own end is its status line's to say, never the step's.
 */
export function stepTense(tool: ToolUse): StepTense {
  if (tool.state === "failed" || tool.state === "denied") return "failed";
  // Waiting: worded as what it would do (stepPhrase), standing as open.
  if (tool.state === "waiting") return "present";
  if (tool.state === "stopped") return "stopped";
  if (tool.result === undefined) return "present";
  // An edit the Stigmer harness refused answers as a result, not an error
  // ("Error: String not found in file"): nothing changed, so it failed.
  if (resolveToolKind(tool) === "file_edit" && refusedEdit(tool.result.text)) return "failed";
  if (resolveToolKind(tool) === "shell" && tool.background === undefined) {
    const view = normalizeToolResult(tool);
    if (view.type === "terminal" && view.exitCode !== undefined && view.exitCode !== 0) return "failed";
  }
  return "past";
}

/**
 * `tool`'s line, in the tense it stands in (module header). A call that
 * waits for a person's yes has done nothing yet: it reads as what the agent
 * wants to do ("Wants to write rounding.ts").
 */
export function stepPhrase(tool: ToolUse, options: StepPhraseOptions = {}): StepPhrase {
  const phrase = stepPhraseByTense(tool);
  // A write that made the file reads as what it did ("Created rounding.test.ts").
  if (options.created === true && phrase.tense === "past" && resolveToolKind(tool) === "file_write") {
    const wrote = KIND_WORDS.file_write.past;
    const created = phrase.text === wrote[1] ? CREATED[1] : phrase.text.startsWith(`${wrote[0]} `) ? `${CREATED[0]}${phrase.text.slice(wrote[0].length)}` : phrase.text;
    return { ...phrase, text: created };
  }
  if (tool.state !== "waiting" || !phrase.text.startsWith("Couldn't ")) return phrase;
  return { ...phrase, text: `Wants to ${phrase.text.slice("Couldn't ".length)}` };
}

/** What a step's line may know beyond the call itself. */
export interface StepPhraseOptions {
  /**
   * The file a write wrote did not exist before its turn: the turn's file
   * review says so (its change is `added`). Nothing in the call says it, so
   * a session with no review reads "Wrote".
   */
  readonly created?: boolean;
}

/** A write that made its file, with a target and without one. */
const CREATED: Form = ["Created", "Created a file"];

// The first lines the engines answer a refused edit with: the Stigmer
// harness answers it as a result in both its backends' words, which the
// conformance suite's classifier keys the same way
// (test/conformance/src/benchmark/tool-call-facts.ts).
const EDIT_NOT_FOUND = /^(?:Error: )?String not found in file/;
const EDIT_NOT_UNIQUE = /has multiple occurrences|^(?:Error: )?Multiple occurrences found in/;
const NO_SUCH_FILE = /no such file|ENOENT|file not found|does not exist/i;

/** The first line of an answer that reads, trimmed; "" when it has none. */
function firstLine(text: string): string {
  return (text.split("\n").find((line) => line.trim() !== "") ?? "").trim();
}

/** Whether an edit's answer says it changed nothing. */
function refusedEdit(text: string): boolean {
  const first = firstLine(text);
  return EDIT_NOT_FOUND.test(first) || EDIT_NOT_UNIQUE.test(first);
}

/**
 * Why a step failed, as a sentence a person reads, from its answer. Only the
 * answer's first line is the engine's reason: the runner appends recovery
 * hints for the model after it (`enrichErrorMessage`), which are never shown.
 * A reason the engines are known to give reads in plain words ("The text to
 * replace wasn't in the file, so nothing changed."); any other is the
 * engine's own line, without an "Error:" label, as a sentence.
 */
export function failureWords(text: string): string {
  const first = firstLine(text);
  if (EDIT_NOT_FOUND.test(first)) return "The text to replace wasn't in the file, so nothing changed.";
  if (EDIT_NOT_UNIQUE.test(first)) return "The text to replace was in the file more than once, so nothing changed.";
  if (NO_SUCH_FILE.test(first)) return "The file wasn't there.";
  const reason = first.replace(/^error:\s*/i, "");
  return reason === "" ? "" : reason.charAt(0).toUpperCase() + reason.slice(1);
}

/**
 * How many a search found, as its step says it: "4 files" for a search by
 * name, "2 matches", and "2 matches in 2 files" once its matches name more
 * than one file. Other views count nothing ("").
 */
export function searchCountWords(view: ToolResultView): string {
  if (view.type !== "search") return "";
  if (view.kind === "files") return `${view.count} ${view.count === 1 ? "file" : "files"}`;
  const matches = `${view.count} ${view.count === 1 ? "match" : "matches"}`;
  const files = new Set(view.matches.flatMap((match) => (match.file === undefined ? [] : [match.file]))).size;
  return files > 1 ? `${matches} in ${files} files` : matches;
}

/** The lines a step shows of a file, as words: "Lines 14–17 of 88", or "Lines 14–17" when the length is not known. */
export function lineRangeWords(range: FileLineRange): string {
  const span = range.start === range.end ? `Line ${range.start}` : `Lines ${range.start}–${range.end}`;
  return range.total === undefined ? span : `${span} of ${range.total}`;
}

function stepPhraseByTense(tool: ToolUse): StepPhrase {
  const tense = stepTense(tool);
  // A step its turn stopped did not get done: it reads as one that couldn't.
  // A waiting one takes the same form, which stepPhrase turns into a want.
  const form: Exclude<StepTense, "stopped"> = tense === "stopped" || tool.state === "waiting" ? "failed" : tense;
  const kind = resolveToolKind(tool);
  const app = tool.mcpServerName;
  if (kind === "mcp" || kind === "unknown") return { text: humanizeToolName(tool.name), tense, folder: "", app };
  if (kind === "shell") {
    const description = textAt(tool, "description").replace(/\s+/g, " ").trim();
    const words = tool.state === "waiting" ? "Wants to run a command" : phraseOf(KIND_WORDS.shell[form], "");
    return { text: description === "" ? words : short(description), tense, folder: "", app };
  }
  if (kind === "search" && FILE_NAME_SEARCHES.has(tool.name)) {
    const pattern = short(textAt(tool, "pattern"));
    const words: Readonly<Record<Exclude<StepTense, "stopped">, Form>> = {
      present: ["Finding files matching", "Finding files"],
      past: ["Found files matching", "Found files"],
      failed: ["Couldn't find files matching", "Couldn't find files"],
    };
    return { text: phraseOf(words[form], pattern), tense, folder: "", app };
  }
  const target = targetOf(tool);
  const text = phraseOf(KIND_WORDS[kind][form], target);
  if (kind === "search") {
    const where = target !== "" ? short(trimSeparators(textAt(tool, "path"))) : "";
    // At work, a search has no counts yet: where it looks is its second line,
    // as a file step's folder is ("Searching for round(", then "src/billing").
    // Done, its counts take the second line and the folder joins its words.
    if (form === "present") return { text, tense, folder: where, app };
    return { text: where !== "" ? `${text} in ${where}` : text, tense, folder: "", app };
  }
  const isFile = kind === "file_read" || kind === "file_write" || kind === "file_edit" || kind === "file_delete";
  return { text, tense, folder: isFile && target !== "" ? short(folderOf(pathOf(tool))) : "", app };
}

/**
 * A tool's name as words, in sentence case: `create_issue`, `createIssue`
 * and `Create-Issue` all read "Create issue". A name with nothing to read
 * reads "A tool".
 */
export function humanizeToolName(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.:/]+/)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
  if (words.length === 0) return "A tool";
  const text = words.join(" ");
  return short(text.charAt(0).toUpperCase() + text.slice(1));
}

// The path is the model's, so the trailing separators are trimmed by a loop:
// a regular expression like /[\\/]+$/ backtracks quadratically on a long run
// of them, and the activity line reads this every second.
function trimSeparators(path: string): string {
  let end = path.length;
  while (end > 0 && (path[end - 1] === "/" || path[end - 1] === "\\")) end -= 1;
  return path.slice(0, end);
}

export function baseName(path: string): string {
  const trimmed = trimSeparators(path);
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
}

/** The folder a path sits in, without its trailing separator; "" at the root or for a bare name. */
function folderOf(path: string): string {
  const trimmed = trimSeparators(path);
  const at = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return at <= 0 ? "" : trimmed.slice(0, at);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

/** A folder as a step names it: its last two segments, "/workspace/app/src/billing" read as "src/billing". */
function folderWords(path: string): string {
  return trimSeparators(path).split(/[\\/]/).filter((segment) => segment !== "").slice(-2).join("/");
}

export function short(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length <= TARGET_MAX ? flat : `${flat.slice(0, TARGET_MAX - 1)}…`;
}
