// What a host CLI adds to the kit's composer: its own slash commands, its own
// completions behind a trigger character, and where its prompt history lives.
// The kit ships the menus, the matching and the history walk; it ships no
// command and no source, so `/deploy` or `@ticket` is the host's in a few
// lines.
//
// - A command runs instead of being sent when the message starts with its
//   `/name`; a message whose `/word` names no command is sent as written.
// - A completion item may carry `attach`: the files or workspace references
//   it stands for, merged into the message it is sent with, so a mention is
//   a real reference and not only text.
// - History is the host's to keep (a file per working directory, say); the
//   kit's default lives in memory for the session.
import type { SendFollowUpOptions } from "@stigmer/react-core";
import type { InteractionMode } from "../app/SessionView.js";

/** What a command can do in the session it runs in. */
export interface ComposerContext {
  /** The interaction mode in effect. */
  readonly mode: InteractionMode;
  /** Sends `text` as the person's message. */
  readonly send: (text: string) => void;
  /** Stops the working turn, as Esc does. */
  readonly stop: () => void;
  /** Writes a line in the thread that is not sent to the agent. */
  readonly note: (text: string) => void;
  /** Switches between agent and plan mode. */
  readonly setMode: (mode: InteractionMode) => void;
  /** Leaves the session, as a second Ctrl+C does; the agent keeps working. */
  readonly leave: () => void;
}

/** A host's slash command. */
export interface SlashCommand {
  /** Its name, typed after the slash: `deploy` for `/deploy`. */
  readonly name: string;
  /** One line on what it does, shown in the menu and in `?`. */
  readonly description: string;
  /** What it takes after its name, as the menu shows it: `<environment>`. */
  readonly args?: string;
  /** Runs it with the text after its name, trimmed. */
  readonly run: (args: string, context: ComposerContext) => void | Promise<void>;
}

/** What a completion attaches to the message it is sent with. */
export type CompletionAttachment = Pick<SendFollowUpOptions, "workspaceFileRefs" | "fileIds">;

/** One item a completion source offers. */
export interface CompletionItem {
  /** What the menu shows. */
  readonly label: string;
  /** What replaces the trigger and the query in the message, such as `@src/billing/round.ts`. */
  readonly insert: string;
  /** A second, quieter part of the row. */
  readonly detail?: string;
  /** What the message carries when it is sent with this item's text still in it. */
  readonly attach?: CompletionAttachment;
}

/** A host's completions behind one trigger character. */
export interface CompletionSource {
  /** The character that opens the menu at the start of the message or after a space, such as `@`. */
  readonly trigger: string;
  /** The items for what was typed after the trigger; `signal` aborts when a newer query replaces it. */
  readonly complete: (query: string, signal: AbortSignal) => readonly CompletionItem[] | Promise<readonly CompletionItem[]>;
}

/** Where the composer's prompt history lives. */
export interface PromptHistory {
  /** The entries, oldest first. */
  readonly load: () => readonly string[] | Promise<readonly string[]>;
  /** Keeps a sent message. */
  readonly append: (entry: string) => void | Promise<void>;
}

/** What a host adds to the composer. */
export interface ComposerExtensions {
  readonly commands?: readonly SlashCommand[];
  readonly completions?: readonly CompletionSource[];
  readonly history?: PromptHistory;
}
