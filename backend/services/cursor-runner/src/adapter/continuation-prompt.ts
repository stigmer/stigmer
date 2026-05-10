/**
 * Continuation Prompt Builder — constructs context-rich prompts for fresh
 * or unreliable Cursor agents using persisted SessionMemory.
 *
 * Two prompt shapes:
 *
 * 1. Normal continuation: A fresh agent (or one whose local context is
 *    unreliable) receives the full agent identity (instructions, skills,
 *    workspace) plus durable session memory plus the new user message.
 *    Used in LOCAL mode on every subsequent execution.
 *
 * 2. HITL continuation: A fresh agent is created after the previous one
 *    expired while waiting for human approval. The agent receives the
 *    approval details, diagnostic context at deny-time, and session memory.
 *    It must inspect current workspace state and confirm/revise/refuse the
 *    previously proposed action.
 *
 * Both prompt shapes reuse formatting helpers from prompt-builder.ts for
 * the agent identity sections, keeping visual structure consistent.
 *
 * Token budget: Total continuation prompt ceiling is 8k tokens. When the
 * memory sections would exceed budget, truncation follows this priority:
 *   1. recent_turns (evict oldest)
 *   2. tool_observations (truncate summaries)
 *   3. durable_summary (trim from front)
 * Agent context sections (instructions, skills) are never truncated.
 */

import type { SessionMemory, ToolObservation, ConversationTurn } from "@stigmer/protos/ai/stigmer/agentic/session/v1/memory_pb";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { SubAgent } from "@stigmer/protos/ai/stigmer/agentic/agent/v1/spec_pb";
import { ApprovalAction, MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import {
  formatInstructions,
  formatSkillsSection,
  formatSubAgentsSection,
  formatWorkspaceContext,
  formatInputFiles,
  formatReferencedFiles,
  formatResponseRules,
  sanitizeWorkspaceDirs,
} from "./prompt-builder.js";
import type { SkillMetadata } from "./prompt-builder.js";
import { estimateTokens, truncateToTokenBudget } from "./session-memory.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CONTINUATION_TOKEN_CEILING = 8_000;
const MAX_RATIONALE_CHARS = 500;

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface ContinuationPromptOptions {
  instructions: string;
  skills: SkillMetadata[];
  subAgents: SubAgent[];
  workspaceDirs: string[];
  workspaceFileRefs: string[];
  attachmentPaths: string[];
  sessionMemory: SessionMemory;
  userMessage: string;
}

export interface HitlContinuationPromptOptions {
  instructions: string;
  skills: SkillMetadata[];
  subAgents: SubAgent[];
  workspaceDirs: string[];
  sessionMemory: SessionMemory;
  pendingApprovals: PendingApproval[];
  approvalDecisions: Map<string, ApprovalAction>;
}

// ---------------------------------------------------------------------------
// Normal continuation prompt
// ---------------------------------------------------------------------------

/**
 * Build a complete continuation prompt for a fresh/unreliable agent.
 *
 * Includes the full agent identity (instructions, skills, workspace),
 * durable session memory, and the current user message. The agent receives
 * everything it needs to continue the conversation seamlessly.
 */
export function buildContinuationPrompt(options: ContinuationPromptOptions): string {
  const agentSections = buildAgentContextSections({
    instructions: options.instructions,
    skills: options.skills,
    subAgents: options.subAgents,
    workspaceDirs: options.workspaceDirs,
    workspaceFileRefs: options.workspaceFileRefs,
    attachmentPaths: options.attachmentPaths,
  });

  const memorySections = buildMemorySections(options.sessionMemory);

  const userSection = `<current_user_message>\n${options.userMessage}\n</current_user_message>`;

  const allSections = [
    formatContinuationContract(),
    ...agentSections,
    ...memorySections,
    userSection,
  ];

  return enforceTokenBudget(allSections, options.sessionMemory);
}

// ---------------------------------------------------------------------------
// HITL continuation prompt
// ---------------------------------------------------------------------------

/**
 * Build a continuation prompt for reinvocation after delayed human approval.
 *
 * The fresh agent receives the previously proposed action, the approval
 * decision, diagnostic context from deny-time, and session memory. It must
 * inspect the current workspace and decide whether to proceed, revise, or
 * refuse the action.
 */
export function buildHitlContinuationPrompt(options: HitlContinuationPromptOptions): string {
  const agentSections = buildAgentContextSections({
    instructions: options.instructions,
    skills: options.skills,
    subAgents: options.subAgents,
    workspaceDirs: options.workspaceDirs,
    workspaceFileRefs: [],
    attachmentPaths: [],
  });

  const hitlSection = formatHitlContinuation(
    options.pendingApprovals,
    options.approvalDecisions,
  );

  const memorySections = buildMemorySectionsForHitl(options.sessionMemory);

  const allSections = [
    hitlSection,
    ...agentSections,
    ...memorySections,
  ];

  return enforceTokenBudget(allSections, options.sessionMemory);
}

// ---------------------------------------------------------------------------
// Agent context (shared between both prompt types)
// ---------------------------------------------------------------------------

interface AgentContextOptions {
  instructions: string;
  skills: SkillMetadata[];
  subAgents: SubAgent[];
  workspaceDirs: string[];
  workspaceFileRefs: string[];
  attachmentPaths: string[];
}

function buildAgentContextSections(options: AgentContextOptions): string[] {
  const sections: string[] = [];

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
  if (safeDirs.length > 0) {
    sections.push(formatWorkspaceContext(safeDirs));
  }

  if (options.attachmentPaths.length > 0) {
    sections.push(formatInputFiles(options.attachmentPaths));
  }

  if (options.workspaceFileRefs.length > 0) {
    sections.push(formatReferencedFiles(options.workspaceFileRefs));
  }

  sections.push(formatResponseRules());

  return sections;
}

// ---------------------------------------------------------------------------
// Memory formatting (normal continuation)
// ---------------------------------------------------------------------------

function buildMemorySections(memory: SessionMemory): string[] {
  const sections: string[] = [];

  if (memory.durableSummary) {
    sections.push(
      `<durable_summary>\n${memory.durableSummary}\n</durable_summary>`,
    );
  }

  if (memory.decisions.length > 0) {
    const entries = memory.decisions.map((d) => `- ${d}`).join("\n");
    sections.push(
      `<decisions>\nPrevious decisions made in this session:\n${entries}\n</decisions>`,
    );
  }

  if (memory.failedAttempts.length > 0) {
    const entries = memory.failedAttempts.map((f) => `- ${f}`).join("\n");
    sections.push(
      `<failed_attempts>\nApproaches that failed — do not repeat these:\n${entries}\n</failed_attempts>`,
    );
  }

  if (memory.changedFiles.length > 0) {
    const entries = memory.changedFiles.map((f) => `- ${f}`).join("\n");
    sections.push(
      `<changed_files>\nFiles modified in this session:\n${entries}\n</changed_files>`,
    );
  }

  if (memory.openTasks.length > 0) {
    const entries = memory.openTasks.map((t) => `- ${t}`).join("\n");
    sections.push(
      `<open_tasks>\nOutstanding tasks:\n${entries}\n</open_tasks>`,
    );
  }

  if (memory.recentTurns.length > 0) {
    sections.push(formatRecentTurns(memory.recentTurns));
  }

  if (memory.toolObservations.length > 0) {
    sections.push(formatToolObservations(memory.toolObservations));
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Memory formatting (HITL — subset, no changed_files/open_tasks)
// ---------------------------------------------------------------------------

function buildMemorySectionsForHitl(memory: SessionMemory): string[] {
  const sections: string[] = [];

  if (memory.durableSummary) {
    sections.push(
      `<durable_summary>\n${memory.durableSummary}\n</durable_summary>`,
    );
  }

  if (memory.decisions.length > 0) {
    const entries = memory.decisions.map((d) => `- ${d}`).join("\n");
    sections.push(
      `<decisions>\nPrevious decisions made in this session:\n${entries}\n</decisions>`,
    );
  }

  if (memory.recentTurns.length > 0) {
    sections.push(formatRecentTurns(memory.recentTurns));
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Section formatters
// ---------------------------------------------------------------------------

function formatContinuationContract(): string {
  return [
    "<continuation_contract>",
    "You are continuing a conversation that was started by a previous agent instance.",
    "The context below is durable session memory extracted from prior execution turns.",
    "",
    "Critical rules:",
    "- The live filesystem is the source of truth. Before editing a file, inspect it first.",
    "- Do not assume old command output is still current — re-run commands if needed.",
    "- Do not repeat approaches listed in <failed_attempts> unless you have a new strategy.",
    "- Honor decisions in <decisions> unless explicitly told otherwise by the user.",
    "- If the session state is unclear, ask the user for clarification.",
    "</continuation_contract>",
  ].join("\n");
}

function formatHitlContinuation(
  pendingApprovals: PendingApproval[],
  approvalDecisions: Map<string, ApprovalAction>,
): string {
  const approvalBlocks = pendingApprovals.map((pa) => {
    const decision = approvalDecisions.get(pa.toolCallId);
    const decisionLabel = decision === ApprovalAction.APPROVE
      ? "APPROVED"
      : decision === ApprovalAction.SKIP
        ? "SKIPPED"
        : "UNKNOWN";

    const lines: string[] = [
      `  Tool: ${pa.toolName}`,
      `  Arguments: ${pa.argsPreview || "(none)"}`,
    ];

    if (pa.agentRationale) {
      lines.push(`  Original rationale: ${pa.agentRationale}`);
    }

    lines.push(`  Decision: ${decisionLabel}`);

    if (pa.branchAtDeny || pa.headShaAtDeny) {
      lines.push(`  Workspace at deny-time:`);
      if (pa.branchAtDeny) {
        lines.push(`    Branch: ${pa.branchAtDeny}`);
      }
      if (pa.headShaAtDeny) {
        lines.push(`    HEAD: ${pa.headShaAtDeny}`);
      }
    }

    return lines.join("\n");
  });

  return [
    "<hitl_continuation>",
    "You are resuming a previously paused task after human approval.",
    "Your job is NOT to blindly execute the prior action.",
    "Inspect the current workspace state and determine whether the",
    "approved action is still appropriate.",
    "",
    "Previously proposed action(s):",
    ...approvalBlocks,
    "",
    "You must:",
    "- Inspect current workspace and git state",
    "- Verify the action still makes sense given current state",
    "- For each approved tool, choose one of:",
    "  CONFIRM_EXECUTE: proceed with the action as-is",
    "  REVISE_ACTION: propose an updated action if conditions changed",
    "  REFUSE: explain what changed and why you cannot proceed",
    "- For skipped tools: acknowledge and continue without them",
    "</hitl_continuation>",
  ].join("\n");
}

function formatRecentTurns(turns: ConversationTurn[]): string {
  const formatted = turns.map((t) => {
    const role = t.role === "user" ? "User" : "Assistant";
    return `[${role}]: ${t.content}`;
  });

  return [
    "<recent_turns>",
    "Recent conversation history:",
    ...formatted,
    "</recent_turns>",
  ].join("\n");
}

function formatToolObservations(observations: ToolObservation[]): string {
  const formatted = observations.map((o) => {
    const exitLabel = o.exitCode === 0 ? "ok" : `exit ${o.exitCode}`;
    return `- \`${o.command}\` (${exitLabel}): ${o.summary}`;
  });

  return [
    "<tool_observations>",
    "Significant tool results from prior execution:",
    ...formatted,
    "</tool_observations>",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Token budget enforcement
// ---------------------------------------------------------------------------

/**
 * Enforce the 8k token ceiling on the combined prompt.
 *
 * If the prompt exceeds budget, sections are progressively truncated:
 *   1. recent_turns — evict oldest turns
 *   2. tool_observations — shorten observation summaries
 *   3. durable_summary — trim from front
 *
 * Agent context sections (instructions, skills, workspace) are never
 * truncated — they are considered essential for agent identity.
 */
function enforceTokenBudget(sections: string[], memory: SessionMemory): string {
  const joined = sections.join("\n\n---\n\n");
  const totalTokens = estimateTokens(joined);

  if (totalTokens <= CONTINUATION_TOKEN_CEILING) {
    return joined;
  }

  const overflow = totalTokens - CONTINUATION_TOKEN_CEILING;
  const truncatedSections = truncateMemorySections(sections, memory, overflow);
  return truncatedSections.join("\n\n---\n\n");
}

/**
 * Progressively truncate memory sections to reclaim the specified token count.
 *
 * Truncation priority:
 *   1. recent_turns section (remove oldest turns until budget met)
 *   2. tool_observations section (shorten summaries)
 *   3. durable_summary section (trim content)
 */
function truncateMemorySections(
  sections: string[],
  memory: SessionMemory,
  tokensToReclaim: number,
): string[] {
  const result = [...sections];
  let reclaimed = 0;

  // Phase 1: Truncate recent_turns
  const turnsIdx = result.findIndex((s) => s.startsWith("<recent_turns>"));
  if (turnsIdx !== -1 && reclaimed < tokensToReclaim) {
    const turns = [...memory.recentTurns];
    while (turns.length > 0 && reclaimed < tokensToReclaim) {
      const removed = turns.shift()!;
      const removedTokens = estimateTokens(`[${removed.role === "user" ? "User" : "Assistant"}]: ${removed.content}`);
      reclaimed += removedTokens;
    }

    if (turns.length === 0) {
      result.splice(turnsIdx, 1);
    } else {
      result[turnsIdx] = formatRecentTurns(turns);
    }
  }

  // Phase 2: Truncate tool_observations
  const obsIdx = result.findIndex((s) => s.startsWith("<tool_observations>"));
  if (obsIdx !== -1 && reclaimed < tokensToReclaim) {
    const oldSection = result[obsIdx];
    const oldTokens = estimateTokens(oldSection);
    result.splice(obsIdx, 1);
    reclaimed += oldTokens;
  }

  // Phase 3: Truncate durable_summary
  const summaryIdx = result.findIndex((s) => s.startsWith("<durable_summary>"));
  if (summaryIdx !== -1 && reclaimed < tokensToReclaim) {
    const summaryContent = memory.durableSummary;
    const currentTokens = estimateTokens(summaryContent);
    const allowedTokens = Math.max(200, currentTokens - (tokensToReclaim - reclaimed));
    const truncated = truncateToTokenBudget(summaryContent, allowedTokens);
    result[summaryIdx] = `<durable_summary>\n${truncated}\n</durable_summary>`;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Deny-time diagnostic utilities
// ---------------------------------------------------------------------------

/**
 * Extract the agent's rationale for a tool call from the message history.
 *
 * Heuristic: Takes the content of the last AI message, which typically
 * contains the agent's explanation of what it's about to do. Truncated
 * to MAX_RATIONALE_CHARS to keep the approval record concise.
 *
 * Returns empty string if no AI messages exist.
 */
export function extractAgentRationale(
  messages: AgentMessage[],
  _toolCallId: string,
): string {
  const aiMessages = messages.filter((m) => m.type === MessageType.MESSAGE_AI);
  if (aiMessages.length === 0) return "";

  const lastAi = aiMessages[aiMessages.length - 1];
  if (!lastAi.content) return "";

  if (lastAi.content.length <= MAX_RATIONALE_CHARS) {
    return lastAi.content;
  }

  return lastAi.content.slice(-MAX_RATIONALE_CHARS);
}

/**
 * Get the current git branch name for a workspace directory.
 *
 * Best-effort: returns empty string on failure (non-git workspace,
 * missing git binary, detached HEAD). Never throws.
 */
export async function getGitBranch(workspaceDir: string): Promise<string> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: workspaceDir,
      timeout: 5_000,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

/**
 * Get the current git HEAD SHA for a workspace directory.
 *
 * Best-effort: returns empty string on failure. Never throws.
 */
export async function getGitHeadSha(workspaceDir: string): Promise<string> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
      cwd: workspaceDir,
      timeout: 5_000,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}
