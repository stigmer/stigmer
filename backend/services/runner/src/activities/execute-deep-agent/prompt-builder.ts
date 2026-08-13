/**
 * System prompt construction for deep agent execution.
 *
 * Pure functions: no side effects, no I/O. Accepts pre-computed data
 * (provision results, skill sections, file refs) and returns the
 * assembled system prompt string.
 */

import { relative } from "node:path";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ProvisionResult, GitMetadata } from "../../shared/workspace/types.js";
import { SourceType } from "../../shared/workspace/types.js";
import { formatContextBridgeText } from "../../shared/context-bridge.js";
import { formatConversationCatchupText } from "../../shared/conversation-catchup.js";
import {
  formatSenderIdentityText,
  type SenderIdentity,
} from "../../shared/sender-identity.js";
import { formatSessionContextText } from "../../shared/session-context.js";
import {
  visionDisclosureLines,
  type NotViewableEntry,
} from "../../shared/attachment-vision.js";
import {
  downloadUrlDisclosureLine,
  type DownloadUrlKind,
} from "../../shared/attachment-download-urls.js";
import { PLAN_MODE_DIRECTIVE } from "../../shared/plan-mode-prompt.js";
import {
  buildImplementPlanDirective,
  findApprovedPlanPath,
} from "../../shared/implement-plan-prompt.js";
import type { InjectedFile } from "./attachment-injector.js";

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

export interface PromptBuilderInput {
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
  injectedFiles: InjectedFile[];
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
   * Tool-level write enforcement is separate (see setup.ts permissions) —
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
}

// The prompt renders the injector's own result type — a local structural twin
// once lived here and silently dropped the size field (`size` vs `sizeBytes`),
// so the "(N bytes)" annotation never rendered. One type, one truth.
export type { InjectedFile } from "./attachment-injector.js";

/**
 * Which images ride the user message inline (in send order) and which
 * degraded to the file-pointer story — the shared vision wording
 * (attachment-vision.ts) keeps this prompt and the Cursor harness's
 * input-files section telling the agent the same thing.
 */
export interface VisionPromptInfo {
  inlineFilenames: string[];
  notViewable: NotViewableEntry[];
}

/**
 * Assemble the full system prompt from base instructions and contextual
 * sections. Pure function with no I/O.
 */
export function buildEnhancedSystemPrompt(input: PromptBuilderInput): string {
  let prompt = input.instructions;

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

  if (input.injectedFiles.length > 0) {
    prompt += buildInjectedFilesSection(
      input.injectedFiles, input.vision, input.downloadUrlKind,
    );
  }

  if (input.senderIdentity) {
    prompt +=
      "\n\n## Conversation sender\n\n" +
      formatSenderIdentityText(input.senderIdentity);
  }

  // Standing facts about the user (session context) come before the
  // carried conversation (bridge): the bridge may refer back to them.
  if (input.sessionContext) {
    prompt +=
      "\n\n## Session context\n\n" +
      formatSessionContextText(input.sessionContext);
  }

  if (input.contextBridge) {
    prompt +=
      "\n\n## Previous conversation context\n\n" +
      formatContextBridgeText(input.contextBridge);
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
      input.injectedFiles.map((f) => f.path),
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

function buildInjectedFilesSection(
  files: readonly InjectedFile[],
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

  for (const f of files) {
    const sizeInfo = ` (${f.sizeBytes} bytes)`;
    // A duplicate-renamed file (attachment-naming.ts) discloses its original
    // name so the agent can connect "the two report.pdfs" in the user's
    // message to distinct files on disk. A file with a minted download URL
    // (attachment-download-urls.ts) lists it beside the path for the remote
    // hand-off story.
    const renameInfo =
      f.renamedFrom !== undefined
        ? ` (renamed from duplicate '${f.renamedFrom}')`
        : "";
    const urlInfo =
      f.downloadUrl !== undefined ? ` — download URL: ${f.downloadUrl}` : "";
    section += `- \`${f.path}\`${sizeInfo}${renameInfo}${urlInfo}\n`;
  }

  // The URL hand-off line (shared wording, attachment-download-urls.ts)
  // renders only when some listed file actually carries a URL — its wording
  // keys on what kind of URL the storage backend mints.
  if (downloadUrlKind !== undefined && files.some((f) => f.downloadUrl !== undefined)) {
    section += "\n" + downloadUrlDisclosureLine(downloadUrlKind) + "\n";
  }

  // The vision lines (shared wording, attachment-vision.ts) tell the model
  // which of these files it can already SEE inline in the user message versus
  // which degraded to path-only — without them an agent silently ignores a
  // photo the user believes it can see.
  if (vision) {
    const lines = visionDisclosureLines(vision.inlineFilenames, vision.notViewable);
    if (lines.length > 0) {
      section += "\n" + lines.join("\n") + "\n";
    }
  }

  return section;
}
