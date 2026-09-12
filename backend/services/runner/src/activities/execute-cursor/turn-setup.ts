/**
 * The Cursor harness's setup — what this engine needs before it can be sent
 * a turn, as small named steps over the runtime's resolved `TurnInput`, each
 * returning a typed slice (the `SetupResult` mold, never one long function).
 *
 * Everything harness-agnostic has already happened when these run: the
 * execution, session and blueprint are fetched, the workspace is provisioned
 * and locked, the MCP servers and policies are merged, the skills are mounted,
 * the attachments are resolved. What remains is Cursor's own reading of that
 * record: the cursor mode; the row facts beside the runtime's approval
 * verdicts; the SDK's MCP config; the prompt-shaped view of the attachments;
 * the HITL gate (hook script, approval state, grants, denial watcher,
 * capture baseline, progress substrate); the catalog validation of the
 * requested model; the credential, the sub-agents, the variant params and
 * the agent itself (parked or resolved); the bind of a new agent's id through
 * the sink; the prompt in one of its four shapes; the vision payload; the
 * pricer; the OTel span.
 *
 * Every step reads `TurnInput` and the sink and nothing else of the runtime's.
 * The `execution_setup` cold-start line is emitted here, once the agent is
 * resolved, over the runtime's timeline (`sink.setupTiming`), so the one
 * timeline reads end to end.
 *
 * Moved from `index.ts` `executeCursorInner` phases 4c to 10c at S2 M3b; the
 * step bodies are the orchestrator's, verbatim where nothing changed.
 */

import type { SDKUserMessage } from "@cursor/sdk";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/approval_pb";
import type { SubAgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/subagent_pb";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import { CursorMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import type { Config } from "../../config.js";
import type { TurnInput, TurnSink } from "../../harness/types.js";
import { toCursorImages } from "../../shared/attachment-vision.js";
import { emitTimingLog } from "../../shared/cold-start-timing.js";
import { deriveExecutionFingerprintKey } from "../../shared/approval-fingerprint.js";
import { isUnattendedApprovalMode } from "../../shared/approval-policy.js";
import { excludeAppliedFromGrants } from "../../shared/exact-apply.js";
import { getRunnerHitlMasterSecret } from "../../shared/fingerprint-secret.js";
import { newProgressCaptureState, type ProgressCaptureState, type ProgressSubstrate } from "../../shared/filereview/progress.js";
import { enabledToolsBySlug } from "../../shared/mcp-enabled-tools.js";
import { ensureHitlDir } from "../../shared/workspace/platform-dir.js";
import { computeAgentFingerprint, takeCachedAgent } from "./agent-session-cache.js";
import { buildApprovalGrants, buildApprovalState, emitCursorGrantReceipts, reconstructAdjudicatedApprovals, watchDenialLedger, type ApprovalGrant } from "./approval-state.js";
import { buildCursorProgressSubstrate, captureBaselineToLedger } from "./capture-flow.js";
import { CURSOR_CAPABILITIES } from "./cursor-capabilities.js";
import { toCursorMcpConfig, validateMcpServerEnv } from "./cursor-mcp-config.js";
import { determineCursorMode, isCloudMode } from "./cursor-mode.js";
import { closeProxySessions } from "./http2-interceptor.js";
import { seededSubAgentsOf } from "./message-translator.js";
import { ensureLoaded as ensurePricingLoaded, resolveModelId } from "./model-pricing.js";
import {
  appendStructuredOutputDirective,
  buildPrompt,
  primarySendCarriesImages,
  promptCarriesStandingContext,
  type AttachmentPromptEntry,
  type BuildPromptInput,
  type VisionPromptInfo,
} from "./prompt-builder.js";
import { resolveServiceTierParams } from "./service-tier.js";
import {
  createAgent,
  createCloudAgent,
  resolveAgentWithTransportRecovery,
  type AgentResolution,
  type CreateAgentOptions,
  type CreateCloudAgentOptions,
} from "./session-lifecycle.js";
import { composeTurnRecoveryDigest } from "./turn-recovery.js";
import type { TurnStreamState } from "./turn-stream.js";
import { buildCursorSubAgentDefinitions } from "./subagent-config.js";
import { CursorUsagePricer } from "./usage-pricing.js";
import { installHitlGate, removeHitlGate, type HitlGateHandle } from "./workspace-setup.js";

/**
 * The runner config this harness reads per turn, as a named slice
 * (`shared/workspace/session-provision.ts` `SessionProvisionConfig` is the
 * idiom): a whole `Config` satisfies it, a test constructs these fields and
 * nothing else.
 */
export type CursorAdapterConfig = Pick<
  Config,
  "proxyEndpoint" | "cursorApiKey" | "stigmerToken" | "stigmerTokenRef" | "workspaceRootDir" | "cloudModeEnabled" | "agentResolveTimeoutMs"
>;

export type CursorAgentMode = "cloud" | "local";

/** The row facts the runtime's approval verdicts sit beside (the contract's rule: the adapter reads the ROW for anything else it needs). */
export interface AdjudicatedRows {
  /** Create-vs-resume, derived from the state id exactly as the runtime derives it. */
  readonly isReinvocation: boolean;
  /** The sub-agent rows the accumulator re-registers on a resume. */
  readonly seededSubAgents: readonly SubAgentExecution[];
  /** The pending-approval protos the grant builder and the reinvocation prompt render. */
  readonly adjudicatedApprovals: PendingApproval[];
  /** The content digest that authorizes an approved edit by its exact bytes (a sibling edit to the same file re-gates). */
  readonly adjudicatedContentDigests: Map<string, string>;
}

/** The HITL gate as installed for this turn, and what the stream and the boundary read from it. */
export interface CursorGate {
  /** Session HITL directory (runner-owned, outside the workspace): hook script, approval-state file, denial ledger. */
  readonly hitlDir: string;
  readonly hitlGate: HitlGateHandle;
  readonly approvalGrants: ApprovalGrant[] | undefined;
  /** The pre-turn tree in capture mode, pinned before the agent runs; the boundary diffs against it. */
  readonly baselineTree: string | undefined;
  readonly progressSubstrate: ProgressSubstrate | undefined;
  readonly progressState: ProgressCaptureState;
  /** Closes the denial-ledger watcher; idempotent. */
  readonly stopDenialWatcher: () => void;
  /** Restores the workspace's `.cursor/hooks.json` (issue #173); the runtime removes the `.stigmer` link after it. */
  readonly removeGate: () => Promise<void>;
}

/** The engine this turn runs on: how it was resolved and everything a recovery needs to resolve it again. */
export interface CursorEngine {
  readonly agentMode: CursorAgentMode;
  readonly cursorMode: CursorMode;
  readonly requestedModel: string;
  readonly validatedModel: string;
  readonly effectiveApiKey: string;
  readonly createOptions: CreateAgentOptions | CreateCloudAgentOptions;
  readonly agentFingerprint: string;
  /** Replaced by a recovery spine when a fresh agent takes over the turn. */
  resolution: AgentResolution;
  readonly modelParams: Awaited<ReturnType<typeof resolveServiceTierParams>>;
  readonly usagePricer: CursorUsagePricer;
}

/** The prompt this turn sends, and the facts every send site (primary and both recoveries) needs. */
export interface CursorPrompt {
  readonly effectivePrompt: string;
  /** The turn's full vision payload; a recovery send always carries it (issue #366's vision corollary). */
  readonly turnImages: ReturnType<typeof toCursorImages>;
  /** What the PRIMARY send carries: nothing on a HITL re-invocation of a resumed agent, whose conversation holds the images already. */
  readonly primarySendImages: ReturnType<typeof toCursorImages>;
  readonly toSendMessage: (prompt: string, images: { data: string; mimeType: string }[]) => string | SDKUserMessage;
  readonly promptEstimatedTokens: number;
  /** The fresh-agent recovery prompt, composed at recovery time from the transcript as it then stands. */
  readonly buildRecoveryPrompt: (fresh: AgentResolution) => Promise<string>;
}

// ── Steps ───────────────────────────────────────────────────────────────────

/**
 * Cloud Cursor agents are disabled platform-wide (see determineCursorMode),
 * so every session runs LOCAL. Any persisted cursor_mode is deliberately
 * ignored so a session can never route to the cloud path while it is
 * disabled — even one that was created when cloud was enabled.
 */
export function resolveCursorMode(input: TurnInput, config: CursorAdapterConfig): { cursorMode: CursorMode; agentMode: CursorAgentMode } {
  const cursorMode = determineCursorMode(input.blueprint.sessionSpec.workspaceEntries, config.cloudModeEnabled);
  return { cursorMode, agentMode: isCloudMode(cursorMode) ? "cloud" : "local" };
}

/**
 * The adapter's own read of the adjudicated rows the runtime already turned
 * into verdicts. Create-vs-resume is the adapter's fact about its ENGINE: a
 * bound agent id (`threadId`, engine-minted) means the Cursor agent already
 * holds this session's conversation, so this turn resumes it — the runtime's
 * `isReinvocation` answers its own question and is not consulted here.
 */
export function readAdjudicatedRows(input: TurnInput): AdjudicatedRows {
  const reinvoked = input.threadId !== "";
  const adjudicated = reinvoked ? reconstructAdjudicatedApprovals(input.execution.status?.messages ?? []) : undefined;
  return {
    isReinvocation: reinvoked,
    seededSubAgents: seededSubAgentsOf(input.execution),
    adjudicatedApprovals: adjudicated?.pendingApprovals ?? [],
    adjudicatedContentDigests: adjudicated?.contentDigests ?? new Map(),
  };
}

/**
 * The Cursor SDK config, projected from the runtime's final server list
 * exactly once, plus the MCP env pre-flight (diagnostic, non-blocking).
 */
export function projectMcpConfig(input: TurnInput): ReturnType<typeof toCursorMcpConfig> {
  const mcpWarnings = validateMcpServerEnv(input.mcp.servers, input.blueprint.mergedMcpServerUsages);
  if (mcpWarnings.length > 0) {
    console.warn(
      `ExecuteCursor MCP pre-flight warnings: execution=${input.executionId}\n` +
        mcpWarnings.map((w) => `  - ${w}`).join("\n"),
    );
  }
  return toCursorMcpConfig(input.mcp.servers);
}

/** The prompt-shaped projections of the runtime's attachments: the `<input_files>` entries and the vision disclosure. */
export function prepareAttachmentPrompt(input: TurnInput): { attachmentEntries: AttachmentPromptEntry[]; visionPromptInfo: VisionPromptInfo | undefined } {
  const { visionImages, visionNotViewable } = input.attachments;
  const attachmentEntries = input.attachments.results.map((a) => ({
    path: a.relativePath,
    ...(a.renamedFrom !== undefined ? { renamedFrom: a.renamedFrom } : {}),
    ...(a.downloadUrl !== undefined ? { downloadUrl: a.downloadUrl } : {}),
  }));
  const visionPromptInfo =
    visionImages.length > 0 || visionNotViewable.length > 0
      ? { inlineFilenames: visionImages.map((v) => v.filename), notViewable: visionNotViewable }
      : undefined;
  return { attachmentEntries, visionPromptInfo };
}

/**
 * Install the HITL approval gate BEFORE resolving the agent.
 *
 * The gate's runtime artifacts (hook script, approval-state file, denial
 * ledger) live in the session HITL directory OUTSIDE the workspace; only a
 * minimal, merged, transient .cursor/hooks.json is written into the repo,
 * pointing at the hook script by absolute path. The hook is scoped to this
 * runner's own process so the user's interactive IDE — sharing the same repo
 * hooks.json — is never gated (issue #173). Installing here (rather than
 * after agent create/resume) guarantees the hook is present no matter when
 * the SDK reads hook config, and the adapter's finally restores the repo.
 *
 * On reinvocation, turn the user's approvals into tool-identity grants so
 * the resumed agent's re-attempt (which carries a fresh tool-call id) is
 * allowed through. Exact-applied writes are EXCLUDED from the grants: with no
 * grant, a further write to that file is re-gated (the user sees every change).
 * Capture mode: pin the pre-turn baseline tree before the agent runs (and
 * before the gate is installed, though the gate files are excluded from the
 * capture anyway). The turn-end capture diffs the post-turn tree against this
 * to build the per-file cards; the baseline ref is also what a reject reverts
 * to on resume. Covers a fresh turn and the approved-irreversible resume
 * fall-through (the agent will run and may make further edits).
 */
export async function installGate(input: TurnInput, sink: TurnSink, rows: AdjudicatedRows, streamState: TurnStreamState): Promise<CursorGate> {
  const { executionId, sessionId, workspace, mcp, approvalDecisions, appliedToolCallIds, artifactStorage } = input;
  const { primaryDir, gitWorkspace, captureMode, changeSetId } = workspace;
  const globalBypass = mcp.leases.global;

  let baselineTree: string | undefined;
  if (captureMode && primaryDir) {
    // Pin the pre-turn tree AND author BASELINE_CAPTURED so the projection can
    // materialize the change set (status CAPTURING) before any candidate exists.
    // The event rides the next persist; CAPTURING does not arm the unified gate.
    baselineTree = await captureBaselineToLedger({ status: sink.status, gitRoot: primaryDir, executionId, changeSetId, gitWorkspace });
  }

  const hitlDir = await ensureHitlDir(sessionId);
  const grantApprovals = excludeAppliedFromGrants(rows.adjudicatedApprovals, appliedToolCallIds);
  const approvalGrants = approvalDecisions.size > 0
    ? buildApprovalGrants(grantApprovals, approvalDecisions, rows.adjudicatedContentDigests)
    : undefined;
  if (approvalGrants && approvalGrants.length > 0 && !globalBypass) {
    emitCursorGrantReceipts(approvalGrants, deriveExecutionFingerprintKey(getRunnerHitlMasterSecret(), executionId), executionId);
  }
  // CAS capture requires artifact storage to persist blobs
  // (captureCandidateToLedger throws without it). In a git tree, captureMode
  // alone governs tracked-file capture (no storage needed) and captureIgnored is
  // the narrower switch (git tree + storage) that also captures gitignored
  // writes. In a non-git workspace ALL capture is CAS, so captureMode already
  // required storage — captureIgnored then equals captureMode. When storage is
  // absent a git tree keeps gating gitignored writes and a non-git workspace
  // falls back to the deny-gate entirely (no regression).
  const captureIgnored = captureMode && !!artifactStorage;
  // Unattended approval mode (DD-014): approver-less surfaces (channels,
  // guest shares) stamp APPROVAL_MODE_UNATTENDED; the hook then records
  // approval denials with the non-pausing "unattended" kind, so the
  // first-denial stop never fires and the turn boundary settles the denied
  // calls as SKIPPED instead of pausing a turn nobody can approve.
  const approvalState = buildApprovalState(
    mcp.policies,
    globalBypass,
    mcp.leases.categories,
    approvalGrants,
    captureMode,
    captureIgnored,
    gitWorkspace,
    isUnattendedApprovalMode(input.execution),
    // The enabled_tools capability manifest (issue #350): restricted
    // servers' allow-lists, enforced by the hook's "disabled" arm ahead of
    // every approval bypass. The Cursor SDK config cannot hide a server's
    // tools, so this deny-at-call is the harness's enforcement.
    enabledToolsBySlug(mcp.servers),
  );
  const hitlGate = await installHitlGate({ workspaceRoot: primaryDir, hitlDir, approvalState, runnerPid: process.pid });
  // Issue #205 diagnosability: the merge preserved the user's own hooks on
  // the gating events, and Cursor runs every configured hook — so any of
  // these can deny this turn's tools without writing our denial ledger. Log
  // the exposure up front; the turn boundary uses the same list to name the
  // likely culprit if it detects an unattributed hook block.
  if (hitlGate.foreignGatingHooks.length > 0) {
    console.warn(
      `ExecuteCursor: workspace hooks.json carries ${hitlGate.foreignGatingHooks.length} ` +
        `foreign gating hook(s) [${hitlGate.foreignGatingHooks.join(", ")}] — a deny from ` +
        `any of them blocks the runner's tools outside Stigmer's approval flow ` +
        `(execution=${executionId})`,
    );
  }
  // Arm the denial watcher as soon as the gate exists. The per-turn ledger
  // reset may flip the flag once before the run starts; the loop's read then
  // sees an empty ledger and clears it — harmless by construction.
  const stopDenialWatcher = watchDenialLedger(hitlDir, () => {
    streamState.denialLedgerDirty = true;
  });
  sink.setupTiming.mark("install_hitl_gate");

  // Mid-run live capture (DD-32 / DD-33): choose the progress substrate for this
  // turn's workspace shape ONCE (git / non-git CAS / hybrid). It owns its own
  // short-circuit cache across the loop's persists; the floor lives in
  // progressState. Undefined outside capture mode — writes are deny-gated and
  // nothing is captured.
  const progressSubstrate = buildCursorProgressSubstrate({
    captureMode,
    gitWorkspace,
    workspaceRoot: primaryDir,
    baselineTree,
    executionId,
    hitlDir,
    storage: artifactStorage,
  });

  return {
    hitlDir,
    hitlGate,
    approvalGrants,
    baselineTree,
    progressSubstrate,
    progressState: newProgressCaptureState(),
    stopDenialWatcher,
    removeGate: () => removeHitlGate(hitlGate),
  };
}

/**
 * Resolve the Cursor agent (parked, created, resumed, or created after a
 * resume failure), emit the cold-start line, and bind a NEW agent's id
 * through the sink before anything else runs (Q-S2-11: a rejected bind ends
 * the turn `failed`; the sink rejects and the caller's catch names it).
 *
 * The requested name and the effective tier and thinking mode are the
 * runtime's; validating the NAME against Cursor's catalog is this harness's.
 */
export async function resolveEngine(input: TurnInput, sink: TurnSink, config: CursorAdapterConfig, mode: { cursorMode: CursorMode; agentMode: CursorAgentMode }): Promise<CursorEngine> {
  const { executionId, sessionId, threadId, blueprint, workspace, session } = input;
  const { cursorMode, agentMode } = mode;
  const mcpConfig = projectMcpConfig(input);

  // Phase 5d: Ensure model pricing registry is populated before validation
  await ensurePricingLoaded();
  sink.setupTiming.mark("load_pricing");

  const requestedModel = input.model.requested;
  const validatedModel = resolveModelId(requestedModel);
  if (validatedModel !== requestedModel) {
    console.log(`ExecuteCursor model resolved: execution=${executionId}, requested="${requestedModel}", using="${validatedModel}"`);
  }

  await sink.reportProgress("Initializing Cursor agent");

  // In proxy mode, use the stigmer token as the API key — the proxy
  // validates it and injects the real Cursor API key server-side.
  // In direct mode, use the user's own CURSOR_API_KEY.
  const effectiveApiKey = config.proxyEndpoint
    ? (config.stigmerTokenRef?.current ?? config.stigmerToken ?? config.cursorApiKey)
    : config.cursorApiKey;
  if (!effectiveApiKey || effectiveApiKey === "proxy-managed") {
    const source = config.proxyEndpoint ? "proxy (STIGMER_TOKEN)" : "direct (CURSOR_API_KEY)";
    throw new Error(
      `No Cursor API credential available. Mode=${source}, ` +
        `proxyEndpoint=${config.proxyEndpoint ?? "unset"}, ` +
        `hasStigmerToken=${!!config.stigmerToken}, ` +
        `hasTokenRef=${!!config.stigmerTokenRef?.current}`,
    );
  }

  // Register blueprint sub-agents with the Cursor SDK so the parent can
  // delegate to them by name via the Task tool. Re-supplied on every
  // create/resume (the SDK does not persist agent config across resume).
  const cursorSubAgents = buildCursorSubAgentDefinitions(blueprint.subAgents);
  if (cursorSubAgents) {
    console.log(
      `ExecuteCursor registering ${Object.keys(cursorSubAgents).length} custom sub-agent(s): ` +
        `execution=${executionId}, names=${Object.keys(cursorSubAgents).join(", ")}`,
    );
  }

  // Translate the tier + thinking mode into the explicit variant params
  // sent with every create/resume. Never a bare { id }: the catalog's
  // default variant is account-influenced and picks the served variant
  // (#357 fast pricing, #772 thinking).
  const modelParams = await resolveServiceTierParams({
    apiKey: effectiveApiKey,
    modelId: validatedModel,
    tier: input.model.serviceTier,
    thinking: input.model.thinkingMode,
    executionId,
  });

  const createOptions: CreateAgentOptions | CreateCloudAgentOptions = agentMode === "cloud"
    ? {
        apiKey: effectiveApiKey,
        model: validatedModel || undefined,
        modelParams,
        repos: blueprint.cloudRepos,
        sessionId,
        mcpServers: mcpConfig,
        agents: cursorSubAgents,
      }
    : {
        apiKey: effectiveApiKey,
        model: validatedModel,
        modelParams,
        workspaceDirs: [...workspace.dirs],
        sessionId,
        workspaceRootDir: config.workspaceRootDir,
        mcpServers: mcpConfig,
        agents: cursorSubAgents,
      };

  // Agent.create/Agent.resume have no timeout of their own — a degraded
  // transport (dead proxy connection, stale HTTP/2 session) hangs them
  // forever, which the periodic heartbeat would happily keep alive. Each
  // attempt is bounded; on expiry the wrapper resets the proxy transport
  // and retries once, so a stale-session hang recovers without failing the
  // execution. A second expiry propagates a plain Error to the adapter's
  // catch, which settles the turn `failed`.
  const resolveTimeoutSeconds = Math.round(config.agentResolveTimeoutMs / 1000);
  // Close the segment since load_pricing here so the resolve_agent segment
  // below measures the SDK Agent.create/resume call alone, not the
  // progress-report gRPC + options assembly above (issue #209: resolve_agent
  // is the largest user-visible setup segment; this split keeps its
  // historical meaning — the SDK call was already 98%+ of it).
  sink.setupTiming.mark("prepare_agent");

  // Reuse the previous turn's agent when this session parked one (#215). A
  // checkout hit skips Agent.resume() AND — the real win — keeps the SDK
  // executor lease alive, so agent.send() re-acquires the warm executor
  // instead of re-spawning every stdio MCP server (the measured 2.2–3.2s
  // `send_returned` tax). The fingerprint covers the full acquisition
  // config, so any drift (rotated credential, edited MCP servers, model
  // change) falls through to a fresh resolve.
  const agentFingerprint = computeAgentFingerprint(createOptions as unknown as Record<string, unknown>);
  const parkedAgent = takeCachedAgent(sessionId, agentFingerprint, threadId ?? "");
  let resolution: AgentResolution;
  if (parkedAgent) {
    console.log(`ExecuteCursor reusing parked session agent: execution=${executionId}, session=${sessionId}, agentId=${parkedAgent.agentId}`);
    resolution = {
      agent: parkedAgent as AgentResolution["agent"],
      agentId: parkedAgent.agentId,
      isNew: false,
      resumed: true,
      mode: agentMode,
      // The parked handle IS the live conversation — every consumer of
      // "resumed_successfully" (prompt selection, poisoned-handle
      // recovery eligibility) wants exactly those semantics.
      reason: "resumed_successfully",
    };
  } else {
    resolution = await resolveAgentWithTransportRecovery({
      harnessStateId: threadId,
      createOptions,
      mode: agentMode,
      timeoutMs: config.agentResolveTimeoutMs,
      buildTimeoutMessage: (finalAttempt) =>
        `Cursor agent ${threadId ? "resume" : "create"} timed out after ${resolveTimeoutSeconds}s ` +
        `(${config.proxyEndpoint ? `via proxy ${config.proxyEndpoint}` : "direct Cursor API connection"}). ` +
        `The transport connection is likely dead. ` +
        (finalAttempt
          ? `An automatic retry on a fresh transport connection also timed out. ` +
            `Retry the message later; if this persists, check proxy and network health.`
          : `Resetting the transport and retrying automatically.`),
      resetTransport: closeProxySessions,
    });
  }

  console.log(
    `ExecuteCursor agent resolved: execution=${executionId}, ` +
      `reason=${resolution.reason}, mode=${resolution.mode}, ` +
      `agentId=${resolution.agentId}, resumed=${resolution.resumed}` +
      (resolution.resumeFailureDetail ? `, failureDetail=${resolution.resumeFailureDetail}` : ""),
  );
  sink.setupTiming.mark("resolve_agent");
  emitTimingLog("execution_setup", {
    execution_id: executionId,
    session_id: sessionId,
    harness: "cursor",
    agent_resumed: resolution.resumed,
    cursor_mode: agentMode,
    mcp_server_count: blueprint.mergedMcpServerUsages.length,
    skill_count: blueprint.mergedSkillRefs.length,
    workspace_entry_count: session.spec?.workspaceEntries?.length ?? 0,
  }, sink.setupTiming);

  // A NEW agent's id is bound at once, before anything else runs, so a crash
  // mid-turn still resumes on the next invocation. The mode is this
  // harness's field on the session record, set before the runtime writes it
  // (one writer per field, Q-S2-11); the runtime sets harness_state_id and
  // clears the slug.
  if (resolution.isNew && resolution.agentId) {
    if (blueprint.sessionSpec.cursorMode === CursorMode.UNSPECIFIED) {
      blueprint.sessionSpec.cursorMode = cursorMode;
    }
    try {
      await sink.bindHarnessState(resolution.agentId);
    } catch (bindErr) {
      // The handle this function just created has no owner yet (the adapter
      // receives the engine only when this returns) and its id was never
      // saved, so no later turn can resume it: close it here, or its executor
      // lease and MCP subprocesses outlive the failed turn with nothing to
      // release them (S2 M4, Q-M4-8). Then let the rejection settle the turn
      // `failed` as R3 rules.
      try {
        resolution.agent.close();
      } catch {
        /* best effort */
      }
      throw bindErr;
    }
    console.log(`Stored Cursor agentId=${resolution.agentId} as harness_state_id, cursorMode=${CursorMode[cursorMode]} on session ${sessionId}`);
  }

  return {
    agentMode,
    cursorMode,
    requestedModel,
    validatedModel,
    effectiveApiKey,
    createOptions,
    agentFingerprint,
    resolution,
    modelParams,
    usagePricer: new CursorUsagePricer(validatedModel, input.model.serviceTier, modelParams),
  };
}

/** Create a fresh agent for a recovery spine (the same options as the primary resolve). */
export async function createFreshAgent(engine: CursorEngine): Promise<AgentResolution["agent"]> {
  return engine.agentMode === "cloud"
    ? createCloudAgent(engine.createOptions as CreateCloudAgentOptions)
    : createAgent(engine.createOptions as CreateAgentOptions);
}

/**
 * Build the prompt in the shape the resolution calls for (`prompt-builder.ts`
 * `buildPrompt`), with the per-turn directives that ride every send this
 * turn makes (the structured-output contract, the implement-plan directive)
 * and the vision payload policy.
 */
export async function buildTurnPrompt(input: TurnInput, sink: TurnSink, engine: CursorEngine, rows: AdjudicatedRows): Promise<CursorPrompt> {
  const { executionId, blueprint, standing, attachments, workspace, approvalDecisions, appliedToolCallIds, structuredOutputSchema } = input;
  const spec = input.execution.spec!;
  const { attachmentEntries, visionPromptInfo } = prepareAttachmentPrompt(input);
  const interactionMode = spec.executionConfig?.interactionMode ?? InteractionMode.UNSPECIFIED;
  const buildFromPlan = spec.executionConfig?.buildFromPlan ?? false;

  const shared = (): Omit<BuildPromptInput, "resolution" | "recalledMemories" | "turnRecoveryDigest"> => ({
    approvalDecisions,
    instructions: blueprint.instructions,
    userMessage: spec.message,
    skills: input.skills,
    channelMessaging: input.mcp.channelMessaging,
    subAgents: blueprint.subAgents,
    workspaceDirs: [...workspace.dirs],
    workspaceFileRefs: spec.workspaceFileRefs ?? [],
    attachments: attachmentEntries,
    vision: visionPromptInfo,
    downloadUrlKind: input.artifactStorage?.downloadUrlKind,
    pendingApprovals: rows.adjudicatedApprovals,
    appliedToolCallIds,
    interactionMode,
    buildFromPlan,
    contextBridge: standing.contextBridge,
    senderIdentity: standing.senderIdentity,
    sessionContext: standing.sessionContext,
    declaredPreferences: standing.declaredPreferences,
    conversationCatchup: standing.conversationCatchup,
  });

  // The memory selection is the runtime's memoized thunk; whether THIS prompt
  // carries it is decided by how the agent resolved — a successfully resumed
  // agent already holds its standing context. Deliberately NOT decided once
  // here: a mid-send poisoned-handle failure rebuilds on a FRESH agent whose
  // recovery prompt does carry it, so that build site awaits the same thunk.
  const recalledMemories = promptCarriesStandingContext(engine.resolution.reason)
    ? await standing.selectRecalledMemories()
    : undefined;

  const prompt = buildPrompt({
    ...shared(),
    resolution: engine.resolution,
    recalledMemories,
    // The turn's recorded transcript, seeded from the persisted execution on
    // a reinvocation. Consumed only by the HITL-recovery shape — reached from
    // HERE when the stored handle failed to resume at resolution time (issue
    // #366 crossing 2).
    turnRecoveryDigest: rows.isReinvocation ? composeTurnRecoveryDigest(sink.status.messages) : undefined,
  });

  // The structured output instruction is a per-turn directive, so like
  // buildFromPlan it must ride every prompt this turn sends — the primary AND
  // the poisoned-handle recovery rebuild (the transport retry re-sends
  // effectivePrompt and inherits it).
  const effectivePrompt = appendStructuredOutputDirective(prompt, structuredOutputSchema);

  // The turn's vision payload. The invariant is "images accompany the user's
  // turn message, wherever the conversation does not already hold them"
  // (primarySendCarriesImages): the ONLY send that skips them is a HITL
  // re-invocation of a successfully RESUMED agent, whose native conversation
  // carries the images from the original send. Every send that starts an
  // empty conversation re-delivers them — the ordinary first/fresh-agent
  // primary send, the HITL primary send after a resolution-time resume
  // failure, and both mid-send recovery retries (which always run on a fresh
  // agent, so their sites pass turnImages unconditionally). Attachments
  // re-resolve on every invocation, so the bytes are in hand even on a
  // re-invocation.
  const turnImages = toCursorImages(attachments.visionImages);
  const primarySendImages = primarySendCarriesImages(approvalDecisions, engine.resolution.reason) ? turnImages : [];
  const toSendMessage = (sendPrompt: string, images: { data: string; mimeType: string }[]): string | SDKUserMessage =>
    images.length > 0 ? { text: sendPrompt, images } : sendPrompt;

  const promptChars = effectivePrompt.length;
  const promptEstimatedTokens = Math.ceil(promptChars / 4);
  console.log(
    `ExecuteCursor prompt built: execution=${executionId}, ` +
      `chars=${promptChars}, estimatedTokens=${promptEstimatedTokens}, ` +
      `resolution=${engine.resolution.reason}, mode=${engine.resolution.mode}`,
  );

  return {
    effectivePrompt,
    turnImages,
    primarySendImages,
    toSendMessage,
    promptEstimatedTokens,
    // Same per-turn directive rule as buildFromPlan: a structured-output turn
    // keeps its output contract on the rebuilt prompt (the transport retry
    // re-sends effectivePrompt and inherits it without help).
    buildRecoveryPrompt: async (fresh) =>
      appendStructuredOutputDirective(
        buildPrompt({
          ...shared(),
          resolution: fresh,
          // Lazily selected: the primary send may have been a resumed-agent
          // shape that carried no memories, but this fresh agent's prompt must.
          recalledMemories: await standing.selectRecalledMemories(),
          // Composed fresh: the failed primary stream may have appended partial
          // work onto the transcript, and the replacement agent should know it.
          turnRecoveryDigest: composeTurnRecoveryDigest(sink.status.messages),
        }),
        structuredOutputSchema,
      ),
  };
}

