/**
 * Maps Stigmer Session lifecycle to Cursor Agent lifecycle.
 *
 * SessionSpec.harness_state_id stores the Cursor agentId. This module handles
 * creating new agents (first execution), resuming existing agents
 * (subsequent executions) and graceful fallback on resume failure.
 *
 * Two execution modes:
 *
 * - Local mode: Agent.create({ local: { cwd, dirs, store, ... } }) over the
 *   session's own SQLite store (`session-store.ts`). Produces agent- prefixed
 *   IDs.
 *
 * - Cloud mode (feature-flagged): Agent.create({ cloud: { repos } })
 *   for git-backed workspaces. Produces bc- prefixed IDs. No store — cloud
 *   state lives on Cursor's servers, not local SQLite.
 *
 * Nothing under `local` survives Agent.resume(): `cwd`, `dirs`,
 * `settingSources`, `store` and `enableAgentRetries` are re-supplied on every
 * resume, exactly like `mcpServers`, `agents` and the model params. Omitting
 * `cwd` re-roots the resumed agent at process.cwd() and loads the "project"
 * setting source (the .cursor/hooks.json carrying the HITL approval hook) from
 * the wrong directory, silently disabling the gate on every resumed turn;
 * omitting `store` would make the SDK look the agent up in a default store
 * derived from `cwd`, not the one the session's records are in.
 *
 * Durability model: the session's SQLite store (agent records, runs,
 * checkpoints) is the source of truth for conversation continuation. It lives
 * under the durable workspace volume (`session-store.ts`) so Agent.resume()
 * survives pod restart, reschedule, and snapshot restore. When resume
 * nonetheless fails (store lost, corrupted, or agent unknown), this module
 * creates a fresh agent and the caller starts a new turn from the user message
 * plus re-injected instructions — there is no separate continuation store.
 *
 * Retries are the runner's, not the SDK's. `@cursor/sdk` 1.0.31 defaults
 * `enableAgentRetries` to true for headless embedders (1.0.13 defaulted it to
 * false); the runner already owns recovery from a dead or stalled transport —
 * `withTimeout` around agent resolution, `resolveAgentWithTransportRecovery`
 * (reset the transport, retry once), the two recovery spines in
 * `turn-settle.ts`, and the stall detector — so the SDK's layer is pinned OFF
 * to keep one retry authority and the 1.0.13 timing of every provider fault.
 * Whether to adopt the SDK's retries and delete ours is an open design
 * question for the harness program, recorded there; it is not decided here.
 */

import { Agent } from "@cursor/sdk";
import type {
  SDKAgent,
  AgentDefinition,
  LocalAgentOptions,
  ModelParameterValue,
} from "@cursor/sdk";
import type { SqliteLocalAgentStore } from "@cursor/sdk/sqlite";
import { withTimeout, TimeoutError } from "../../shared/with-timeout.js";
import type { CloudRepo } from "../../shared/blueprint-resolver.js";
import type { CursorMcpServerConfig } from "./cursor-mcp-config.js";
import { sessionStore } from "./session-store.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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
 * The `local` options a session's agent is created AND resumed with — one
 * builder so the two calls cannot drift (see the module header for why every
 * field is re-supplied on resume).
 *
 * Workspaces: the SDK takes ONE primary `cwd` (the default shell's directory
 * and the agent's store scoping) plus `dirs` for the other roots of a
 * multi-root workspace, merged cwd-first with duplicates dropped, so rules,
 * skills and hooks load from every root. The session's first workspace
 * directory is the primary, as it was when the SDK took the whole array.
 */
async function localAgentOptions(
  sessionId: string,
  workspaceRootDir: string,
  workspaceDirs: readonly string[],
): Promise<LocalAgentOptions & { readonly store: SqliteLocalAgentStore }> {
  const [cwd, ...dirs] = workspaceDirs;
  const store = await sessionStore(sessionId, workspaceRootDir);
  return {
    cwd,
    ...(dirs.length > 0 ? { dirs } : {}),
    settingSources: [...LOCAL_SETTING_SOURCES],
    store,
    // The runner is the one retry authority (module header).
    enableAgentRetries: false,
  };
}

/**
 * Create a new local Cursor Agent for the first execution in a session.
 */
export async function createAgent(options: CreateAgentOptions): Promise<SDKAgent> {
  const local = await localAgentOptions(options.sessionId, options.workspaceRootDir, options.workspaceDirs);
  console.log(
    `createAgent: sessionId=${options.sessionId}, workspaceRef=${local.store.workspaceRef}, ` +
    `stateRoot=${local.store.stateRoot}, process.cwd=${process.cwd()}`,
  );

  return Agent.create({
    apiKey: options.apiKey,
    // Always a full selection — id AND params. A bare { id } would let the
    // catalog's default variant (account-influenced) pick the price (#357).
    model: { id: options.model, params: options.modelParams },
    local,
    mcpServers: options.mcpServers as Record<string, any>,
    agents: options.agents,
  });
}

/**
 * Resume an existing local Cursor Agent for subsequent executions.
 *
 * Throws on failure — the caller (resolveAgent) decides whether to
 * propagate or fall back to a fresh agent with continuation context.
 */
export async function resumeAgent(options: ResumeAgentOptions): Promise<SDKAgent> {
  const local = await localAgentOptions(options.sessionId, options.workspaceRootDir, options.workspaceDirs);
  console.log(
    `resumeAgent: agentId=${options.agentId}, sessionId=${options.sessionId}, ` +
    `workspaceRef=${local.store.workspaceRef}, stateRoot=${local.store.stateRoot}, ` +
    `process.cwd=${process.cwd()}`,
  );

  return Agent.resume(options.agentId, {
    apiKey: options.apiKey,
    // Variant params must be re-supplied on resume exactly like mcpServers:
    // explicit params hold across resume (verified against the billing
    // ledger, #357), but an id-only resume would fall back to the catalog
    // default variant for the new turns.
    model: options.model ? { id: options.model, params: options.modelParams } : undefined,
    local,
    mcpServers: options.mcpServers as Record<string, any>,
    agents: options.agents,
  });
}

// ---------------------------------------------------------------------------
// Cloud agent functions
// ---------------------------------------------------------------------------

/**
 * Create a new cloud Cursor Agent for git-backed sessions.
 *
 * Cloud agents (bc- prefix) run on Cursor's servers with cloned repos.
 * No store — cloud state lives server-side, not in local SQLite.
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
 * No store — cloud state lives server-side.
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
 * - "local": createAgent / resumeAgent (over the session's store)
 * - "cloud": createCloudAgent / resumeCloudAgent (no store)
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
