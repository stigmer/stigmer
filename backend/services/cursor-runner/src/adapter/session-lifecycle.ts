/**
 * Maps Stigmer Session lifecycle to Cursor Agent lifecycle.
 *
 * SessionSpec.thread_id stores the Cursor agentId. This module handles
 * creating new agents (first execution), resuming existing agents
 * (subsequent executions), and cleaning up agents (session deletion).
 *
 * Key SDK limitation: mcpServers are NOT persisted across Agent.resume().
 * They must be passed again on every resume call.
 */

import { Agent } from "@cursor/sdk";
import type { SDKAgent } from "@cursor/sdk";
import type { CursorMcpServerConfig } from "./mcp-resolver.js";

export interface CreateAgentOptions {
  apiKey: string;
  model: string;
  workspaceCwd: string;
  mcpServers?: Record<string, CursorMcpServerConfig>;
}

export interface ResumeAgentOptions {
  apiKey: string;
  agentId: string;
  mcpServers?: Record<string, CursorMcpServerConfig>;
}

/**
 * Create a new Cursor Agent for the first execution in a session.
 * Returns the agent handle and its durable agentId (to be stored as thread_id).
 */
export async function createAgent(options: CreateAgentOptions): Promise<SDKAgent> {
  return Agent.create({
    apiKey: options.apiKey,
    model: { id: options.model },
    local: { cwd: options.workspaceCwd },
    mcpServers: options.mcpServers as Record<string, any>,
  });
}

/**
 * Resume an existing Cursor Agent for subsequent executions.
 *
 * If the agent is not found (expired, deleted on Cursor's side), this
 * throws. The caller must NOT silently create a new agent — that would
 * lose conversation context without any indication to the user.
 */
export async function resumeAgent(options: ResumeAgentOptions): Promise<SDKAgent> {
  return Agent.resume(options.agentId, {
    apiKey: options.apiKey,
    mcpServers: options.mcpServers as Record<string, any>,
  });
}

/**
 * Resolve agent: resume if threadId exists, create if first execution.
 *
 * When threadId is non-empty (subsequent execution), the agent MUST be
 * resumed successfully. If resume fails (agent expired, deleted, or
 * Cursor service error), the error propagates — creating a new agent
 * would silently discard the entire conversation history.
 *
 * When threadId is empty (first execution), a new agent is created.
 */
export async function resolveAgent(
  threadId: string,
  createOptions: CreateAgentOptions,
): Promise<{ agent: SDKAgent; isNew: boolean }> {
  if (threadId) {
    try {
      const agent = await resumeAgent({
        apiKey: createOptions.apiKey,
        agentId: threadId,
        mcpServers: createOptions.mcpServers,
      });
      return { agent, isNew: false };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Failed to resume Cursor agent "${threadId}" for this session. ` +
        `The agent may have expired or been deleted on Cursor's side. ` +
        `Please start a new session to continue. ` +
        `Original error: ${detail}`,
      );
    }
  }

  const agent = await createAgent(createOptions);
  return { agent, isNew: true };
}

/**
 * Dispose a Cursor Agent when a session is deleted.
 * Best-effort: logs and swallows errors.
 */
export async function disposeAgent(agentId: string, apiKey: string): Promise<void> {
  try {
    await Agent.archive(agentId, { apiKey });
  } catch (err) {
    console.warn(
      `Failed to archive Cursor agent ${agentId}:`,
      err instanceof Error ? err.message : err,
    );
  }
}
