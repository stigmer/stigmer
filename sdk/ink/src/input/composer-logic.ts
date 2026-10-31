// The composer's decisions apart from drawing: walking the prompt history,
// collapsing a large paste to a label, finding the command or completion the
// cursor is in, and reading a sent message as a command.
//
// - History: Up from the first row goes back an entry, Down from the last row
//   forward, and past the newest entry the draft comes back as it was left.
//   Consecutive duplicates are kept once.
// - Paste: over 800 characters or three lines collapses to "[Pasted text #1
//   +42 lines]", which edits as one character and is sent as the full text;
//   a smaller paste goes in as typed, line breaks kept.
// - Menus: `/` at the very start of a one-line message opens the commands; a
//   source's trigger at the start or after a space opens its completions.
//
// Proven by __tests__/composer.test.tsx.

import type { CompletionItem, SlashCommand } from "./extensions.js";
import { insertText, type TextBuffer } from "./text-buffer.js";

// --- history ---------------------------------------------------------------

/** Where the history walk stands: off it (the draft), or at an entry. */
export interface HistoryWalk {
  /** The entry shown, by index; undefined while the draft is shown. */
  readonly index: number | undefined;
  /** The draft as it was when the walk began. */
  readonly draft: string;
}

/** Off the history, nothing saved. */
export const NO_WALK: HistoryWalk = { index: undefined, draft: "" };

/** A step through `entries` (oldest first): the walk after it and the text to show, or undefined when there is nowhere to go. */
export function stepHistory(
  entries: readonly string[],
  walk: HistoryWalk,
  current: string,
  direction: "back" | "forward",
): { readonly walk: HistoryWalk; readonly text: string } | undefined {
  if (direction === "back") {
    if (entries.length === 0 || walk.index === 0) return undefined;
    const index = walk.index === undefined ? entries.length - 1 : walk.index - 1;
    return { walk: { index, draft: walk.index === undefined ? current : walk.draft }, text: entries[index]! };
  }
  if (walk.index === undefined) return undefined;
  const index = walk.index + 1;
  if (index >= entries.length) return { walk: NO_WALK, text: walk.draft };
  return { walk: { ...walk, index }, text: entries[index]! };
}

/** `entries` with `entry` kept as the newest, unless it repeats the newest; at most `limit` kept. */
export function appendHistory(entries: readonly string[], entry: string, limit = 500): readonly string[] {
  if (entry.trim() === "" || entries.at(-1) === entry) return entries;
  return [...entries, entry].slice(-limit);
}

// --- paste -----------------------------------------------------------------

/** A paste longer than this many characters collapses. */
export const PASTE_COLLAPSE_CHARS = 800;
/** A paste of more than this many lines collapses. */
export const PASTE_COLLAPSE_LINES = 3;

/** What a paste puts in the buffer: its text, or a label standing for it. */
export function pasteInsert(text: string, number: number): { readonly insert: string; readonly label?: string } {
  const normalized = text.replace(/\r\n?/g, "\n");
  const breaks = normalized.split("\n").length - 1;
  if (normalized.length <= PASTE_COLLAPSE_CHARS && breaks < PASTE_COLLAPSE_LINES) return { insert: normalized };
  const label = `[Pasted text #${number} +${breaks} lines]`;
  return { insert: label, label };
}

/** The message as sent: each paste label still in it replaced by the text it stands for. */
export function expandPastes(text: string, pastes: ReadonlyMap<string, string>): string {
  let expanded = text;
  for (const [label, full] of pastes) expanded = expanded.split(label).join(full);
  return expanded;
}

// --- menus -----------------------------------------------------------------

/** The menu the cursor is in, and what has been typed for it. */
export type MenuQuery =
  | { readonly kind: "command"; readonly query: string; readonly start: number }
  | { readonly kind: "completion"; readonly trigger: string; readonly query: string; readonly start: number };

/** The menu `buffer`'s cursor is in, for these completion triggers; undefined when none. */
export function menuQuery(buffer: TextBuffer, triggers: readonly string[]): MenuQuery | undefined {
  const before = buffer.text.slice(0, buffer.cursor);
  if (/^\/\S*$/.test(before) && !buffer.text.includes("\n")) return { kind: "command", query: before.slice(1), start: 0 };
  const start = before.search(/\S*$/);
  const token = before.slice(start);
  const trigger = triggers.find((candidate) => token.startsWith(candidate));
  if (trigger === undefined) return undefined;
  return { kind: "completion", trigger, query: token.slice(trigger.length), start };
}

/** The commands whose name matches `query`: those that start with it first, then those that contain it. */
export function matchCommands(commands: readonly SlashCommand[], query: string): readonly SlashCommand[] {
  const q = query.toLowerCase();
  const starts = commands.filter((command) => command.name.toLowerCase().startsWith(q));
  const contains = commands.filter((command) => !command.name.toLowerCase().startsWith(q) && command.name.toLowerCase().includes(q));
  return [...starts, ...contains];
}

/** The buffer with the menu's typed part replaced by `insert` and a space. */
export function acceptMenuItem(buffer: TextBuffer, query: MenuQuery, insert: string): TextBuffer {
  const head = buffer.text.slice(0, query.start);
  const tail = buffer.text.slice(buffer.cursor);
  return insertText({ text: head + tail, cursor: head.length }, `${insert} `);
}

/** A command's text in the message: `/name` for a command. */
export function commandInsert(command: SlashCommand): string {
  return `/${command.name}`;
}

/** The registered command a message runs, and its arguments; undefined when it is to be sent. */
export function parseCommand(text: string, commands: readonly SlashCommand[]): { readonly command: SlashCommand; readonly args: string } | undefined {
  const match = /^\/(\S+)(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (match === null) return undefined;
  const command = commands.find((candidate) => candidate.name === match[1]);
  return command === undefined ? undefined : { command, args: match[2] ?? "" };
}

/** What the accepted completions attach, for those whose text is still in the message. */
export function attachmentsOf(text: string, accepted: readonly CompletionItem[]): CompletionItem["attach"] {
  const kept = accepted.filter((item) => item.attach !== undefined && text.includes(item.insert));
  if (kept.length === 0) return undefined;
  const workspaceFileRefs = kept.flatMap((item) => item.attach?.workspaceFileRefs ?? []);
  const fileIds = [...new Set(kept.flatMap((item) => item.attach?.fileIds ?? []))];
  return {
    ...(workspaceFileRefs.length > 0 ? { workspaceFileRefs } : {}),
    ...(fileIds.length > 0 ? { fileIds } : {}),
  };
}
