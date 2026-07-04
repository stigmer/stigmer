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
import { PLAN_MODE_DIRECTIVE } from "../../shared/plan-mode-prompt.js";
import {
  buildImplementPlanDirective,
  findApprovedPlanPath,
} from "../../shared/implement-plan-prompt.js";

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
  workspaceFileRefs: string[];
  workspaceRoot: string;
  injectedFiles: InjectedFile[];
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
}

export interface InjectedFile {
  filename: string;
  path: string;
  size?: number | null;
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
    prompt += buildInjectedFilesSection(input.injectedFiles);
  }

  prompt += RESPONSE_RULES;
  prompt += SUB_AGENT_RULES;

  // Last sections on purpose: these per-execution directives redefine the
  // turn's deliverable, so they must be the freshest instruction the model
  // reads. (PLAN and build_from_plan are mutually exclusive in practice —
  // the build turn is always an Agent-mode execution.)
  if (input.interactionMode === InteractionMode.PLAN) {
    prompt += "\n\n## Plan mode\n\n" + PLAN_MODE_DIRECTIVE;
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

function buildInjectedFilesSection(files: InjectedFile[]): string {
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
    const sizeInfo = f.size != null ? ` (${f.size} bytes)` : "";
    section += `- \`${f.path}\`${sizeInfo}\n`;
  }

  return section;
}
