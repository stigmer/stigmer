/**
 * Maps Stigmer Session lifecycle to Cursor Agent lifecycle.
 *
 * SessionSpec.harness_state_id stores the Cursor agentId. This module handles
 * creating new agents (first execution), resuming existing agents
 * (subsequent executions), graceful fallback on resume failure, and
 * cleaning up agents (session deletion).
 *
 * Two execution modes:
 *
 * - Local mode: Agent.create({ local: { cwd } }) with explicit
 *   platform.workspaceRef/stateRoot for deterministic store keying.
 *   Produces agent- prefixed IDs.
 *
 * - Cloud mode (feature-flagged): Agent.create({ cloud: { repos } })
 *   for git-backed workspaces. Produces bc- prefixed IDs. No platform
 *   options — cloud state lives on Cursor's servers, not local SQLite.
 *
 * Key SDK limitation: mcpServers are NOT persisted across Agent.resume().
 * They must be passed again on every resume call.
 *
 * Platform store keying (local only): The Cursor SDK defaults to
 * process.cwd() for its internal state root lookup. In cloud sandboxes,
 * process.cwd() is the runner's app directory, not the workspace — causing
 * Agent.resume() to fail with "Agent not found". We pass explicit
 * platform.workspaceRef and platform.stateRoot derived from the Stigmer
 * sessionId to ensure deterministic store lookup regardless of process.cwd().
 *
 * Durability model: the SDK's local SQLite store (agent records, runs,
 * checkpoints) is the source of truth for conversation continuation. It is
 * persisted under the durable workspace volume (see resolvePlatformOptions)
 * so Agent.resume() survives pod restart, reschedule, and snapshot restore.
 * When resume nonetheless fails (store lost, corrupted, or agent unknown),
 * this module creates a fresh agent and the caller starts a new turn from
 * the user message plus re-injected instructions — there is no separate
 * continuation store.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { Agent } from "@cursor/sdk";
import type { SDKAgent, CursorAgentPlatformOptions, AgentDefinition } from "@cursor/sdk";
import type { CursorMcpServerConfig } from "./mcp-resolver.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURSOR_SDK_STATE_DIR = ".stigmer/cursor-sdk-state";

// ---------------------------------------------------------------------------
// Public types — local mode
// ---------------------------------------------------------------------------

export interface CreateAgentOptions {
  apiKey: string;
  model: string;
  workspaceDirs: string[];
  sessionId: string;
  /** Durable workspace volume root; the SDK state store lives under it. */
  workspaceRootDir: string;
  mcpServers?: Record<string, CursorMcpServerConfig>;
  /**
   * Custom sub-agents registered with the Cursor SDK so the parent can delegate
   * to them by name via the Task tool. Not persisted across resume, so it must
   * be re-supplied on every create/resume (mirrors mcpServers).
   */
  agents?: Record<string, AgentDefinition>;
}

export interface ResumeAgentOptions {
  apiKey: string;
  agentId: string;
  sessionId: string;
  /** Durable workspace volume root; the SDK state store lives under it. */
  workspaceRootDir: string;
  model?: string;
  mcpServers?: Record<string, CursorMcpServerConfig>;
  /** Custom sub-agents — see {@link CreateAgentOptions.agents}. */
  agents?: Record<string, AgentDefinition>;
}

// ---------------------------------------------------------------------------
// Public types — cloud mode
// ---------------------------------------------------------------------------

export interface CloudRepo {
  url: string;
  startingRef?: string;
}

export interface CreateCloudAgentOptions {
  apiKey: string;
  model?: string;
  repos: CloudRepo[];
  sessionId: string;
  mcpServers?: Record<string, CursorMcpServerConfig>;
  /** Custom sub-agents — see {@link CreateAgentOptions.agents}. */
  agents?: Record<string, AgentDefinition>;
}

export interface ResumeCloudAgentOptions {
  apiKey: string;
  agentId: string;
  model?: string;
  mcpServers?: Record<string, CursorMcpServerConfig>;
  /** Custom sub-agents — see {@link CreateAgentOptions.agents}. */
  agents?: Record<string, AgentDefinition>;
}

// ---------------------------------------------------------------------------
// Public types — resolution result
// ---------------------------------------------------------------------------

/**
 * Discriminated reason explaining how the agent was resolved.
 *
 * Drives prompt selection in execute-cursor.ts:
 * - created_first_execution: first turn, fresh agent
 * - resumed_successfully: subsequent turn, agent alive (native context)
 * - created_after_resume_failure: agent unknown/lost, fresh agent (no prior context)
 */
export type AgentResolutionReason =
  | "created_first_execution"
  | "resumed_successfully"
  | "created_after_resume_failure";

/**
 * Result of resolveAgent() — carries the agent handle plus metadata that
 * downstream phases use for prompt selection, harness_state_id persistence, and
 * diagnostic logging.
 */
export interface AgentResolution {
  agent: SDKAgent;
  agentId: string;
  isNew: boolean;
  resumed: boolean;
  mode: "local" | "cloud";
  reason: AgentResolutionReason;
  /** Non-empty only when reason is "created_after_resume_failure". */
  resumeFailureDetail?: string;
}

// ---------------------------------------------------------------------------
// Local agent functions
// ---------------------------------------------------------------------------

/**
 * Compute deterministic platform options for a Stigmer session.
 *
 * workspaceRef is a synthetic identifier (not a filesystem path) that
 * ensures the SDK's platform cache key is stable across activity
 * invocations regardless of process.cwd().
 *
 * stateRoot is a session-isolated directory under the durable workspace
 * volume ({workspaceRootDir}/.stigmer/cursor-sdk-state/{sessionId}) where
 * the SDK persists its SQLite stores (agent records, runs, checkpoints).
 * Placing it on the workspace volume (rather than $HOME) makes native
 * Agent.resume() survive pod restart/reschedule and snapshot restore, and
 * keys it by sessionId so sessions sharing one volume (e.g. the child agent
 * executions of a workflow sandbox) never collide. Created eagerly to
 * prevent ENOENT on first SDK write.
 *
 * Both inputs are required and must be non-empty: the stateRoot is keyed by
 * sessionId, so an empty sessionId would collapse every session sharing the
 * volume onto the same store and corrupt their conversation state.
 */
export function resolvePlatformOptions(
  sessionId: string,
  workspaceRootDir: string,
): CursorAgentPlatformOptions {
  if (!sessionId) {
    throw new Error(
      "resolvePlatformOptions: sessionId is required but was empty. The Cursor SDK " +
      "state store is keyed by sessionId; an empty value would collide across sessions " +
      "sharing a workspace volume (e.g. a workflow sandbox's child agent executions).",
    );
  }
  if (!workspaceRootDir) {
    throw new Error(
      "resolvePlatformOptions: workspaceRootDir is required but was empty. The Cursor " +
      "SDK state store must live on the durable workspace volume to survive restarts.",
    );
  }
  const stateRoot = join(workspaceRootDir, CURSOR_SDK_STATE_DIR, sessionId);
  mkdirSync(stateRoot, { recursive: true });
  return {
    workspaceRef: `stigmer-session:${sessionId}`,
    stateRoot,
  };
}

/**
 * Create a new local Cursor Agent for the first execution in a session.
 *
 * Supports multi-workspace: passes string[] when multiple dirs, string when single.
 */
export async function createAgent(options: CreateAgentOptions): Promise<SDKAgent> {
  const cwd = options.workspaceDirs.length === 1
    ? options.workspaceDirs[0]
    : options.workspaceDirs;

  const platform = resolvePlatformOptions(options.sessionId, options.workspaceRootDir);
  console.log(
    `createAgent: sessionId=${options.sessionId}, workspaceRef=${platform.workspaceRef}, ` +
    `stateRoot=${platform.stateRoot}, process.cwd=${process.cwd()}`,
  );

  return Agent.create({
    apiKey: options.apiKey,
    model: { id: options.model },
    local: { cwd },
    mcpServers: options.mcpServers as Record<string, any>,
    agents: options.agents,
    platform,
  });
}

/**
 * Resume an existing local Cursor Agent for subsequent executions.
 *
 * Throws on failure — the caller (resolveAgent) decides whether to
 * propagate or fall back to a fresh agent with continuation context.
 */
export async function resumeAgent(options: ResumeAgentOptions): Promise<SDKAgent> {
  const platform = resolvePlatformOptions(options.sessionId, options.workspaceRootDir);
  console.log(
    `resumeAgent: agentId=${options.agentId}, sessionId=${options.sessionId}, ` +
    `workspaceRef=${platform.workspaceRef}, stateRoot=${platform.stateRoot}, ` +
    `process.cwd=${process.cwd()}`,
  );

  return Agent.resume(options.agentId, {
    apiKey: options.apiKey,
    model: options.model ? { id: options.model } : undefined,
    mcpServers: options.mcpServers as Record<string, any>,
    agents: options.agents,
    platform,
  });
}

// ---------------------------------------------------------------------------
// Cloud agent functions
// ---------------------------------------------------------------------------

/**
 * Create a new cloud Cursor Agent for git-backed sessions.
 *
 * Cloud agents (bc- prefix) run on Cursor's servers with cloned repos.
 * No platform options — cloud state lives server-side, not in local SQLite.
 * Model is optional — Cursor resolves the caller's configured default
 * when omitted.
 */
export async function createCloudAgent(options: CreateCloudAgentOptions): Promise<SDKAgent> {
  console.log(
    `createCloudAgent: sessionId=${options.sessionId}, ` +
    `repos=${options.repos.map((r) => r.url).join(", ")}`,
  );

  return Agent.create({
    apiKey: options.apiKey,
    model: options.model ? { id: options.model } : undefined,
    cloud: { repos: options.repos },
    mcpServers: options.mcpServers as Record<string, any>,
    agents: options.agents,
  });
}

/**
 * Resume an existing cloud Cursor Agent for subsequent executions.
 *
 * Throws on failure — the caller (resolveAgent) decides whether to
 * propagate or fall back to a fresh cloud agent with continuation context.
 * No platform options — cloud state lives server-side.
 */
export async function resumeCloudAgent(options: ResumeCloudAgentOptions): Promise<SDKAgent> {
  console.log(
    `resumeCloudAgent: agentId=${options.agentId}`,
  );

  return Agent.resume(options.agentId, {
    apiKey: options.apiKey,
    model: options.model ? { id: options.model } : undefined,
    mcpServers: options.mcpServers as Record<string, any>,
    agents: options.agents,
  });
}

// ---------------------------------------------------------------------------
// Unified resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a Cursor Agent for execution: resume if possible, create with
 * graceful fallback if resume fails.
 *
 * The mode parameter determines which create/resume functions are used:
 * - "local": createAgent / resumeAgent (with platform options)
 * - "cloud": createCloudAgent / resumeCloudAgent (no platform options)
 *
 * When harnessStateId is non-empty (subsequent execution):
 *   1. Attempt Agent.resume with mode-appropriate options.
 *   2. On success: return { resumed: true, reason: "resumed_successfully" }.
 *   3. On failure: log warning, create a fresh agent, return
 *      { resumed: false, reason: "created_after_resume_failure" }.
 *      The fresh agent has no prior conversation context; the caller
 *      starts a new turn from the user message and re-injected instructions.
 *
 * When harnessStateId is empty (first execution):
 *   Create a new agent; return { reason: "created_first_execution" }.
 *
 * Agent creation failures always propagate — if we cannot create an agent
 * at all, that is an unrecoverable infrastructure error.
 */
export async function resolveAgent(
  harnessStateId: string,
  options: CreateAgentOptions | CreateCloudAgentOptions,
  mode: "local" | "cloud" = "local",
): Promise<AgentResolution> {
  if (harnessStateId) {
    try {
      const agent = mode === "cloud"
        ? await resumeCloudAgent({
            apiKey: options.apiKey,
            agentId: harnessStateId,
            model: options.model,
            mcpServers: options.mcpServers,
            agents: options.agents,
          })
        : await resumeAgent({
            apiKey: options.apiKey,
            agentId: harnessStateId,
            sessionId: (options as CreateAgentOptions).sessionId,
            workspaceRootDir: (options as CreateAgentOptions).workspaceRootDir,
            model: options.model,
            mcpServers: options.mcpServers,
            agents: options.agents,
          });

      return {
        agent,
        agentId: agent.agentId,
        isNew: false,
        resumed: true,
        mode,
        reason: "resumed_successfully",
      };
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      console.warn(
        `resolveAgent: resume failed for ${mode} agent "${harnessStateId}", ` +
        `creating fresh agent (no prior context). ` +
        `sessionId=${options.sessionId}, error: ${detail}`,
      );

      const agent = mode === "cloud"
        ? await createCloudAgent(options as CreateCloudAgentOptions)
        : await createAgent(options as CreateAgentOptions);

      console.log(
        `resolveAgent: fallback ${mode} agent created. ` +
        `oldAgentId=${harnessStateId}, newAgentId=${agent.agentId}, ` +
        `sessionId=${options.sessionId}`,
      );

      return {
        agent,
        agentId: agent.agentId,
        isNew: true,
        resumed: false,
        mode,
        reason: "created_after_resume_failure",
        resumeFailureDetail: detail,
      };
    }
  }

  const agent = mode === "cloud"
    ? await createCloudAgent(options as CreateCloudAgentOptions)
    : await createAgent(options as CreateAgentOptions);

  return {
    agent,
    agentId: agent.agentId,
    isNew: true,
    resumed: false,
    mode,
    reason: "created_first_execution",
  };
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
