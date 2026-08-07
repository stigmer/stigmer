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
import type {
  SDKAgent,
  CursorAgentPlatformOptions,
  AgentDefinition,
  ModelParameterValue,
} from "@cursor/sdk";
import { withTimeout, TimeoutError } from "../../shared/with-timeout.js";
import type { CursorMcpServerConfig } from "./mcp-resolver.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CURSOR_SDK_STATE_DIR = ".stigmer/cursor-sdk-state";

/**
 * Cursor SDK setting sources loaded for LOCAL agents.
 *
 * The Stigmer HITL approval gate is a `.cursor/hooks.json` preToolUse hook
 * written into the workspace (see workspace-setup.ts). The Cursor SDK only
 * loads workspace ("project") hooks when the "project" setting source is
 * enabled — internally `includeProjectHooks = settingSources.includes("project")`
 * (and the hooks subsystem itself is only constructed when a project/user
 * source is present). The SDK default is `[]` ("inline config only"), which
 * silently drops the hook and disables the entire approval gate. We must opt
 * in to "project" so the hook loads and tool calls are actually gated.
 *
 * The hooks.json is the only file written into the workspace — kept minimal,
 * merged with any user hooks.json, and restored when the turn ends; the gate's
 * own artifacts live outside the repo and the hook is scoped to this runner's
 * process, so the user's interactive IDE sharing the repo is never gated (see
 * workspace-setup.ts / hook-script.ts and issue #173).
 *
 * Side effect: this also loads other workspace `.cursor/*` config (rules,
 * mcp.json, commands). For runner-provisioned workspaces that is inert; for
 * sessions running on a user's own repo their project config is now honored.
 *
 * Cloud agents always load project settings server-side, so this is local-only.
 */
const LOCAL_SETTING_SOURCES = ["project"] as const;

// ---------------------------------------------------------------------------
// Public types — local mode
// ---------------------------------------------------------------------------

export interface CreateAgentOptions {
  apiKey: string;
  model: string;
  /**
   * Explicit variant parameters sent with the model selection on every
   * create AND resume (stigmer/stigmer#357). A bare `{ id }` lets the
   * Cursor catalog's default variant pick the price, so the caller always
   * supplies the pinned params from resolveServiceTierParams — possibly
   * empty (Auto, or a model with no price-bearing parameters), but never
   * absent by accident.
   */
  modelParams?: ModelParameterValue[];
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
  /**
   * Workspace directories — same as {@link CreateAgentOptions.workspaceDirs}.
   * NOT persisted across Agent.resume(): without an explicit cwd the SDK falls
   * back to process.cwd(), which both mis-roots the resumed agent and loads
   * the "project" setting source (and therefore the HITL approval hook in
   * .cursor/hooks.json) from the wrong directory — silently disabling the
   * approval gate on every resumed turn.
   */
  workspaceDirs: string[];
  /** Durable workspace volume root; the SDK state store lives under it. */
  workspaceRootDir: string;
  model?: string;
  /** Explicit variant parameters — see {@link CreateAgentOptions.modelParams}. */
  modelParams?: ModelParameterValue[];
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
  /** Explicit variant parameters — see {@link CreateAgentOptions.modelParams}. */
  modelParams?: ModelParameterValue[];
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
  /** Explicit variant parameters — see {@link CreateAgentOptions.modelParams}. */
  modelParams?: ModelParameterValue[];
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
    // Always a full selection — id AND params. A bare { id } would let the
    // catalog's default variant (account-influenced) pick the price (#357).
    model: { id: options.model, params: options.modelParams },
    local: { cwd, settingSources: [...LOCAL_SETTING_SOURCES] },
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
  const cwd = options.workspaceDirs.length === 1
    ? options.workspaceDirs[0]
    : options.workspaceDirs;

  const platform = resolvePlatformOptions(options.sessionId, options.workspaceRootDir);
  console.log(
    `resumeAgent: agentId=${options.agentId}, sessionId=${options.sessionId}, ` +
    `workspaceRef=${platform.workspaceRef}, stateRoot=${platform.stateRoot}, ` +
    `process.cwd=${process.cwd()}`,
  );

  return Agent.resume(options.agentId, {
    apiKey: options.apiKey,
    // Variant params must be re-supplied on resume exactly like mcpServers:
    // explicit params hold across resume (verified against the billing
    // ledger, #357), but an id-only resume would fall back to the catalog
    // default variant for the new turns.
    model: options.model ? { id: options.model, params: options.modelParams } : undefined,
    // Neither cwd nor settingSources survive Agent.resume(); both must be
    // re-supplied every turn. Omitting cwd makes the SDK fall back to
    // process.cwd(), which re-roots the agent in the runner's own working
    // directory and loads the "project" setting source — the .cursor/hooks.json
    // carrying the HITL approval hook — from that wrong directory, silently
    // disabling the approval gate on every resumed turn.
    local: { cwd, settingSources: [...LOCAL_SETTING_SOURCES] },
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
    model: options.model ? { id: options.model, params: options.modelParams } : undefined,
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
    model: options.model ? { id: options.model, params: options.modelParams } : undefined,
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
            modelParams: options.modelParams,
            mcpServers: options.mcpServers,
            agents: options.agents,
          })
        : await resumeAgent({
            apiKey: options.apiKey,
            agentId: harnessStateId,
            sessionId: (options as CreateAgentOptions).sessionId,
            workspaceDirs: (options as CreateAgentOptions).workspaceDirs,
            workspaceRootDir: (options as CreateAgentOptions).workspaceRootDir,
            model: options.model,
            modelParams: options.modelParams,
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

// ---------------------------------------------------------------------------
// Transport-recovery wrapper
// ---------------------------------------------------------------------------

export interface ResolveWithTransportRecoveryOptions {
  harnessStateId: string;
  createOptions: CreateAgentOptions | CreateCloudAgentOptions;
  mode: "local" | "cloud";
  /** Bound applied to each attempt independently. */
  timeoutMs: number;
  /**
   * Builds the timeout rejection message. `finalAttempt` is true when no
   * further automatic retry will follow, so the message can be honest about
   * whether "retry" means the system or the user.
   */
  buildTimeoutMessage: (finalAttempt: boolean) => string;
  /**
   * Closes the transport the hung attempt is riding on so the next attempt
   * dials fresh. Injected (rather than imported from the http2 interceptor)
   * to keep this module transport-agnostic and the recovery unit-testable.
   */
  resetTransport: () => void;
}

/**
 * Resolve a Cursor Agent with one automatic recovery from a transport hang.
 *
 * Agent.create/Agent.resume have no timeout of their own — a degraded
 * transport (dead proxy connection, stale HTTP/2 session) hangs them forever.
 * Each attempt is bounded by `timeoutMs`; when the first attempt expires,
 * the transport is reset and the full resolveAgent() is retried once. Only
 * a TimeoutError triggers recovery: deterministic failures (auth, validation)
 * propagate immediately — resetting the transport cannot fix them.
 *
 * The retry re-invokes resolveAgent(), not createAgent() directly: at
 * resolve time only the transport is suspect, not the agent handle, so a
 * timed-out resume is retried resume-first and conversation context is
 * preserved. (This deliberately diverges from the stream-phase recovery in
 * index.ts, which jumps to a fresh create because there the handle itself
 * has already failed a run.)
 *
 * Orphan semantics: withTimeout bounds the wait, not the work, so the first
 * attempt's promise survives its expiry. resetTransport() closes the HTTP/2
 * session that attempt is riding on, so the orphan rejects promptly and
 * withTimeout's attached catch absorbs the late rejection (settled promise —
 * no unhandledRejection). In the residual case where the orphan completes
 * before the reset, it leaves an agent that never receives a prompt: no LLM
 * cost, no state impact, cleaned up with the sandbox.
 */
export async function resolveAgentWithTransportRecovery(
  opts: ResolveWithTransportRecoveryOptions,
): Promise<AgentResolution> {
  const attempt = (finalAttempt: boolean) =>
    withTimeout(
      opts.timeoutMs,
      () => opts.buildTimeoutMessage(finalAttempt),
      () => resolveAgent(opts.harnessStateId, opts.createOptions, opts.mode),
    );

  try {
    return await attempt(false);
  } catch (err) {
    if (!(err instanceof TimeoutError)) throw err;

    console.warn(
      `resolveAgentWithTransportRecovery: agent resolution timed out after ` +
      `${opts.timeoutMs}ms (sessionId=${opts.createOptions.sessionId}, mode=${opts.mode}, ` +
      `resume=${!!opts.harnessStateId}) — resetting transport and retrying once`,
    );
    opts.resetTransport();

    return attempt(true);
  }
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
