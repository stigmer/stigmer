/**
 * The Claude harness's prompt: what the engine's system prompt is given on
 * top of its own, and the turn's user message.
 *
 * The system prompt is the engine's own preset (`claude_code`), so the
 * engine keeps the loop guidance it was built with, which is what choosing
 * Claude buys, and this module writes what it appends: what every engine's
 * system prompt carries, from the shared pieces the native builder uses
 * (`execute-deep-agent/prompt-builder.ts`), in the same order:
 *
 *  1. the agent's instructions (the built-in assistant's when it has none);
 *  2. the workspace: each entry's root and what it is, in real paths, the
 *     dialect this engine's file tools speak, its working directory being
 *     the primary one;
 *  3. the repository's own instructions, by the shared rule
 *     (`shared/repository-instructions.ts`), read through a confined reader
 *     ({@link workspaceInstructionReader});
 *  4. the channel templates an agent serving a channel may send;
 *  5. the standing context in the shared order
 *     (`shared/prompt-sections.ts`), framed as the native builder frames it;
 *  6. where files for the person go (the outputs folder), outside plan mode;
 *  7. the plan-mode or build-from-plan directive, the freshest instruction;
 *  8. the turn's own `appendSystemPrompt`, last.
 *
 * Rendered fresh every turn and never recorded with the conversation
 * (`engine-options.ts` passes it with the engine's snapshot off): the
 * standing context and the turn's own append change between turns, and the
 * engine would otherwise keep the first turn's.
 *
 * The person's message is never in the system prompt. The turn's message
 * carries this turn's files and highlighted paths and the conversation
 * catchup, then what the person typed, each set off by a rule, as the
 * native engine composes it; the message's images ride the same message,
 * first, as content blocks (`turn.ts`).
 *
 * Pure but for the reader. Pinned by `__tests__/prompt.test.ts`.
 */

import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import type { TurnInput } from "../../harness/types.js";
import { effectiveInstructions } from "../../shared/builtin-assistant-prompt.js";
import { formatChannelTemplatesSection } from "../../shared/channel-attachment.js";
import { formatConversationCatchupText } from "../../shared/conversation-catchup.js";
import { buildImplementPlanDirective, findApprovedPlanPath } from "../../shared/implement-plan-prompt.js";
import { OUTPUTS_SUBDIR } from "../../shared/outputs.js";
import { PLAN_MODE_DIRECTIVE } from "../../shared/plan-mode-prompt.js";
import {
  hasInputFiles,
  inputFileLines,
  outputsFolderInstruction,
  standingContextSections,
  visionPromptInfoOf,
  type InputFileGroups,
  type StandingSectionKind,
} from "../../shared/prompt-sections.js";
import type { RecalledMemoriesContent } from "../../shared/recalled-memories.js";
import { type InstructionReader } from "../../shared/repository-instructions.js";
import { STIGMER_LOCAL_STATE_DIR } from "../../shared/workspace/stigmer-link.js";
import type { ProvisionResult } from "../../shared/workspace/types.js";

/** Each standing section's heading, as the native builder frames it. */
const STANDING_SECTION_HEADINGS: Record<StandingSectionKind, string> = {
  "conversation-sender": "Conversation sender",
  "declared-preferences": "Declared preferences",
  "recalled-memories": "Remembered facts",
  "session-context": "Session context",
  "previous-conversation": "Previous conversation context",
};

/** The largest instruction file the reader opens; anything longer is cut by the shared bound long before. */
const MAX_INSTRUCTION_FILE_BYTES = 4 * 1024 * 1024;

/** The system prompt's append for one turn (the header's order). */
export function composeSystemAppend(
  input: TurnInput,
  recalledMemories: RecalledMemoriesContent | undefined,
  repositoryInstructionsSection: string,
): string {
  const spec = input.execution.spec!;
  const plan = spec.interactionMode === InteractionMode.PLAN;
  let prompt = effectiveInstructions(input.blueprint.instructions);
  prompt += workspaceSection(input.workspace.provision.provisionResults, input.workspace.primaryDir);
  prompt += repositoryInstructionsSection;
  if (input.mcp.channelMessaging.length > 0) {
    const templates = formatChannelTemplatesSection(input.mcp.channelMessaging);
    if (templates !== "") prompt += `\n\n${templates}`;
  }
  const standing = standingContextSections({ ...input.standing, recalledMemories });
  for (const section of standing) prompt += `\n\n## ${STANDING_SECTION_HEADINGS[section.kind]}\n\n${section.body}`;
  if (!plan) prompt += `\n\n## Files for the person\n\n${outputsFolderInstruction(`${join(input.workspace.primaryDir, STIGMER_LOCAL_STATE_DIR, OUTPUTS_SUBDIR)}/`)}`;
  if (plan) prompt += `\n\n## Plan mode\n\n${PLAN_MODE_DIRECTIVE}`;
  if (spec.buildFromPlan) {
    const planPath = findApprovedPlanPath(input.files.message);
    prompt += `\n\n## Implement the approved plan\n\n${buildImplementPlanDirective(planPath === undefined ? undefined : join(input.workspace.primaryDir, planPath))}`;
  }
  if (input.appendSystemPrompt) prompt += `\n\n${input.appendSystemPrompt}`;
  return prompt;
}

/** The workspace's entries, in real paths (the header, item 2). */
function workspaceSection(results: readonly ProvisionResult[], primaryDir: string): string {
  if (results.length === 0) return "";
  const lines = [`## Workspace`, "", `Your working directory is \`${primaryDir}\`.`];
  for (const [index, result] of results.entries()) {
    const label = result.entryName || `entry-${index + 1}`;
    lines.push("", `### ${label} (\`${result.rootDir}\`)`, "", result.workspaceDescription);
    if (result.fileTree) lines.push("", result.fileTree);
  }
  return `\n\n${lines.join("\n")}`;
}

/** The roots whose instruction files the prompt shows: the primary directory, then each entry's root inside it, each once. */
export function instructionRoots(primaryDir: string, entryRootDirs: readonly string[]): string[] {
  const roots = [primaryDir];
  for (const rootDir of entryRootDirs) {
    const rel = relative(primaryDir, rootDir);
    if (rel.startsWith("..") || isAbsolute(rel) || roots.includes(rootDir)) continue;
    roots.push(rootDir);
  }
  return roots;
}

/**
 * The confined reader of the workspace's instruction files: a file is read
 * only when its directory's real location is inside the workspace's and the
 * file itself is no symlink (opened without following one), and only as
 * text. Anything else reads as absent, so the prompt shows nothing the
 * agent could not already read in its workspace.
 */
export function workspaceInstructionReader(primaryDir: string): InstructionReader {
  return async (path) => {
    try {
      const root = await realpath(primaryDir);
      const dir = await realpath(dirname(path));
      const rel = relative(root, dir);
      if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
      const handle = await open(join(dir, basename(path)), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_INSTRUCTION_FILE_BYTES) return undefined;
        const bytes = await handle.readFile();
        return bytes.includes(0) ? undefined : bytes.toString("utf8");
      } finally {
        await handle.close();
      }
    } catch {
      return undefined;
    }
  };
}

/**
 * The turn's message: this turn's files, then the workspace paths the person
 * highlighted, then the conversation catchup, then what the person typed,
 * each set off by a rule (the header).
 */
export function composeTurnMessage(input: TurnInput): string {
  const spec = input.execution.spec!;
  const primaryDir = input.workspace.primaryDir;
  const parts: string[] = [];
  const files = inRealPaths(input.files, primaryDir);
  if (hasInputFiles(files)) parts.push(inputFilesPart(files, input));
  const refs = spec.workspaceFileRefs ?? [];
  if (refs.length > 0) {
    parts.push(
      "## Referenced Files\n\nThe person highlighted these workspace paths for your attention.\n\n" +
        refs.map((ref) => `- \`${isAbsolute(ref) ? ref : join(primaryDir, ref)}\``).join("\n"),
    );
  }
  if (input.standing.conversationCatchup) parts.push(formatConversationCatchupText(input.standing.conversationCatchup));
  parts.push(spec.message);
  return parts.join("\n\n---\n\n");
}

/** The turn's file groups with each path made real: the engine's file tools take absolute paths. */
function inRealPaths(files: TurnInput["files"], primaryDir: string): InputFileGroups {
  const real = <T extends { readonly relativePath: string }>(file: T): T => ({ ...file, relativePath: join(primaryDir, file.relativePath) });
  return { message: files.message.map(real), conversation: files.conversation.map(real), references: files.references.map(real) };
}

/** The `## Input Files` part: the shared lines under this engine's intro. */
function inputFilesPart(files: InputFileGroups, input: TurnInput): string {
  const lines = inputFileLines(files, visionPromptInfoOf(input.files));
  let part =
    "## Input Files\n\nThese files were provided as read-only reference material for the task. " +
    "They are not part of the project's source; read them when you need their contents, and do not modify or delete them.\n\n" +
    lines.entries.join("\n");
  if (lines.vision.length > 0) part += `\n\n${lines.vision.join("\n")}`;
  return part;
}
