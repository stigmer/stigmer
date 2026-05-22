/**
 * Builds the enhanced prompt for the Cursor agent.
 *
 * Replicates prompt_builder.py::enhance_system_prompt() but delivers
 * the content via the first user message (Cursor SDK has no systemPrompt
 * parameter). On reinvocation, only the approval decisions are sent.
 *
 * Sections (in order, conditionally included):
 * 1. Agent instructions (persona/character)
 * 2. Available skills metadata
 * 3. Sub-agent delegation guidance
 * 4. Workspace context (multi-root only; single-dir is redundant with SDK cwd)
 * 5. Input files / referenced files
 * 6. Response rules (only when agent has no custom instructions)
 * 7. User's actual message
 */

import { resolve } from "node:path";
import type { SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApprovalAction, InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

/**
 * Marker path segments that identify runner-internal directories. A workspace
 * dir containing any of these segments is almost certainly the runner's own
 * app directory, not a user workspace.
 */
const RUNNER_PATH_MARKERS = [
  "/runtimes/cursor-runner/",
  "/runtimes/agent-runner/",
  "/node_modules/",
  "/dist/main.js",
] as const;

export interface SkillMetadata {
  name: string;
  description: string;
  path: string;
}

export interface EnhancedPromptOptions {
  instructions: string;
  userMessage: string;
  skills: SkillMetadata[];
  subAgents: SubAgent[];
  workspaceDirs: string[];
  workspaceFileRefs: string[];
  attachmentPaths: string[];
  interactionMode?: InteractionMode;
}

/**
 * Build the enhanced prompt for the first execution in a session.
 *
 * Prepends agent blueprint information before the user's message so the
 * Cursor agent has full context. This avoids writing files to the workspace.
 */
export function buildEnhancedPrompt(options: EnhancedPromptOptions): string {
  const sections: string[] = [];

  const modePrefix = formatInteractionModePrefix(options.interactionMode);
  if (modePrefix) {
    sections.push(modePrefix);
  }

  if (options.instructions) {
    sections.push(formatInstructions(options.instructions));
  }

  if (options.skills.length > 0) {
    sections.push(formatSkillsSection(options.skills));
  }

  if (options.subAgents.length > 0) {
    sections.push(formatSubAgentsSection(options.subAgents));
  }

  const safeDirs = sanitizeWorkspaceDirs(options.workspaceDirs);
  if (safeDirs.length > 1) {
    sections.push(formatWorkspaceContext(safeDirs));
  }

  if (options.attachmentPaths.length > 0) {
    sections.push(formatInputFiles(options.attachmentPaths));
  }

  if (options.workspaceFileRefs.length > 0) {
    sections.push(formatReferencedFiles(options.workspaceFileRefs));
  }

  if (!options.instructions) {
    sections.push(formatResponseRules());
  }

  sections.push(`<user_request>\n${options.userMessage}\n</user_request>`);

  return sections.join("\n\n---\n\n");
}

/**
 * Build the reinvocation prompt after approval decisions.
 * Only contains approval instructions, no blueprint (it persists in context).
 */
export function buildReinvocationPrompt(
  approvalDecisions: Map<string, ApprovalAction>,
): string {
  const approved: string[] = [];
  const skipped: string[] = [];

  for (const [toolCallId, action] of approvalDecisions) {
    if (action === ApprovalAction.APPROVE) {
      approved.push(toolCallId);
    } else if (action === ApprovalAction.SKIP) {
      skipped.push(toolCallId);
    }
  }

  const parts: string[] = [];
  if (approved.length) {
    parts.push(
      `The user has approved the following tool calls. Please execute them now: ${approved.join(", ")}.`,
    );
  }
  if (skipped.length) {
    parts.push(
      `The user has skipped the following tool calls. Do not execute them and continue without them: ${skipped.join(", ")}.`,
    );
  }

  return parts.join("\n\n");
}

/**
 * Filters out workspace directories that appear to be runner-internal paths.
 * This prevents the prompt from exposing implementation details like
 * ~/.stigmer/runtimes/cursor-runner/... to the AI model.
 */
export function sanitizeWorkspaceDirs(dirs: string[]): string[] {
  const safe: string[] = [];

  for (const dir of dirs) {
    const resolved = resolve(dir);
    if (isRunnerInternalPath(resolved)) {
      console.warn(
        `Workspace dir "${dir}" appears to be a runner-internal path — ` +
        "omitting from prompt to prevent implementation detail leakage.",
      );
      continue;
    }
    safe.push(dir);
  }

  return safe;
}

function isRunnerInternalPath(absolutePath: string): boolean {
  return RUNNER_PATH_MARKERS.some((marker) => absolutePath.includes(marker));
}

export function formatInstructions(instructions: string): string {
  return `<agent_instructions>\n${instructions}\n</agent_instructions>`;
}

export function formatSkillsSection(skills: SkillMetadata[]): string {
  const entries = skills.map(
    (s) => `- **${s.name}**: ${s.description}\n  Path: \`${s.path}\``,
  );
  return [
    "<available_skills>",
    "You have access to the following skills. When a skill is relevant, read its SKILL.md file using the Read tool and follow the instructions within.",
    "",
    ...entries,
    "</available_skills>",
  ].join("\n");
}

export function formatSubAgentsSection(subAgents: SubAgent[]): string {
  const entries = subAgents.map((sa) => {
    const parts = [`- **${sa.name}**: ${sa.description}`];
    if (sa.mcpAccess.length > 0) {
      const servers = sa.mcpAccess.map((a) => a.mcpServer).join(", ");
      parts.push(`  MCP access: ${servers}`);
    }
    if (sa.modelOverride) {
      parts.push(`  Model: ${sa.modelOverride}`);
    }
    return parts.join("\n");
  });

  return [
    "<sub_agent_delegation>",
    "You can delegate tasks to specialized sub-agents using the Task tool.",
    "Available sub-agents:",
    "",
    ...entries,
    "",
    "Delegation rules:",
    "- Use sub-agents for tasks that match their specialization",
    "- Provide clear, detailed task descriptions since sub-agents don't share your conversation context",
    "- Sub-agents run independently and return results when done",
    "</sub_agent_delegation>",
  ].join("\n");
}

export function formatWorkspaceContext(dirs: string[]): string {
  if (dirs.length === 1) {
    return `<workspace>\nWorking directory: ${dirs[0]}\n</workspace>`;
  }

  const entries = dirs.map((d, i) => `${i + 1}. ${d}`);
  return [
    "<workspace>",
    "Multi-root workspace with the following directories:",
    ...entries,
    "</workspace>",
  ].join("\n");
}

export function formatInputFiles(paths: string[]): string {
  const entries = paths.map((p) => `- \`${p}\``);
  return [
    "<input_files>",
    "The following files have been provided as inputs. Read them when relevant to the task:",
    ...entries,
    "</input_files>",
  ].join("\n");
}

export function formatReferencedFiles(refs: string[]): string {
  const entries = refs.map((r) => `- \`${r}\``);
  return [
    "<referenced_files>",
    "The user has referenced the following workspace files. Read them when relevant:",
    ...entries,
    "</referenced_files>",
  ].join("\n");
}

/**
 * Returns a system-level directive when the execution is in Plan mode.
 * Returns `undefined` for Agent mode (default) since no prefix is needed.
 */
export function formatInteractionModePrefix(
  mode: InteractionMode | undefined,
): string | undefined {
  if (
    mode == null ||
    mode === InteractionMode.UNSPECIFIED ||
    mode === InteractionMode.AGENT
  ) {
    return undefined;
  }

  if (mode === InteractionMode.PLAN) {
    return [
      "<interaction_mode>",
      "IMPORTANT: You are in Plan mode. Analyze the codebase and produce a detailed plan.",
      "Do NOT create, edit, or delete any files. Do NOT run commands that modify the filesystem.",
      "Only read, search, and analyze. Your output should be analysis, recommendations, and",
      "implementation plans — not code changes.",
      "</interaction_mode>",
    ].join("\n");
  }

  return undefined;
}

export function formatResponseRules(): string {
  return [
    "<response_rules>",
    "- Be concise and direct in your responses",
    "- When making code changes, explain what you changed and why",
    "- If a task is unclear, ask for clarification before proceeding",
    "- Prefer editing existing files over creating new ones",
    "</response_rules>",
  ].join("\n");
}
