/**
 * The prompt glue both harnesses share: WHICH sections, in WHAT order, with
 * WHICH lines — never the framing, never the placement.
 *
 * The doctrine is `plan-mode-prompt.ts`'s: "the framing is house style; the
 * words are shared." Every section BODY already has one home
 * (`sender-identity.ts`, `declared-preferences.ts`, `recalled-memories.ts`,
 * `session-context.ts`, `context-bridge.ts`, `attachment-vision.ts`,
 * `attachment-download-urls.ts`). What the two prompt builders duplicated
 * until #1096 was the glue around those bodies: the order
 * the five standing sections read in, with the same doctrine comments written
 * twice; the input-files bullet and disclosure lines; which skills a prompt
 * highlights when there are many. This module is that glue, written once.
 *
 * What stays with each harness, on purpose:
 *  - Framing and placement. The native harness renders `## Heading` sections
 *    into a system prompt rebuilt on every turn; the Cursor harness renders
 *    `<xml_tag>` sections into the FIRST user message of a session
 *    (`capabilities.systemPrompt` is the declared reason). Each builder maps a
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

import type { ResolvedAttachment } from "./attachment-resolver.js";
import { visionDisclosureLines, type NotViewableEntry } from "./attachment-vision.js";
import { downloadUrlDisclosureLine, type DownloadUrlKind } from "./attachment-download-urls.js";
import { formatContextBridgeText } from "./context-bridge.js";
import { formatDeclaredPreferencesText, type DeclaredPreferencesContent } from "./declared-preferences.js";
import { formatRecalledMemoriesText, type RecalledMemoriesContent } from "./recalled-memories.js";
import { formatSenderIdentityText, type SenderIdentity } from "./sender-identity.js";
import { formatSessionContextText } from "./session-context.js";
import { filterSkills } from "./skill-relevance.js";
import type { SkillMetadata } from "./skill-resolver.js";
import { STIGMER_LOCAL_STATE_DIR } from "./workspace/stigmer-link.js";

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
 *  2. Platform-declared standing facts precede embedder-supplied context
 *     (DD-002 D3): both are standing background, but the declared preferences
 *     are platform-authored while session context is the embedder's overlay —
 *     the more specific overlay reads later and naturally refines.
 *  3. Declared-by-humans precedes learned-and-confirmed (DD-006 D4): both are
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
 * per turn from the resolved attachments; never carried across turns.
 */
export interface VisionPromptInfo {
  readonly inlineFilenames: readonly string[];
  readonly notViewable: readonly NotViewableEntry[];
}

/**
 * The vision facts as the runtime's attachment phase resolves them (the
 * `TurnInput.attachments` shape, structurally): the inline images in send
 * order and the ones that degraded. `undefined` when the turn has neither, so
 * the section renders no vision lines at all rather than an empty disclosure.
 */
export function visionPromptInfoOf(attachments: {
  readonly visionImages: readonly { readonly filename: string }[];
  readonly visionNotViewable: readonly NotViewableEntry[];
}): VisionPromptInfo | undefined {
  if (attachments.visionImages.length === 0 && attachments.visionNotViewable.length === 0) return undefined;
  return {
    inlineFilenames: attachments.visionImages.map((v) => v.filename),
    notViewable: attachments.visionNotViewable,
  };
}

/** The input-files section's lines; the builder supplies the intro and the frame. */
export interface InputFileLines {
  /** One bullet per file: path, size, the rename disclosure, the download URL. */
  readonly entries: readonly string[];
  /** The URL hand-off line, present only when some listed file carries a URL. */
  readonly urlHandoff: string | undefined;
  /** The vision disclosure lines; empty when the turn carries no vision facts. */
  readonly vision: readonly string[];
}

/**
 * The input-files lines over the runtime's own `ResolvedAttachment` — one
 * type, one truth (a structural twin once lived in each builder; native's
 * silently dropped the size, Cursor's was deleted in #1096).
 *
 * Each bullet discloses the size (so the agent can weigh a read — the field's
 * own stated purpose; Cursor's line gained it in #1096), the original
 * name of a duplicate-renamed file (`attachment-naming.ts`; so the agent can
 * connect "the two report.pdfs" in the user's message to distinct files on
 * disk), and the download URL when one was minted
 * (`attachment-download-urls.ts`; for the remote hand-off story). The URL
 * hand-off line renders only when some listed file actually carries a URL —
 * its wording keys on what kind of URL the storage backend mints. The vision
 * lines tell the model which of these files it can already SEE inline versus
 * which degraded to path-only; without them an agent silently ignores a photo
 * the user believes it can see.
 */
export function inputFileLines(
  files: readonly ResolvedAttachment[],
  vision: VisionPromptInfo | undefined,
  downloadUrlKind: DownloadUrlKind | undefined,
): InputFileLines {
  const entries = files.map((f) => {
    const size = ` (${f.sizeBytes} bytes)`;
    const rename = f.renamedFrom !== undefined ? ` (renamed from duplicate '${f.renamedFrom}')` : "";
    const url = f.downloadUrl !== undefined ? ` — download URL: ${f.downloadUrl}` : "";
    return `- \`${f.relativePath}\`${size}${rename}${url}`;
  });
  const urlHandoff =
    downloadUrlKind !== undefined && files.some((f) => f.downloadUrl !== undefined)
      ? downloadUrlDisclosureLine(downloadUrlKind)
      : undefined;
  return {
    entries,
    urlHandoff,
    vision: vision ? visionDisclosureLines(vision.inlineFilenames, vision.notViewable) : [],
  };
}

// ---------------------------------------------------------------------------
// The skills: which to highlight
// ---------------------------------------------------------------------------

/** Which mounted skills a prompt highlights, and which it only names. */
export interface SkillSelection {
  /** The skills the prompt describes in full, in the filter's order. */
  readonly highlighted: readonly SkillMetadata[];
  /** The names of the skills left out of the highlighted set; empty below the threshold. */
  readonly alsoAvailable: readonly string[];
}

/**
 * The relevance selection over the turn's message (`skill-relevance.ts`):
 * below `SKILL_COUNT_THRESHOLD` every skill is highlighted; at and above it,
 * the skills the message's terms reach are highlighted and the rest are
 * named, so the agent can still activate one on its own judgement (the Agent
 * Skills spec's progressive disclosure: metadata up front, instructions on
 * demand). The native harness calls this on every turn; the Cursor harness
 * lists every skill today; adopting the selection there is an open item.
 */
export function selectSkillsForPrompt(userMessage: string, skills: readonly SkillMetadata[]): SkillSelection {
  const filter = filterSkills(
    userMessage,
    skills.map((s) => s.name),
    skills.map((s) => s.description),
  );
  return {
    highlighted: filter.includedIndices.map((i) => skills[i]),
    alsoAvailable: filter.excludedNames,
  };
}

/**
 * The tool-neutral sentence that names the skills a prompt did not highlight
 * (`SkillSelection.alsoAvailable`), so the agent can activate one by reading
 * its SKILL.md at the mounted path. The sentence names no tool, so it serves
 * any harness; the heading above it is the builder's framing. Empty for no
 * names.
 */
export function alsoAvailableSkillsNote(excludedNames: readonly string[]): string {
  if (excludedNames.length === 0) return "";
  const names = excludedNames.map((n) => `\`${n}\``).join(", ");
  return (
    `These skills are installed but were not highlighted above: ${names}. ` +
    "If you determine one of them is relevant to your task, " +
    `read its SKILL.md at \`${STIGMER_LOCAL_STATE_DIR}/skills/<name>/SKILL.md\` to activate it.`
  );
}
