/**
 * The Cursor harness's setup — what this engine needs before it can be sent
 * a turn, as small named steps over the runtime's resolved `TurnInput`, each
 * returning a typed slice (the `SetupResult` mold, never one long function).
 *
 * Everything harness-agnostic has already happened when these run: the
 * execution, session and blueprint are fetched, the workspace is provisioned
 * and locked, the MCP servers, the approval default and the agent's tool
 * scope are resolved, the skills are mounted, the attachments are resolved.
 * What remains is Cursor's own reading of that record: the cursor mode; the
 * tool-list checks this engine can and cannot honour; the row facts beside the
 * runtime's approval verdicts; the SDK's MCP config and tool restriction; the
 * prompt-shaped view of the attachments; the agent's hooks (the evaluator,
 * the workspace hook files a person's own folder may not carry, the tools
 * a hook would answer for that Cursor never shows one); the HITL gate (hook
 * script, approval state, grants, the hook server, denial watcher, and the
 * hook sidecar bound as the runtime's CAS observations); the catalog
 * validation of the
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
 * Moved from `index.ts` `executeCursorInner` phases 4c to 10c in #1070; the
 * step bodies are the orchestrator's, verbatim where nothing changed.
 */

import type { SDKUserMessage } from "@cursor/sdk";
import type { PendingApproval } from "@stigmer/protos/ai/stigmer/agentic/run/v1/approval_pb";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/run/v1/enum_pb";
import { CursorMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

import type { RunStatus } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Config } from "../../config.js";
import type { TurnInput, TurnSink } from "../../harness/types.js";
import { toCursorImages } from "../../shared/attachment-vision.js";
import { emitTimingLog } from "../../shared/cold-start-timing.js";
import { deriveExecutionFingerprintKey } from "../../shared/approval-fingerprint.js";
import { isUnattendedApprovalMode } from "../../shared/approval-policy.js";
import { excludeAppliedFromGrants } from "../../shared/exact-apply.js";
import { getRunnerHitlMasterSecret } from "../../shared/fingerprint-secret.js";
import { realpath } from "node:fs/promises";
import {
  CURSOR_SDK_TOOL_COVERS,
  checkToolListResolution,
  claudeToolsOf,
  cursorSdkToolOptions,
  type TurnToolInventory,
} from "../../shared/tool-lists.js";
import type { ResolvedMcpServer } from "../../shared/mcp-resolver.js";
import { ensureHitlDir, getPlatformDir } from "../../shared/workspace/platform-dir.js";
import type { HookEvaluator } from "../../shared/hooks/evaluate.js";
import { buildHookEvaluator, HookSetupError, hookPermissionMode } from "../../shared/hooks/setup.js";
import { stigmerSymlinkPointsAt } from "../../shared/workspace/stigmer-link.js";
import { compileHookToolScope } from "./hook-scope.js";
import { computeAgentFingerprint, takeCachedAgent } from "./agent-session-cache.js";
import {
  buildApprovalGrants,
  buildApprovalState,
  buildPersonRefusals,
  emitCursorGrantReceipts,
  reconstructAdjudicatedApprovals,
  watchDenialLedger,
  type ApprovalGrant,
} from "./approval-state.js";
import { startHookServer, type HookDecisionLog } from "./hook-server.js";
import { toolsHiddenByHooks, withToolsHidden } from "./hook-tool-hiding.js";
import { CursorEngineToolViews } from "./hook-views.js";
import { refuseLinkedGateFile, refuseOwnFolderHooks, workspaceFolders } from "./workspace-hook-files.js";
import { readSidecarSnapshot } from "./cas-observations.js";
import { CURSOR_CAPABILITIES } from "./cursor-capabilities.js";
import { toCursorMcpConfig, validateMcpServerEnv } from "./cursor-mcp-config.js";
import { determineCursorMode, isCloudMode } from "./cursor-mode.js";
import { closeProxySessions } from "./http2-interceptor.js";
import { ensureLoaded as ensurePricingLoaded, resolveModelId } from "./model-pricing.js";
import {
  appendStructuredOutputDirective,
  buildPrompt,
  primarySendCarriesImages,
  promptCarriesStandingContext,
  type BuildPromptInput,
} from "./prompt-builder.js";
import { visionPromptInfoOf } from "../../shared/prompt-sections.js";
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
import { buildCursorSubAgentDefinitions, subAgentsInScope } from "./subagent-config.js";
import { CursorUsagePricer } from "./usage-pricing.js";
import { installHitlGate, MAX_HOOK_TIMEOUT_SECONDS, removeHitlGate, type HitlGateHandle } from "./workspace-setup.js";

/**
 * The runner config this harness reads per turn, as a named slice
 * (`shared/workspace/session-provision.ts` `SessionProvisionConfig` is the
 * idiom): a whole `Config` satisfies it, a test constructs these fields and
 * nothing else.
 */
export type CursorAdapterConfig = Pick<
  Config,
  | "proxyEndpoint"
  | "cursorApiKey"
  | "stigmerTokenRef"
  | "workspaceRootDir"
  | "cloudModeEnabled"
  | "agentResolveTimeoutMs"
  | "cursorStreamStallTimeoutMs"
>;

export type CursorAgentMode = "cloud" | "local";

/** The row facts the runtime's approval verdicts sit beside (the contract's rule: the adapter reads the ROW for anything else it needs). */
export interface AdjudicatedRows {
  /** Create-vs-resume, derived from the state id exactly as the runtime derives it. */
  readonly isReinvocation: boolean;
  /** The pending-approval protos the grant builder and the reinvocation prompt render. */
  readonly adjudicatedApprovals: PendingApproval[];
  /** The content digest that authorizes an approved edit by its exact bytes (a sibling edit to the same file re-gates). */
  readonly adjudicatedContentDigests: Map<string, string>;
  /** The approvals a hook asked for, by tool-call id. */
  readonly adjudicatedHookAsks: ReadonlySet<string>;
}

/** The HITL gate as installed for this turn, and what the stream and the boundary read from it. */
export interface CursorGate {
  /** Session HITL directory (runner-owned, outside the workspace): hook script, approval-state file, denial ledger. */
  readonly hitlDir: string;
  readonly hitlGate: HitlGateHandle;
  readonly approvalGrants: ApprovalGrant[] | undefined;
  /** The hooks' decisions on the calls that may run, for the rows' provenance; absent for an agent without hooks. */
  readonly hookDecisions?: HookDecisionLog;
  /** Closes the denial-ledger watcher; idempotent. */
  readonly stopDenialWatcher: () => void;
  /** Restores the workspace's hook files (issue #173) and stops the hook server; the runtime removes the `.stigmer` link after it. */
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
 * A turn this engine refuses because of the agent's tool lists, before
 * anything runs: the fix is the agent author's, so the turn fails with this
 * sentence on the `actionable` surface (`turn.ts` `classifyThrown`), as a
 * `ToolListResolutionError` does on both engines.
 */
export class CursorToolListRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CursorToolListRefusal";
  }
}

/**
 * The agent's tool lists, checked against what this engine can enforce, before
 * anything is installed. Refuses the turn (throws {@link CursorToolListRefusal}
 * or `ToolListResolutionError`, each settling it `failed` with its own
 * sentence) when:
 *  - a sub-agent the main agent may start carries lists of its own: the hook
 *    cannot tell which sub-agent made a call (`preToolUse` carries no
 *    sub-agent id), and the SDK's `tools` options restrict only the main
 *    loop, so a sub-agent's lists would silently not bind. The native engine
 *    enforces them per sub-agent. A sub-agent `Agent(type, …)` excludes is
 *    never registered (`subAgentsInScope`) and can never run, so its lists
 *    cannot matter and it is not checked. No sub-agent's lists reach the
 *    zero-resolution check below either: one with lists never gets past
 *    this one;
 *  - the agent has lists and the session runs a cloud agent, which takes
 *    neither the SDK's `tools` options nor the workspace hook;
 *  - the main agent admits `Agent` but limits it to a type list
 *    (`Agent(type, …)`): Cursor's built-in sub-agent types start through a
 *    `task` call that fires neither `preToolUse` nor `subagentStart` on the
 *    1.0.31 local runtime (live probe, 2026-10-05,
 *    `cursor-hook-protocol.live.test.ts`), so nothing could hold one back.
 *    The native engine enforces the list; bare `Agent` and an excluded
 *    `Agent` need no type check and pass;
 *  - a non-empty `tools` names nothing this turn has (`checkToolListResolution`),
 *    as Claude refuses to launch such an agent.
 */
export function checkToolScope(input: TurnInput, mode: { agentMode: CursorAgentMode }): void {
  const scope = input.mcp.toolScope;
  const narrowed = subAgentsInScope(input.blueprint.subAgents, scope).filter(
    (sa) => sa.tools.length > 0 || sa.disallowedTools.length > 0,
  );
  if (narrowed.length > 0) {
    const names = narrowed.map((sa) => `"${sa.name}"`).join(", ");
    throw new CursorToolListRefusal(
      `Sub-agent ${names} ${narrowed.length === 1 ? "carries its" : "carry their"} own tool lists ` +
        "(tools / disallowed_tools), which the Cursor engine cannot enforce: it cannot tell a " +
        "sub-agent's tool call from the main agent's. Run this agent on the native engine, or " +
        "remove the sub-agent's lists.",
    );
  }
  if (!scope.restricted) return;
  if (mode.agentMode === "cloud") {
    throw new CursorToolListRefusal(
      `${scope.owner} has tool lists, which a cloud Cursor agent cannot enforce. Run the session locally or on the native engine.`,
    );
  }
  // Limited to a type list: Agent admitted, yet a type no entry names is not
  // (a bare `Agent` beside a typed one lifts the limit, as in Claude).
  if (scope.allowsClaudeTool("Agent") && !scope.subAgentTypeTable([]).otherTypes) {
    const typeLists = scope.ownEntries.tools.filter(
      (e) => e.kind === "builtin" && e.tool === "Agent" && e.agentTypes !== null,
    );
    throw new CursorToolListRefusal(
      `${scope.owner} lists ${typeLists.map((e) => e.raw).join(", ")}, which the Cursor engine cannot enforce: ` +
        "it cannot limit which sub-agents an agent starts. Run this agent on the native engine, or list Agent without types.",
    );
  }
  checkToolListResolution(scope, cursorToolInventory(input.mcp.servers, input.mcp.platformServerSlugs), (line) =>
    console.log(`ExecuteCursor tool lists: execution=${input.executionId}: ${line}`),
  );
}

/**
 * What a Cursor turn has, for the zero-resolution check: every Claude tool the
 * SDK's table covers, and the resolved servers but the platform's own
 * attachments, which no list governs and so no entry can name, exactly as the
 * native engine's `turnToolInventory` counts them.
 */
function cursorToolInventory(
  resolved: readonly ResolvedMcpServer[],
  platformServerSlugs: ReadonlySet<string>,
): TurnToolInventory {
  const servers = resolved.filter((s) => !platformServerSlugs.has(s.slug));
  return {
    claudeTools: claudeToolsOf(CURSOR_SDK_TOOL_COVERS.keys(), CURSOR_SDK_TOOL_COVERS),
    anyMcp: servers.length > 0,
    hasMcp(slug, tool) {
      const server = servers.find((s) => s.slug === slug);
      if (!server) return false;
      // A server never discovered cannot prove a tool absent.
      return tool === null || server.discoveredToolNames === null || server.discoveredToolNames.includes(tool);
    },
  };
}

/** The agent's hooks on this engine: the evaluator, and the SDK tools the turn hides because a hook would answer for them. */
export interface CursorHooks {
  readonly evaluator: HookEvaluator;
  readonly hiddenTools: readonly string[];
}

/**
 * A Cursor turn the workspace's hook files would leave unsafe is refused
 * before any agent exists (`workspace-hook-files.ts` says why): a person's
 * own folder whose `.claude` settings carry hooks, such settings reached
 * through a link, or a gate file that is a link, which the engine would not
 * load. Throws `CursorWorkspaceHooksRefusal`, which settles the turn
 * `failed` on the `actionable` surface.
 */
export async function checkWorkspaceHookFiles(input: TurnInput): Promise<void> {
  await refuseLinkedGateFile(input.workspace.primaryDir);
  await refuseOwnFolderHooks(workspaceFolders(input.workspace.dirs, input.workspace.provision.provisionResults));
}

/**
 * The agent's hooks, built as the native engine builds them
 * (`shared/hooks/setup.ts`) over this engine's views of its calls
 * (`hook-views.ts`); `null` for an agent with none this runner runs. Throws
 * `HookSetupError` when a hook cannot run as written, or when the session
 * runs a cloud agent, which loads no hook of the runner's.
 */
export async function prepareHooks(
  input: TurnInput,
  sink: Pick<TurnSink, "stopSignal" | "recordActivity">,
  config: CursorAdapterConfig,
  mode: { agentMode: CursorAgentMode },
): Promise<CursorHooks | null> {
  const primaryDir = input.workspace.primaryDir;
  const evaluator = await buildHookEvaluator({
    sources: input.hooks.sources,
    runValues: input.environment.envVars,
    agentEnv: input.blueprint.agent?.spec?.env,
    mcpServers: input.mcp.servers,
    provisionResults: input.workspace.provision.provisionResults,
    views: new CursorEngineToolViews({
      workspaceRoot: primaryDir,
      pluginServers: input.hooks.pluginServers,
      platformServerSlugs: input.mcp.platformServerSlugs,
    }),
    sessionId: input.sessionId,
    executionId: input.executionId,
    model: input.model.requested,
    workspaceRoot: primaryDir,
    permissionMode: hookPermissionMode(
      input.execution.spec?.interactionMode === InteractionMode.PLAN,
      input.mcp.leases.global,
    ),
    leases: input.mcp.leases.hooks,
    signal: sink.stopSignal,
    onActivity: (detail) => sink.recordActivity(detail),
    stallTimeoutMs: config.cursorStreamStallTimeoutMs,
  });
  if (evaluator === null) return null;
  if (mode.agentMode === "cloud") {
    throw new HookSetupError("The agent has hooks, which a cloud Cursor agent cannot run. Run the session locally or on the native engine.");
  }
  if (evaluator.longestTimeoutSeconds > MAX_HOOK_TIMEOUT_SECONDS) {
    throw new HookSetupError(
      `One of the agent's hooks may run for ${evaluator.longestTimeoutSeconds} seconds, longer than the ${MAX_HOOK_TIMEOUT_SECONDS} the Cursor engine allows. ` +
        "Lower its timeout, or run the session on the native engine.",
    );
  }
  const hiddenTools = toolsHiddenByHooks(evaluator.hookSet);
  if (hiddenTools.length > 0) {
    console.log(
      `ExecuteCursor hides ${hiddenTools.join(", ")}: the agent's hooks would answer for them, and Cursor shows them to no hook ` +
        `(execution=${input.executionId})`,
    );
  }
  return { evaluator, hiddenTools };
}

/**
 * The real path an excluded `Read` may still reach files inside
 * (`HookToolScope.readRoot`): the platform dir's, on a turn whose workspace
 * `.stigmer` is the link to it (`stigmerSymlinkPointsAt`), else "". A turn
 * that mounted no skill and no attachment made no link and has no platform
 * content, so a `.stigmer` there is the repository's own and admits nothing.
 */
export async function platformReadRoot(primaryDir: string, platformDir: string): Promise<string> {
  if (!(await stigmerSymlinkPointsAt(primaryDir, platformDir))) return "";
  return realpath(platformDir);
}

/**
 * The adapter's own read of the adjudicated rows the runtime already turned
 * into verdicts. Create-vs-resume is the adapter's fact about its ENGINE: a
 * bound agent id (`threadId`, engine-minted) means the Cursor agent already
 * holds this session's conversation, so this turn resumes it — the runtime's
 * `isReinvocation` answers its own question and is not consulted here.
 */
export function readAdjudicatedRows(input: TurnInput, status: RunStatus): AdjudicatedRows {
  const reinvoked = input.threadId !== "";
  const adjudicated = reinvoked ? reconstructAdjudicatedApprovals(input.execution.status?.messages ?? []) : undefined;
  return {
    isReinvocation: reinvoked,
    adjudicatedApprovals: adjudicated?.pendingApprovals ?? [],
    adjudicatedContentDigests: adjudicated?.contentDigests ?? new Map(),
    adjudicatedHookAsks: adjudicated?.hookAsked ?? new Set(),
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
 * Capture mode is the runtime's (`harness/capture.ts`: the baseline is pinned
 * before this adapter runs, the candidate captured after it returns); what
 * this gate contributes is the hook's on-disk sidecar of gitignored writes,
 * bound as the runtime's CAS observations.
 */
export async function installGate(
  input: TurnInput,
  sink: TurnSink,
  rows: AdjudicatedRows,
  streamState: TurnStreamState,
  hooks: CursorHooks | null,
): Promise<CursorGate> {
  const { executionId, sessionId, workspace, mcp, approvalDecisions, appliedToolCallIds, artifactStorage } = input;
  const { primaryDir, gitWorkspace, captureMode } = workspace;
  const globalBypass = mcp.leases.global;

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
  // Unattended approval mode: approver-less surfaces (channels,
  // guest shares) stamp APPROVAL_MODE_UNATTENDED; the hook then records
  // approval denials with the non-pausing "unattended" kind, so the
  // first-denial stop never fires and the turn boundary settles the denied
  // calls as SKIPPED instead of pausing a turn nobody can approve.
  const approvalState = buildApprovalState(
    mcp.mcpDefault,
    globalBypass,
    mcp.leases.categories,
    approvalGrants,
    captureMode,
    captureIgnored,
    gitWorkspace,
    isUnattendedApprovalMode(input.execution),
    // The agent's tool lists, answered for the hook's scope arm, which refuses
    // ahead of every approval bypass. The SDK's `tools` options hide what they
    // can on the main loop (`resolveEngine`); the hook binds every call,
    // sub-agents' and MCP tools' included.
    compileHookToolScope({
      scope: mcp.toolScope,
      servers: mcp.servers,
      platformServerSlugs: mcp.platformServerSlugs,
      readRoot: mcp.toolScope.restricted ? await platformReadRoot(primaryDir, getPlatformDir(sessionId)) : "",
      subAgentTypes: subAgentsInScope(input.blueprint.subAgents, mcp.toolScope).map((sa) => sa.name),
    }),
  );
  // The agent's hooks run inside the runner; the gate's script reaches them
  // on a local socket the pointer names (`hook-server.ts`), which closes with
  // the gate. A person's refusal of a call this run binds over a hook's allow.
  const hookServer = hooks === null
    ? undefined
    : await startHookServer({
        evaluator: hooks.evaluator,
        captureMode: workspace.captureMode,
        globalBypass,
        refusals: approvalDecisions.size > 0
          ? buildPersonRefusals(rows.adjudicatedApprovals, approvalDecisions, rows.adjudicatedContentDigests, rows.adjudicatedHookAsks)
          : new Map(),
      });
  let hitlGate: HitlGateHandle;
  try {
    hitlGate = await installHitlGate({
      workspaceRoot: primaryDir,
      hitlDir,
      approvalState,
      runnerPid: process.pid,
      ...(hookServer !== undefined && hooks !== null
        ? {
            hooks: {
              socketPath: hookServer.socketPath,
              token: hookServer.token,
            },
          }
        : {}),
      folders: workspaceFolders(workspace.dirs, workspace.provision.provisionResults),
    });
  } catch (err) {
    await hookServer?.close();
    throw err;
  }
  // Arm the denial watcher as soon as the gate exists. The per-turn ledger
  // reset may flip the flag once before the run starts; the loop's read then
  // sees an empty ledger and clears it — harmless by construction.
  const stopDenialWatcher = watchDenialLedger(hitlDir, () => {
    streamState.denialLedgerDirty = true;
  });
  sink.setupTiming.mark("install_hitl_gate");

  // What the hook observed touching gitignored (or, in a non-git tree, any)
  // paths this turn — the sidecar it stages under `captureIgnored`. Bound as
  // the runtime's CAS observations; each read is one small directory scan,
  // and the runtime reads it at most once per progress floor and once at the
  // boundary. Bound whenever the gate exists: without storage the runtime
  // ignores it (a gitignored write is deny-gated then, never captured).
  sink.bindCasObservations(() => readSidecarSnapshot(hitlDir));

  return {
    hitlDir,
    hitlGate,
    approvalGrants,
    ...(hookServer !== undefined ? { hookDecisions: hookServer.decisions } : {}),
    stopDenialWatcher,
    removeGate: async () => {
      try {
        await removeHitlGate(hitlGate);
      } finally {
        await hookServer?.close();
      }
    },
  };
}

/**
 * Resolve the Cursor agent (parked, created, resumed, or created after a
 * resume failure), emit the cold-start line, and bind a NEW agent's id
 * through the sink before anything else runs (a rejected bind ends
 * the turn `failed`; the sink rejects and the caller's catch names it).
 *
 * The requested name and the effective tier and thinking mode are the
 * runtime's; validating the NAME against Cursor's catalog is this harness's.
 */
export async function resolveEngine(
  input: TurnInput,
  sink: TurnSink,
  config: CursorAdapterConfig,
  mode: { cursorMode: CursorMode; agentMode: CursorAgentMode },
  hooks: CursorHooks | null = null,
): Promise<CursorEngine> {
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

  // In proxy mode, the SDK's API key is the control-plane credential, read
  // from the ref now (per turn) — the proxy validates it and injects the real
  // Cursor API key server-side. In direct mode, the user's own CURSOR_API_KEY.
  const effectiveApiKey = config.proxyEndpoint
    ? config.stigmerTokenRef.current
    : config.cursorApiKey;
  if (!effectiveApiKey || effectiveApiKey === "proxy-managed") {
    const source = config.proxyEndpoint ? "proxy (STIGMER_TOKEN)" : "direct (CURSOR_API_KEY)";
    throw new Error(
      `No Cursor API credential available. Mode=${source}, ` +
        `proxyEndpoint=${config.proxyEndpoint ?? "unset"}, ` +
        `hasStigmerToken=${!!config.stigmerTokenRef.current}`,
    );
  }

  // Register blueprint sub-agents with the Cursor SDK so the parent can
  // delegate to them by name via the Task tool. Re-supplied on every
  // create/resume (the SDK does not persist agent config across resume).
  // Only the types the agent's `Agent(type, …)` allows are registered.
  const cursorSubAgents = buildCursorSubAgentDefinitions(subAgentsInScope(blueprint.subAgents, input.mcp.toolScope));
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
        // The main loop's built-ins the lists exclude, hidden by the SDK
        // (`read` and `mcp` never: the hook confines those), and the tools
        // a hook would answer for that Cursor never shows one.
        ...withToolsHidden(cursorSdkToolOptions(input.mcp.toolScope, input.mcp.servers.length > 0), hooks?.hiddenTools ?? []),
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
  // (one writer per field); the runtime sets harness_state_id and
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
      // release them (found by the contract kit in #1070). Then let the
      // rejection settle the turn `failed`, as the contract states.
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
  const interactionMode = spec.interactionMode ?? InteractionMode.UNSPECIFIED;
  const buildFromPlan = spec.buildFromPlan ?? false;

  const shared = (): Omit<BuildPromptInput, "resolution" | "recalledMemories" | "turnRecoveryDigest"> => ({
    approvalDecisions,
    instructions: blueprint.instructions,
    userMessage: spec.message,
    skills: input.skills.root,
    channelMessaging: input.mcp.channelMessaging,
    subAgents: subAgentsInScope(blueprint.subAgents, input.mcp.toolScope),
    workspaceDirs: [...workspace.dirs],
    workspaceFileRefs: spec.workspaceFileRefs ?? [],
    attachments: attachments.results,
    vision: visionPromptInfoOf(attachments),
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

