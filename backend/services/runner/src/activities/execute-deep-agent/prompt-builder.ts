/**
 * The native harness's system prompt: what `createDeepAgent` receives as
 * `systemPrompt`, rebuilt on EVERY invocation (never checkpointed with the
 * message history), so every standing fact is injected on every turn by
 * design — a first-turn-only injection would vanish from turn 2 onward.
 *
 * Pure functions: no side effects, no I/O. `turn-setup.ts` gathers the
 * inputs from the runtime's resolved record and this module renders them.
 *
 * What is this harness's and what is shared (S3 M5, Q-S3-10 / Q-M5-2):
 *  - Shared through `shared/prompt-sections.ts`: WHICH standing sections
 *    render and in WHAT order (`standingContextSections`), the input-files
 *    bullet and disclosure lines (`inputFileLines`), which skills a prompt
 *    highlights (`selectSkillsForPrompt`, called from `turn-setup.ts`) and
 *    the also-available sentence. Their WORDS come from each fact's own
 *    module; this builder only frames them.
 *  - This harness's: the framing — `## Heading` markdown sections, the house
 *    style for a system prompt — and every text that quotes this engine's
 *    tools: the `## Skills` activation protocol (`read`, `execute(...)`), the
 *    response rules, the sub-agent delegation rules, the plan-mode
 *    read-boundary sentence, and the workspace section (the deepagents
 *    backend's path resolution is this engine's).
 *
 * The rendered bytes are load-bearing for the hermetic tests: `ScriptedModel`
 * tells its scripted roles apart by the system prompt's text, so this
 * module's whole output is pinned by `__tests__/prompt-goldens.test.ts`.
 */

import { relative } from "node:path";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ProvisionResult, GitMetadata } from "../../shared/workspace/types.js";
import { SourceType } from "../../shared/workspace/types.js";
import { formatConversationCatchupText } from "../../shared/conversation-catchup.js";
import type { SenderIdentity } from "../../shared/sender-identity.js";
import type { DeclaredPreferencesContent } from "../../shared/declared-preferences.js";
import type { RecalledMemoriesContent } from "../../shared/recalled-memories.js";
import type { DownloadUrlKind } from "../../shared/attachment-download-urls.js";
import {
  inputFileLines,
  standingContextSections,
  type StandingSectionKind,
  type VisionPromptInfo,
} from "../../shared/prompt-sections.js";
import { PLAN_MODE_DIRECTIVE } from "../../shared/plan-mode-prompt.js";
import {
  buildImplementPlanDirective,
  findApprovedPlanPath,
} from "../../shared/implement-plan-prompt.js";
import type { ResolvedAttachment } from "../../shared/attachment-resolver.js";
import type { SkillMetadata } from "../../shared/skill-resolver.js";
import { STIGMER_LOCAL_STATE_DIR } from "../../shared/workspace/stigmer-link.js";

const RESPONSE_RULES = `

## Response rules

- After using the read tool, NEVER reprint, echo, list, or summarize \
file contents in your response. Tool results are already in your \
context. Proceed directly to analysis or the task.
- Do not begin responses with phrases like \
"Below is the complete content", \
"Here are the contents of the files", or similar. \
The user did not ask you to display file contents.
- Use backticks for file paths, function names, variable names, \
and shell commands (e.g., \`src/main.py\`, \`handleRequest()\`, \
\`npm install\`).
- When referencing code, cite the file path — do not re-print \
code blocks that the user can see in tool results.
- Structure complex answers with headings and bullet points.
- If you encounter something unexpected that changes the scope, \
explain the issue and propose options before proceeding.
`;

const SUB_AGENT_RULES = `

## Sub-agent delegation rules

### Concurrency limit

Do NOT spawn more than 3 sub-agents concurrently. If you need to \
explore more than 3 areas, batch them: launch the first 3, wait for \
results, then launch more if needed. The runtime enforces this limit — \
excess sub-agents will be rejected.

### When NOT to delegate

- **Reading files.** Use the \`read\` tool yourself. You need raw file \
contents in your own context to reason about them accurately.
- **Single-step lookups.** Use \`grep\`, \`glob\`, \`search\`, or \`read\` \
directly for simple searches across 1-2 files. Only delegate when \
the task requires multi-step exploration.
- **Data you will process yourself.** If you need the output in your \
own context (e.g., to answer a question, write code, compare files), \
do the work directly — do not delegate it.
- **Small tasks (fewer than 3 steps).** The overhead of spawning a \
sub-agent outweighs the benefit for trivial operations.

### When TO delegate

- Multi-step, independent tasks that produce a deliverable (analysis, \
synthesis, generated content) you will incorporate into your response.
- Parallel exploration of genuinely different areas of a codebase or \
knowledge base when context isolation helps.
- Tasks that benefit from a separate context window (e.g., long \
document summarization that would crowd your own context).

### Delegation best practices

- When delegating, specify the **deliverable** you need — not \
"read these files and give me the contents."
- You MUST reference and synthesize sub-agent results in your \
response. If you spawn a sub-agent, its output must visibly \
influence your answer.
- Each sub-agent consumes tokens and time. Prefer doing work \
directly over delegating. Only delegate when context isolation \
or parallelism genuinely helps the user.
`;

/** The agent's instructions when the blueprint carries none; the prompt is never empty (S3 M2a, F-M2a-16: was `setup.ts`'s alone). */
export const DEFAULT_INSTRUCTIONS = "You are a helpful AI assistant.";

export interface PromptBuilderInput {
  /** The blueprint's instructions, raw; empty falls back to {@link DEFAULT_INSTRUCTIONS}. */
  instructions: string;
  provisionResults: ProvisionResult[];
  containerRoot: string;
  skillsPromptSection: string;
  /**
   * The `<available_channel_templates>` section
   * (shared/channel-attachment.ts formatChannelTemplatesSection); absent
   * when the agent serves no proactive channel or nothing is sendable.
   */
  channelTemplatesPromptSection?: string;
  workspaceFileRefs: string[];
  workspaceRoot: string;
  /** The turn's resolved input files, as the runtime's attachment phase returns them. */
  inputFiles: readonly ResolvedAttachment[];
  /**
   * Vision facts about this turn's attachments (T04): which images the model
   * sees inline in the user message and which degraded to path-only.
   * Rendered inside the Input Files section.
   */
  vision?: VisionPromptInfo;
  /**
   * What kind of URL the turn's storage backend mints (issue #532) — keys
   * the Input Files section's hand-off wording (attachment-download-urls.ts).
   * One turn-level fact: all attachments ride the one configured storage.
   */
  downloadUrlKind?: DownloadUrlKind;
  /**
   * The execution's interaction mode. PLAN appends the shared plan-mode
   * directive so the model knows the turn's deliverable is a plan document.
   * Tool-level write enforcement is separate (see turn-setup.ts permissions) —
   * without this directive the model is silently read-only but never told
   * to produce a plan.
   */
  interactionMode?: InteractionMode;
  /**
   * The execution is a Build-from-plan turn (spec.execution_config
   * .build_from_plan): appends the shared implement-plan directive, pointing
   * the model at the injected approved plan document (or, when the plan
   * attachment did not materialize, at the conversation's plan). The user
   * message itself is just a short label ("Build from plan").
   */
  buildFromPlan?: boolean;
  /**
   * Rollover context bridge (cloud DD-013): a digest of the previous
   * session's conversation, read from `SessionSpec.metadata`. Injected on
   * EVERY turn by design: the native system prompt is rebuilt per
   * invocation (never checkpointed with the message history), so a
   * first-turn-only injection would vanish from turn 2 onward. The bridge
   * is standing session context, like skills.
   */
  contextBridge?: string;
  /**
   * Channel sender identity (attribution, not authorization): the
   * provider-verified identifier of the person on the channel, read from
   * `SessionSpec.metadata`. Injected on EVERY turn like the bridge — the
   * native system prompt is rebuilt per invocation, and the sender is
   * constant for the session's lifetime (channel sessions are keyed
   * per-sender).
   */
  senderIdentity?: SenderIdentity;
  /**
   * Embedder-supplied session context (personalization, not
   * authorization): standing free-text context about the user/session,
   * read from `SessionSpec.metadata`. Injected on EVERY turn like the
   * bridge — the native system prompt is rebuilt per invocation, and the
   * context is standing session state, like skills.
   */
  sessionContext?: string;
  /**
   * Platform-declared standing preferences (stigmer/stigmer#293): the org's
   * and user's standing context, server-snapshotted onto the execution
   * spec's `declared_preferences` at create. Injected on EVERY turn like
   * the bridge — the native system prompt is rebuilt per invocation, so an
   * edited preference reaches the very next turn.
   */
  declaredPreferences?: DeclaredPreferencesContent;
  /**
   * The subject's confirmed memories (stigmer/stigmer#293 Phase 2, DD-006):
   * consent-gated facts server-snapshotted onto the execution spec's
   * `recalled_memories` at create. Injected on EVERY turn like the
   * preferences — the native system prompt is rebuilt per invocation, so a
   * deleted memory is gone from the very next turn.
   */
  recalledMemories?: RecalledMemoriesContent;
}

// The prompt renders the attachment resolver's own result type — a local
// structural twin once lived here and silently dropped the size field
// (`size` vs `sizeBytes`), so the "(N bytes)" annotation never rendered. One
// type, one truth: the runtime's `ResolvedAttachment`; the vision facts are
// the shared `VisionPromptInfo` (prompt-sections.ts) for the same reason.

export type { VisionPromptInfo };

/**
 * This harness's heading for each shared standing section (the section's
 * identity and order are `prompt-sections.ts`'s; the `##` framing is the
 * house style for a system prompt). Exhaustive by the compiler: a new kind
 * fails here until it is named.
 */
const STANDING_SECTION_HEADINGS: Record<StandingSectionKind, string> = {
  "conversation-sender": "Conversation sender",
  "declared-preferences": "Declared preferences",
  "recalled-memories": "Remembered facts",
  "session-context": "Session context",
  "previous-conversation": "Previous conversation context",
};

/**
 * Assemble the full system prompt from base instructions and contextual
 * sections. Pure function with no I/O.
 */
export function buildEnhancedSystemPrompt(input: PromptBuilderInput): string {
  let prompt = input.instructions || DEFAULT_INSTRUCTIONS;

  const workspaceSection = buildWorkspacePromptSection(
    input.provisionResults,
    input.containerRoot,
  );
  if (workspaceSection) {
    prompt += workspaceSection;
  }

  if (input.skillsPromptSection) {
    prompt += input.skillsPromptSection;
  }

  if (input.channelTemplatesPromptSection) {
    prompt += "\n\n" + input.channelTemplatesPromptSection;
  }

  if (input.workspaceFileRefs.length > 0) {
    const refSection = buildReferencedFilesSection(
      input.workspaceFileRefs,
      input.workspaceRoot,
    );
    if (refSection) {
      prompt += refSection;
    }
  }

  if (input.inputFiles.length > 0) {
    prompt += buildInputFilesSection(
      input.inputFiles, input.vision, input.downloadUrlKind,
    );
  }

  // The standing context, in the shared order (the doctrine is stated once,
  // on `standingContextSections`); this harness only frames each section.
  for (const section of standingContextSections(input)) {
    prompt += `\n\n## ${STANDING_SECTION_HEADINGS[section.kind]}\n\n${section.body}`;
  }

  prompt += RESPONSE_RULES;
  prompt += SUB_AGENT_RULES;

  // Last sections on purpose: these per-execution directives redefine the
  // turn's deliverable, so they must be the freshest instruction the model
  // reads. (PLAN and build_from_plan are mutually exclusive in practice —
  // the build turn is always an Agent-mode execution.)
  if (input.interactionMode === InteractionMode.PLAN) {
    // The read-boundary sentence is native-harness-only, appended OUTSIDE the
    // shared directive: PLAN_MODE_DIRECTIVE also serves the Cursor harness,
    // which has no tool-level read boundary — there the sentence would be
    // false. Here it is enforced fact (shared/plan-mode-permissions.ts,
    // issue #528), stated so the model doesn't burn rounds probing paths the
    // rules will refuse.
    prompt +=
      "\n\n## Plan mode\n\n" +
      PLAN_MODE_DIRECTIVE +
      "\n- File reads are limited to your workspace (including its " +
      "`.stigmer/` directory); paths outside it are refused.";
  }

  if (input.buildFromPlan) {
    const planPath = findApprovedPlanPath(
      input.inputFiles.map((f) => f.relativePath),
    );
    prompt +=
      "\n\n## Implement the approved plan\n\n" +
      buildImplementPlanDirective(planPath);
  }

  return prompt;
}

/**
 * Compose the turn's USER MESSAGE for the graph invocation: the framed
 * conversation catchup (cloud DD-006), when present, prepended to the
 * customer's message. In the user message and never the system prompt (A27):
 * the system prompt is rebuilt per invocation and would forget the digest one
 * turn later, while a message enters the checkpointer with the turn and
 * persists in history — the same durability the cursor harness gets from its
 * prompt prefix. The caller's `spec.message` is never mutated; the prepend
 * exists only in the graph input.
 */
export function composeUserMessage(
  message: string,
  conversationCatchup: string | undefined,
): string {
  return conversationCatchup
    ? `${formatConversationCatchupText(conversationCatchup)}\n\n---\n\n${message}`
    : message;
}

/**
 * The `## Skills` section of this harness's system prompt, rendered from the
 * runtime's mounted-skill metadata (`shared/skill-resolver.ts`
 * `SkillMetadata`), following the Agent Skills spec's progressive
 * disclosure model: only name, description and location are injected; the
 * agent reads SKILL.md on demand through its filesystem tools. Byte for byte
 * the text the orchestrator-era `generatePromptSection` rendered from the
 * `Skill` proto (deleted with `setup.ts` at S3 M2b); the one difference is
 * the input — a mounted file's metadata, not a fetched resource — so this
 * renderer needs no client and serves the root and every sub-agent alike.
 * Empty for no skills.
 */
export function renderSkillsSection(skills: readonly SkillMetadata[]): string {
  if (skills.length === 0) return "";

  const lines: string[] = [
    "",
    "",
    "## Skills",
    "",
    "You have access to the following skills. Each skill provides specialized " +
    "knowledge or capabilities.",
    "",
    "**Activation protocol**: To use a skill, read its SKILL.md file " +
    "using the `read` tool. The SKILL.md contains detailed instructions, " +
    "available tools, and usage examples.",
    "",
    "**Usage pattern**:",
    "",
    "1. Review the skill description below to determine relevance",
    "2. Read `{location}/SKILL.md` for full instructions",
    "3. Follow the skill's documented operations:",
    "",
    "`read {location}/references/schema.md`",
    '`execute("python3 {location}/scripts/run.py")`',
    "",
  ];

  for (const skill of skills) {
    const skillDir = skillDirOf(skill);
    lines.push(`### ${skill.name}`);
    lines.push(`**Description**: ${skill.description || "(no description)"}`);
    lines.push(`**Location**: \`${skillDir}/\``);
    lines.push(`**Activate**: \`read ${skillDir}/SKILL.md\``);
    lines.push("");
  }

  return lines.join("\n");
}

/** The mount directory a skill's `SKILL.md` path names (`.stigmer/skills/<name>`). */
function skillDirOf(skill: SkillMetadata): string {
  const slash = skill.path.lastIndexOf("/");
  return slash > 0 ? skill.path.slice(0, slash) : `${STIGMER_LOCAL_STATE_DIR}/skills/${skill.name}`;
}

function buildWorkspacePromptSection(
    provisionResults: ProvisionResult[],
    containerRoot: string,
): string {
  if (provisionResults.length === 0) return "";

  if (provisionResults.length === 1) {
    return buildSingleWorkspaceSection(provisionResults[0]);
  }
  return buildMultiWorkspaceSection(provisionResults, containerRoot);
}

function buildSingleWorkspaceSection(result: ProvisionResult): string {
  if (!result.workspaceDescription) return "";

  let section = "\n\n## Workspace\n\n" + result.workspaceDescription;
  if (result.fileTree) {
    section += "\n\n" + result.fileTree;
  }
  return section;
}

function buildMultiWorkspaceSection(
  results: ProvisionResult[],
  containerRoot: string,
): string {
  const firstLabel = results[0].entryName || "entry-1";

  let section =
    `\n\n## Workspace\n\n` +
    `This session has ${results.length} workspace entries.\n\n` +
    `**Path resolution**: All tools resolve paths relative to the ` +
    `workspace root. Use entry-relative paths ` +
    `(e.g., \`${firstLabel}/src/main.py\`). ` +
    `Do not use absolute filesystem paths.\n`;

  for (let idx = 0; idx < results.length; idx++) {
    const result = results[idx];
    const label = result.entryName || `entry-${idx + 1}`;
    const relPath = workspaceRelativePath(result.rootDir, containerRoot);
    section += `\n### ${label} (\`${relPath}\`)\n\n`;
    section += formatEntryDescription(result);
    if (result.fileTree) {
      section += "\n\n" + result.fileTree;
    }
  }

  return section;
}

function workspaceRelativePath(rootDir: string, containerRoot: string): string {
  if (!containerRoot) return rootDir;
  try {
    const rel = relative(containerRoot, rootDir);
    if (rel.startsWith("..")) return rootDir;
    return rel;
  } catch {
    return rootDir;
  }
}

function formatEntryDescription(result: ProvisionResult): string {
  const name = result.entryName || "this entry";

  if (result.sourceType === SourceType.LOCAL_PATH) {
    return (
      `Workspace entry **${name}** is the user's project directory ` +
      `at \`${result.rootDir}\`.\n` +
      "You are operating directly on the user's files — changes are " +
      "immediate and persistent. Use git to track and verify your changes."
    );
  }

  if (result.sourceType === SourceType.GIT_REPO && result.gitMetadata) {
    const meta: GitMetadata = result.gitMetadata;
    const shortSha = meta.baseCommit.length >= 7
      ? meta.baseCommit.slice(0, 7)
      : meta.baseCommit;
    return (
      `Workspace entry **${name}** was initialized from ` +
      `${meta.repoUrl} (branch: ${meta.branch}, commit: ${shortSha}).\n` +
      "Changes you make will be captured as artifacts when execution completes."
    );
  }

  if (result.sourceType === SourceType.EMPTY) {
    return (
      `Workspace entry **${name}** is an empty workspace.\n` +
      "Create files and directories as needed for your task."
    );
  }

  return result.workspaceDescription;
}

function buildReferencedFilesSection(
  workspaceFileRefs: string[],
  _workspaceRoot: string,
): string {
  if (workspaceFileRefs.length === 0) return "";

  let section =
    "\n\n## Referenced Files\n\n" +
    "The user has highlighted the following workspace paths for your " +
    "attention. Use `read` to access file contents.\n\n";

  for (const refPath of workspaceFileRefs) {
    section += `- \`${refPath}\`\n`;
  }

  return section;
}

/**
 * The `## Input Files` section: this harness's intro (it names this engine's
 * `read` tool) around the shared lines (`prompt-sections.ts` `inputFileLines`
 * says what each bullet and disclosure carries and why). Each disclosure
 * group is set off by a blank line, the markdown idiom.
 */
function buildInputFilesSection(
  files: readonly ResolvedAttachment[],
  vision?: VisionPromptInfo,
  downloadUrlKind?: DownloadUrlKind,
): string {
  let section = "\n\n## Input Files\n\n";
  section +=
    "The following files have been provided as read-only reference " +
    "material for your task. They live under `.stigmer/inputs/` and " +
    "are NOT part of the project source tree.\n\n" +
    "Read them using the `read` tool when you need their contents. " +
    "Do NOT echo, reprint, or summarize file contents in your response " +
    "-- they are reference material, not output. " +
    "Do NOT modify or delete these files.\n\n";

  const lines = inputFileLines(files, vision, downloadUrlKind);
  for (const entry of lines.entries) {
    section += `${entry}\n`;
  }
  if (lines.urlHandoff !== undefined) {
    section += "\n" + lines.urlHandoff + "\n";
  }
  if (lines.vision.length > 0) {
    section += "\n" + lines.vision.join("\n") + "\n";
  }

  return section;
}
