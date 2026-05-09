/**
 * Maps Stigmer Session lifecycle to Cursor Agent lifecycle.
 *
 * SessionSpec.thread_id stores the Cursor agentId. This module handles
 * creating new agents (first execution), resuming existing agents
 * (subsequent executions), and cleaning up agents (session deletion).
 *
 * Key SDK limitation: mcpServers are NOT persisted across Agent.resume().
 * They must be passed again on every resume call.
 *
 * Platform store keying: The Cursor SDK defaults to process.cwd() for its
 * internal state root lookup. In Daytona sandboxes, process.cwd() is the
 * runner's app directory, not the workspace — causing Agent.resume() to
 * fail with "Agent not found". We pass explicit platform.workspaceRef and
 * platform.stateRoot derived from the Stigmer sessionId to ensure
 * deterministic store lookup regardless of process.cwd().
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

import { Agent } from "@cursor/sdk";
import type { SDKAgent, CursorAgentPlatformOptions } from "@cursor/sdk";
import type { CursorMcpServerConfig } from "./mcp-resolver.js";

const CURSOR_SDK_STATE_DIR = ".stigmer/cursor-sdk-state";

export interface CreateAgentOptions {
  apiKey: string;
  model: string;
  workspaceDirs: string[];
  sessionId: string;
  mcpServers?: Record<string, CursorMcpServerConfig>;
}

export interface ResumeAgentOptions {
  apiKey: string;
  agentId: string;
  sessionId: string;
  model?: string;
  mcpServers?: Record<string, CursorMcpServerConfig>;
}

/**
 * Compute deterministic platform options from a Stigmer sessionId.
 *
 * workspaceRef is a synthetic identifier (not a filesystem path) that
 * ensures the SDK's platform cache key is stable across activity
 * invocations regardless of process.cwd().
 *
 * stateRoot is a session-isolated directory under ~/.stigmer/ where
 * the SDK persists SQLite stores (agent records, runs, checkpoints).
 * Created eagerly to prevent ENOENT on first SDK write.
 */
export function resolvePlatformOptions(sessionId: string): CursorAgentPlatformOptions {
  const stateRoot = join(homedir(), CURSOR_SDK_STATE_DIR, sessionId);
  mkdirSync(stateRoot, { recursive: true });
  return {
    workspaceRef: `stigmer-session:${sessionId}`,
    stateRoot,
  };
}

/**
 * Create a new Cursor Agent for the first execution in a session.
 * Returns the agent handle and its durable agentId (to be stored as thread_id).
 *
 * Supports multi-workspace: passes string[] when multiple dirs, string when single.
 */
export async function createAgent(options: CreateAgentOptions): Promise<SDKAgent> {
  const cwd = options.workspaceDirs.length === 1
    ? options.workspaceDirs[0]
    : options.workspaceDirs;

  const platform = resolvePlatformOptions(options.sessionId);
  console.log(
    `createAgent: sessionId=${options.sessionId}, workspaceRef=${platform.workspaceRef}, ` +
    `stateRoot=${platform.stateRoot}, process.cwd=${process.cwd()}`,
  );

  return Agent.create({
    apiKey: options.apiKey,
    model: { id: options.model },
    local: { cwd },
    mcpServers: options.mcpServers as Record<string, any>,
    platform,
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
  const platform = resolvePlatformOptions(options.sessionId);
  console.log(
    `resumeAgent: agentId=${options.agentId}, sessionId=${options.sessionId}, ` +
    `workspaceRef=${platform.workspaceRef}, stateRoot=${platform.stateRoot}, ` +
    `process.cwd=${process.cwd()}`,
  );

  return Agent.resume(options.agentId, {
    apiKey: options.apiKey,
    model: options.model ? { id: options.model } : undefined,
    mcpServers: options.mcpServers as Record<string, any>,
    platform,
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
        sessionId: createOptions.sessionId,
        model: createOptions.model,
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
