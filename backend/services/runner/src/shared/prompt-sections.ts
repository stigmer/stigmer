/**
 * The prompt glue both harnesses share: WHICH sections, in WHAT order, with
 * WHICH lines — never the framing, never the placement.
 *
 * The doctrine is `plan-mode-prompt.ts`'s: "the framing is house style; the
 * words are shared." Every section BODY already has one home
 * (`sender-identity.ts`, `declared-preferences.ts`, `recalled-memories.ts`,
 * `session-context.ts`, `context-bridge.ts`, `attachment-vision.ts`). What
 * the two prompt builders duplicated
 * until #1096 was the glue around those bodies: the order
 * the five standing sections read in, with the same doctrine comments written
 * twice; the input-files bullet and disclosure lines. This module is that
 * glue, written once. It also chose which skills a prompt highlighted when
 * there were many, until the native harness stopped choosing skills by the
 * turn's message: a system prompt that follows the message misses the
 * provider's prompt cache on every turn, so every harness now describes every
 * mounted skill.
 *
 * What stays with each harness, on purpose:
 *  - Framing and placement. The native harness renders `## Heading` sections
 *    into a system prompt rebuilt on every turn; the Cursor harness renders
 *    `<xml_tag>` sections into the FIRST user message of a session
 *    (the system-prompt row of `harness/capabilities.ts`'s matrix is the
 *    reason). Each builder maps a
 *    section `kind` to its own label (`Record<StandingSectionKind, string>`,
 *    exhaustive by the compiler) and wraps the body itself. This module never
 *    learns a heading or a tag.
 *  - Words that quote an engine's tools: the native `## Skills` activation
 *    protocol (`read`, `execute(...)`) and Cursor's `<available_skills>` line
 *    (`the Read tool`); the response rules; the sub-agent rules; the
 *    structured-output directives (two mechanisms, two texts); Cursor's
 *    tool-approval protocol, which exists because of Cursor's gate model and
 *    would be false on a harness that interrupts before a tool runs.
 *
 * Fences: nothing under `shared/` imports `harness/` (and
 * `harness/__tests__/import-direction.test.ts` forbids `shared/` reaching
 * `activities/`), so every function here takes a plain struct that both
 * builders' option objects satisfy structurally — never `TurnInput`. Pure:
 * no I/O, no logging (a builder that wants to log what the selection did
 * does so at its own call site).
 */

import { visionDisclosureLines, type NotViewableEntry } from "./attachment-vision.js";
import type { ListedFile } from "./file-mount.js";
import { formatContextBridgeText } from "./context-bridge.js";
import { formatDeclaredPreferencesText, type DeclaredPreferencesContent } from "./declared-preferences.js";
import { formatRecalledMemoriesText, type RecalledMemoriesContent } from "./recalled-memories.js";
import { formatSenderIdentityText, type SenderIdentity } from "./sender-identity.js";
import { formatSessionContextText } from "./session-context.js";

// ---------------------------------------------------------------------------
// The standing context: five sections, one order
// ---------------------------------------------------------------------------

/**
 * The standing sections a prompt may carry, in the order they read. A builder
 * labels each kind in its own vocabulary; adding a kind here fails every
 * builder's label map until it names the new section — the point of a closed
 * union over a bag of optional fields.
 */
export type StandingSectionKind =
  | "conversation-sender"
  | "declared-preferences"
  | "recalled-memories"
  | "session-context"
  | "previous-conversation";

export interface StandingSection {
  readonly kind: StandingSectionKind;
  /** The section's words, from the body's own module; the builder frames them. */
  readonly body: string;
}

/**
 * The standing facts as both builders already hold them (their option
 * objects satisfy this structurally). Every field optional: an absent value
 * renders no section, so a runner predating a fact simply says nothing.
 */
export interface StandingPromptContext {
  readonly senderIdentity?: SenderIdentity;
  readonly declaredPreferences?: DeclaredPreferencesContent;
  readonly recalledMemories?: RecalledMemoriesContent;
  readonly sessionContext?: string;
  readonly contextBridge?: string;
}

/**
 * The present standing sections in the one ruled order. The order is the
 * doctrine, stated once:
 *
 *  1. The conversation sender first: standing context about WHO the
 *     conversation is with, which everything after may refer back to.
 *  2. Platform-declared standing facts precede embedder-supplied context:
 *     both are standing background, but the declared preferences
 *     are platform-authored while session context is the embedder's overlay —
 *     the more specific overlay reads later and naturally refines.
 *  3. Declared-by-humans precedes learned-and-confirmed: both are
 *     platform-authored standing background, but a preference is the user's
 *     exact words while a memory is an agent's confirmed inference — the exact
 *     statement reads first.
 *  4. Standing facts about the user (session context) come before the carried
 *     conversation (bridge): the bridge may refer back to them.
 *
 * Where the block sits in a prompt, and on which turns, is the builder's
 * (native: every turn, the system prompt is rebuilt; Cursor: the session's
 * first message, the agent's own store carries it after).
 */
export function standingContextSections(standing: StandingPromptContext): readonly StandingSection[] {
  const sections: StandingSection[] = [];
  if (standing.senderIdentity) {
    sections.push({ kind: "conversation-sender", body: formatSenderIdentityText(standing.senderIdentity) });
  }
  if (standing.declaredPreferences) {
    sections.push({ kind: "declared-preferences", body: formatDeclaredPreferencesText(standing.declaredPreferences) });
  }
  if (standing.recalledMemories) {
    sections.push({ kind: "recalled-memories", body: formatRecalledMemoriesText(standing.recalledMemories) });
  }
  if (standing.sessionContext) {
    sections.push({ kind: "session-context", body: formatSessionContextText(standing.sessionContext) });
  }
  if (standing.contextBridge) {
    sections.push({ kind: "previous-conversation", body: formatContextBridgeText(standing.contextBridge) });
  }
  return sections;
}

// ---------------------------------------------------------------------------
// The input files: the lines, not the frame
// ---------------------------------------------------------------------------

/**
 * Which images ride the user message inline (in send order) and which
 * degraded to the file-pointer story — the vision facts a prompt discloses
 * beside its input files (`attachment-vision.ts` owns the wording). Derived
 * per turn from the message's images; never carried across turns.
 */
export interface VisionPromptInfo {
  readonly inlineFilenames: readonly string[];
  readonly notViewable: readonly NotViewableEntry[];
}

/**
 * The vision facts as the runtime's File phase derives them (the
 * `TurnInput.files` shape, structurally): the inline images in send
 * order and the ones that degraded. `undefined` when the turn has neither, so
 * the section renders no vision lines at all rather than an empty disclosure.
 */
export function visionPromptInfoOf(files: {
  readonly visionImages: readonly { readonly filename: string }[];
  readonly visionNotViewable: readonly NotViewableEntry[];
}): VisionPromptInfo | undefined {
  if (files.visionImages.length === 0 && files.visionNotViewable.length === 0) return undefined;
  return {
    inlineFilenames: files.visionImages.map((v) => v.filename),
    notViewable: files.visionNotViewable,
  };
}

/**
 * The outputs folder's standing instruction (`shared/outputs.ts`), with the
 * folder as the engine's file tools name it: what the agent saves there
 * comes back to the person as Files when the turn ends, and nothing else
 * does. Every engine says it, outside plan mode, where writes are denied.
 */
export function outputsFolderInstruction(folderPath: string): string {
  return (
    `To give the user a file, save it in \`${folderPath}\`; everything there is returned to them when the turn ends. ` +
    "Files you edit in the workspace are not returned this way."
  );
}

/**
 * The files a turn's prompt lists, in the order it lists them: this
 * message's Files, the conversation's other Files, then an eval case's
 * reference files (the `TurnInput.files` shape, structurally).
 */
export interface InputFileGroups {
  readonly message: readonly ListedFile[];
  readonly conversation: readonly ListedFile[];
  readonly references: readonly ListedFile[];
}

/** Whether a turn has any file to list; a builder renders no input-files section otherwise. */
export function hasInputFiles(groups: InputFileGroups): boolean {
  return groups.message.length > 0 || groups.conversation.length > 0 || groups.references.length > 0;
}

/** The input-files section's lines; the builder supplies the intro and the frame. */
export interface InputFileLines {
  /** Each present group's label, then one bullet per file: path and size. */
  readonly entries: readonly string[];
  /** The vision disclosure lines; empty when the turn carries no vision facts. */
  readonly vision: readonly string[];
}

/** The label each group is listed under, when it has a file. */
const GROUP_LABELS: Readonly<Record<keyof InputFileGroups, string>> = {
  message: "Sent with this message:",
  conversation: "Shared earlier in this conversation:",
  references: "Reference files:",
};

/**
 * The input-files lines: each group the turn has, under its label, in
 * the one order — this message's Files first (what the user is talking
 * about now), the conversation's other Files next (still in reach, under
 * `.stigmer/uploads/`), the eval reference folders last (under
 * `.stigmer/inputs/`). Each bullet names where the agent reads the file
 * and its size, so the agent can weigh a read. The vision lines tell the
 * model which of this message's images it can already SEE inline versus
 * which degraded to path-only; without them an agent silently ignores a
 * photo the user believes it can see.
 */
export function inputFileLines(groups: InputFileGroups, vision: VisionPromptInfo | undefined): InputFileLines {
  const entries: string[] = [];
  for (const group of ["message", "conversation", "references"] as const) {
    if (groups[group].length === 0) continue;
    entries.push(GROUP_LABELS[group], ...groups[group].map((f) => `- \`${f.relativePath}\` (${f.sizeBytes} bytes)`));
  }
  return {
    entries,
    vision: vision ? visionDisclosureLines(vision.inlineFilenames, vision.notViewable) : [],
  };
}
