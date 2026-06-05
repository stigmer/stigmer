/**
 * Deny-time diagnostic utilities for HITL (human-in-the-loop) approvals.
 *
 * These helpers capture the agent's rationale and the workspace's git state
 * at the moment a tool call is proposed/denied, so the approval record
 * (PendingApproval.agent_rationale / branch_at_deny / head_sha_at_deny)
 * carries enough context for a human reviewer and for later reinvocation.
 */

import type { AgentMessage } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import { MessageType } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

const MAX_RATIONALE_CHARS = 500;

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
