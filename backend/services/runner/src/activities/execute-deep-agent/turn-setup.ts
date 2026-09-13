/**
 * The native deep-agent harness's setup — what the LangGraph engine needs
 * before it can run a turn, as small named steps over the runtime's resolved
 * `TurnInput`, each returning a typed slice (the Cursor adapter's
 * `turn-setup.ts` mold; never one long function).
 *
 * Everything harness-agnostic has already happened when these run: the
 * execution, session and blueprint are fetched, the workspace is provisioned
 * and locked, the MCP servers and approval policies are merged, the skills
 * are mounted per owner, the attachments are resolved, the transcript is
 * seeded. What remains is this engine's own reading of that record: the
 * checkpointer; the deepagents backend and the CAS observer, rooted at the
 * tree the runtime locked; the MCP connection that turns resolved servers
 * into LangChain tools; the model; the middleware stack with the approval
 * gate over the runtime's policies; the compiled sub-agents; the system
 * prompt and the user message; `createDeepAgent`; the checkpoint read that
 * decides between a `Command(resume)` and a fresh message; and, in capture
 * mode, the baseline pin and the progress substrate.
 *
 * Every step reads `TurnInput` and the sink and nothing else of the
 * runtime's. The `execution_setup` cold-start line is emitted here, once the
 * graph exists, over the runtime's timeline (`sink.setupTiming`), so the one
 * timeline reads end to end. The three progress labels only this harness
 * knows are reported through the sink exactly as the orchestrator reported
 * them (the resolution labels are the runtime's).
 *
 * One root for everything (Q-S3-8): the deepagents backend, the CAS
 * observer, the gate's path normalization and the publisher are all rooted
 * at `workspace.primaryDir` — the same tree the runtime locks, links and
 * captures. For zero or one workspace entry this is byte-identical to the
 * orchestrator's `workspaceBackend.rootDir`.
 *
 * Moved from `setup.ts` `performSetup` (the LangGraph half; the resolution
 * half is the runtime's twelve phases) at S3 M2a; the step bodies are the
 * orchestrator's, verbatim where nothing changed.
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { Command } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";
import { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";

import type { Config } from "../../config.js";
import type { TurnInput, TurnSink } from "../../harness/types.js";
import { emitTimingLog } from "../../shared/cold-start-timing.js";
import { createCheckpointer } from "../../shared/checkpointer/factory.js";
import { ensureCheckpointDbPath } from "../../shared/workspace/platform-dir.js";
import { LocalWorkspaceBackend } from "../../shared/workspace/local-backend.js";
import type { WorkspaceBackend } from "../../shared/workspace/types.js";
import { connectMcpServers, type McpConnectionResult } from "../../shared/mcp-manager.js";
import { formatChannelTemplatesSection } from "../../shared/channel-attachment.js";
import { isPathCapturable } from "../../shared/filereview/git-substrate.js";
import { resolveWorkspacePath } from "../../shared/file-change.js";
import { buildPlanModePermissions } from "../../shared/plan-mode-permissions.js";
import { buildMiddlewareStack } from "../../middleware/index.js";
import type { ApprovalGateConfig } from "../../middleware/approval-gate.js";
import { createThinkTool, createWebFetchTool, resolveGuardPosture } from "../../tools/index.js";
import { deriveExecutionFingerprintKey } from "../../shared/approval-fingerprint.js";
import { getRunnerHitlMasterSecret } from "../../shared/fingerprint-secret.js";
import { getModelPricing, ensureLoaded as ensurePricingLoaded, type ModelPricing } from "../../shared/model-pricing.js";
import { getDefaultModel } from "../../shared/model-registry.js";
import { buildChatModel } from "../../shared/model-client.js";
import { isUnattendedApprovalMode, type MergedToolPolicy } from "../../shared/approval-policy.js";
import type { ToolApprovalCategory } from "../../shared/tool-kind.js";
import { filterSkills, SKILL_COUNT_THRESHOLD } from "../../shared/skill-relevance.js";
import { generateAlsoAvailableSection } from "../../shared/skill-writer.js";
import { toLangChainImageBlocks } from "../../shared/attachment-vision.js";
import { resolveRecursionLimit, UNBOUNDED_ADVISORY_RECURSION_LIMIT } from "../../shared/tool-rounds.js";
import { jsonSchemaToZod } from "../../shared/json-schema-to-zod.js";
import { captureBaselineToLedger } from "../../shared/filereview/capture.js";
import {
  createGitProgressSubstrate,
  createHybridProgressSubstrate,
  newProgressCaptureState,
  type ProgressCaptureState,
  type ProgressSubstrate,
} from "../../shared/filereview/progress.js";
import { createCasProgressSubstrate, type CasTouchedSnapshot } from "../../shared/filereview/cas-progress.js";
import { collectSettledToolCallIds, collectSubAgentToolCallIds } from "../../shared/tool-row.js";
import { CasCaptureObserver } from "./cas-capture-observer.js";
import { createCasCaptureBackend } from "./cas-capture-backend.js";
import { DEEP_AGENT_HARNESS_ID } from "./deep-agent-capabilities.js";
import { resolveResumeInput, type GraphStateSnapshot } from "./hitl.js";
import { buildEnhancedSystemPrompt, composeUserMessage, renderSkillsSection } from "./prompt-builder.js";
import { buildShellEnv } from "./shell-env.js";
import { modelHasNativeThinking, transformAndCompileSubagents } from "./subagent-transformer.js";

/**
 * The runner config this harness reads per turn, as a named slice
 * (`execute-cursor/turn-setup.ts` `CursorAdapterConfig` is the idiom): a
 * whole `Config` satisfies it, a test constructs these fields and nothing
 * else. Smaller than the orchestrator's reach — the synthesized attachments'
 * endpoints it read are the runtime's now (S3 M2a, F-M2a-10).
 */
export type DeepAgentAdapterConfig = Pick<
  Config,
  "checkpointerType" | "checkpointerProxyEndpoint" | "stigmerToken" | "proxyEndpoint" | "mode"
>;

/** The deepagents graph as this module holds it; deepagents exports no stable type for the compiled agent. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AgentGraph = any;

/** The workspace as this engine sees it: one backend and one CAS observer, both rooted at the runtime's primary tree. */
export interface DeepAgentWorkspace {
  readonly backend: WorkspaceBackend;
  readonly casObserver: CasCaptureObserver;
  /** Git-tracked capturability, consulted by the gate to route a file write to git-diff (tracked) vs CAS (ignored). */
  readonly isCapturablePath: (rawPath: string) => Promise<boolean>;
}

/** The tool surface once connected: LangChain tools plus the tool → server map the builders attribute by. */
export interface DeepAgentTools {
  readonly connection: McpConnectionResult;
  readonly toolServerMap: ReadonlyMap<string, string>;
}

/** The gate's posture for this turn, read once and shared by the builders, the reconciler and the sub-agents. */
export interface DeepAgentGateState {
  readonly policies: ReadonlyMap<string, MergedToolPolicy>;
  readonly toolServerMap: ReadonlyMap<string, string>;
  readonly leasedCategories: ReadonlySet<ToolApprovalCategory>;
  /** Pre-armed spec.auto_approve_all — the one unscoped, whole-run bypass; the gate is not installed under it. */
  readonly globalBypass: boolean;
  /** Unattended approval mode (DD-014): the gate auto-skips instead of interrupting. */
  readonly unattended: boolean;
  /** Tool-call ids the gate auto-skipped this turn; written by the gate, read by `reconcileUnattendedSkips`. */
  readonly unattendedSkips: Set<string>;
}

/** The engine this turn runs on and everything the stream and the settle read from it. */
export interface DeepAgentEngine {
  readonly graph: AgentGraph;
  readonly checkpointer: BaseCheckpointSaver;
  readonly langgraphConfig: Record<string, unknown>;
  /** The registry id the turn runs on (pricing, the thinking heuristic, sub-agent inheritance key on it). */
  readonly modelName: string;
  readonly pricing: ModelPricing;
  readonly gate: DeepAgentGateState;
  readonly hasStructuredOutput: boolean;
}

/** What the graph is invoked with: a resume of the paused gate, or the turn's user message. */
export type DeepAgentGraphInput =
  | { readonly kind: "resume"; readonly command: Command }
  | { readonly kind: "message"; readonly input: Record<string, unknown> };

/** The capture posture pinned for this turn (adapter-side until M4). */
export interface DeepAgentCapture {
  /** The pre-turn tree in capture mode on a git work tree; `""` otherwise. */
  readonly baselineTree: string;
  readonly progressSubstrate: ProgressSubstrate | undefined;
  readonly progressState: ProgressCaptureState;
  /** Sub-agent tool-call ids on the status BEFORE this turn's stream, so the boundary stamps only this turn's rows. */
  readonly priorSubAgentToolCallIds: ReadonlySet<string>;
  /** Top-level tool-call ids already settled before this turn's stream (the DD-28 provenance scope). */
  readonly priorSettledToolCallIds: ReadonlySet<string>;
}

// ── Steps ───────────────────────────────────────────────────────────────────

/**
 * The registry id the turn runs on: the execution's, or the registry's
 * default when it named none — the same reading the runtime's attachment
 * phase made for the vision budget, so the model that sees the images is
 * the model that runs.
 */
export async function resolveModelName(input: TurnInput): Promise<string> {
  return input.execution.spec?.executionConfig?.modelName || (await getDefaultModel());
}

/**
 * The checkpoint saver. The durable local (sqlite) backend keys its file
 * per session — a session has exactly one thread (`thread-{sessionId}`), so
 * checkpoint lifetime tracks session lifetime. Opened per turn and closed
 * in the adapter's `finally` (`turn.ts`).
 */
export async function openCheckpointer(input: TurnInput, sink: TurnSink, config: DeepAgentAdapterConfig): Promise<BaseCheckpointSaver> {
  const checkpointer = await createCheckpointer({
    type: config.checkpointerType,
    proxyEndpoint: config.checkpointerProxyEndpoint ?? undefined,
    authToken: config.stigmerToken ?? undefined,
    sqlitePath: config.checkpointerType === "sqlite" ? await ensureCheckpointDbPath(input.sessionId) : undefined,
  });
  sink.setupTiming.mark("create_checkpointer");
  return checkpointer;
}

/**
 * The workspace as the engine sees it, rooted at the runtime's primary tree
 * (Q-S3-8). The platform dir the shared provision ensured rides along so
 * the backend routes `.stigmer/…` reads to it.
 *
 * CAS capture (design docs 08/11/12): the single per-turn observer owns the
 * before-bytes of first-touched CAS-owned paths AND the secret-blocked
 * paths, keyed workspace-root-relative. Shared by the parent AND every
 * sub-agent CAS backend, giving race-free first-touch-wins across
 * concurrent graphs. In a git work tree it owns the .gitignored set only
 * (git captures the tracked ones); in a non-git workspace it owns every
 * touched path. Its ownership predicate is memoized, so `git check-ignore`
 * runs at most once per distinct path.
 */
export function buildDeepAgentWorkspace(input: TurnInput): DeepAgentWorkspace {
  const { primaryDir, gitWorkspace, provision } = input.workspace;
  const backend = new LocalWorkspaceBackend(primaryDir, provision.workspaceBackend.platformDir);
  const isCapturablePath = gitWorkspace
    ? (rawPath: string): Promise<boolean> =>
        isPathCapturable(primaryDir, resolveWorkspacePath(rawPath, primaryDir, true).path)
    : (_rawPath: string): Promise<boolean> => Promise.resolve(false);
  const casObserver = new CasCaptureObserver({
    rootDir: primaryDir,
    isIgnored: gitWorkspace
      ? async (relPath) => !(await isPathCapturable(primaryDir, relPath))
      : async () => true,
  });
  return { backend, casObserver, isCapturablePath };
}

/**
 * Connect the runtime's resolved servers (synthesized attachments included)
 * into LangChain tools. The connect covers the whole fan-out — stdio servers
 * spawn npx/uvx subprocesses here, so on-demand package installs land in
 * this span. A turn with no servers connects nothing and reports nothing.
 */
export async function connectTools(input: TurnInput, sink: TurnSink): Promise<DeepAgentTools> {
  if (input.mcp.servers.length > 0) {
    await sink.reportProgress("Connecting tools…");
  }
  const connection = await connectMcpServers([...input.mcp.servers]);
  const toolServerMap = new Map<string, string>();
  for (const [serverName, serverTools] of Object.entries(connection.serverToolMap)) {
    for (const t of serverTools) toolServerMap.set(t.name, serverName);
  }
  sink.setupTiming.mark("connect_mcp");
  sink.recordActivity();
  return { connection, toolServerMap };
}

/**
 * The gate's posture. Two distinct bypasses (`shared/approval-policy.ts`
 * `ActiveLeases`): the pre-armed spec.auto_approve_all is the one whole-run
 * global bypass; an interactive APPROVE_ALL grants a run-lifetime lease
 * scoped to that action's class. Server leases shaped the runtime's policy
 * map (leased servers dropped); built-in category leases are applied inside
 * the gate. Both flow into sub-agents via the shared gate config.
 */
export function readGateState(input: TurnInput, tools: DeepAgentTools): DeepAgentGateState {
  return {
    policies: input.mcp.policies,
    toolServerMap: tools.toolServerMap,
    leasedCategories: input.mcp.leases.categories,
    globalBypass: input.mcp.leases.global,
    unattended: isUnattendedApprovalMode(input.execution),
    unattendedSkips: new Set<string>(),
  };
}

/**
 * The `## Skills` section of the root prompt: every mounted skill, or — at
 * and above the relevance threshold — the ones the filter keeps for this
 * turn's message plus an "also available" note naming the rest.
 */
export function renderRootSkillsSection(input: TurnInput): string {
  const skills = input.skills.root;
  if (skills.length === 0) return "";
  if (skills.length >= SKILL_COUNT_THRESHOLD) {
    const filter = filterSkills(
      input.execution.spec?.message ?? "",
      skills.map((s) => s.name),
      skills.map((s) => s.description),
    );
    if (filter.excludedNames.length > 0) {
      const included = filter.includedIndices.map((i) => skills[i]);
      console.log(
        `[turn-setup] Skill relevance filter: ${included.length} included, ` +
        `${filter.excludedNames.length} excluded: ${filter.excludedNames.join(", ")}`,
      );
      return renderSkillsSection(included) + generateAlsoAvailableSection(filter.excludedNames);
    }
  }
  return renderSkillsSection(skills);
}

/**
 * Build the engine: the model, the middleware stack with the gate, the
 * tools, the compiled sub-agents, the system prompt and `createDeepAgent`.
 *
 * The service tier resolved ONCE by the runtime rides every model this
 * execution constructs — the primary AND the sub-agent factory — so the
 * provider account's default can never pick the price of any turn (#361).
 * `max_tool_rounds` resolves to one recursion limit that feeds BOTH the hard
 * stop on the invoke config and the budget middleware's ~80% advisory, so
 * the warning and the enforcement can never disagree.
 *
 * The middleware stack is the orchestrator's whole (graceful stop included,
 * never activated here; the cost cap still enforcing inside the graph)
 * until M2b performs Q-S3-3's deletions with the legacy caller gone
 * (Q-M2a-4): the runtime's abort is the platform's one stop, and its
 * TERMINATED arm the one enforcement of `max_cost_usd`.
 */
export async function buildEngine(
  input: TurnInput,
  sink: TurnSink,
  config: DeepAgentAdapterConfig,
  args: {
    readonly modelName: string;
    readonly checkpointer: BaseCheckpointSaver;
    readonly workspace: DeepAgentWorkspace;
    readonly tools: DeepAgentTools;
    readonly gate: DeepAgentGateState;
  },
): Promise<DeepAgentEngine> {
  const { modelName, checkpointer, workspace, tools, gate } = args;
  const { executionId, sessionId, blueprint, artifactStorage } = input;
  const spec = input.execution.spec!;
  const execConfig = spec.executionConfig;
  const primaryDir = input.workspace.primaryDir;

  // The model. Resolution to the provider API id happens inside
  // buildChatModel; modelName stays the registry id for pricing, the
  // native-thinking heuristic, and sub-agent inheritance.
  const buildModelFor = async (name: string) =>
    (await buildChatModel({
      modelName: name,
      proxyEndpoint: config.proxyEndpoint ?? undefined,
      stigmerToken: config.stigmerToken ?? undefined,
      headerScope: { executionId },
      serviceTier: input.model.serviceTier,
    })).model;
  const model = await buildModelFor(modelName);
  sink.setupTiming.mark("build_model");

  await ensurePricingLoaded();
  const pricing = getModelPricing(modelName);
  const isPlanMode = execConfig?.interactionMode === InteractionMode.PLAN;
  const shellEnv = isPlanMode ? undefined : buildShellEnv(input.environment.envVars);
  // Plan mode's filesystem permission rules, hoisted once: the parent graph
  // and every sub-agent graph carry this single value (the write-deny half
  // of plan mode; the read boundary is structural, issue #754).
  const planModePermissions = isPlanMode ? buildPlanModePermissions() : undefined;

  // The approval gate config is the single source of truth for HITL gating,
  // built once and inherited verbatim by sub-agents. Null under the global
  // pre-arm, where the gate is inert. Capture mode: file edits flow (tracked
  // to the git diff, ignored into CAS on THIS gate); secret-like paths are
  // hard-blocked (DD-E); shell/MCP stay gated. The CAS arm additionally
  // requires storage to persist its blobs.
  const captureMode = input.workspace.captureMode;
  const approvalGateConfig: ApprovalGateConfig | null = !gate.globalBypass
    ? {
        policies: gate.policies,
        leasedCategories: gate.leasedCategories,
        toolServerMap: gate.toolServerMap,
        fingerprintKey: deriveExecutionFingerprintKey(getRunnerHitlMasterSecret(), executionId),
        executionId,
        fileCaptureMode: captureMode,
        isCapturablePath: workspace.isCapturablePath,
        captureIgnored: captureMode && !!artifactStorage,
        recordBlockedSecret: (rawPath: string) => workspace.casObserver.recordBlockedSecret(rawPath),
        // Pre-delete byte capture (issue #303): a flowing delete's before-bytes
        // are recorded by the gate at authorization time through the SAME
        // shared observer, so the boundary authors a restorable DELETE.
        captureDeleteBefore: (rawPath: string) => workspace.casObserver.recordBefore(rawPath),
        unattended: gate.unattended,
        unattendedSkips: gate.unattendedSkips,
      }
    : null;

  const maxCostUsd = execConfig?.maxCostUsd ?? 0;
  const recursionLimit = resolveRecursionLimit(execConfig?.maxToolRounds);
  const { middleware, costCap: costCapMiddleware } = buildMiddlewareStack({
    loopDetection: { historySize: 20, consecutiveThreshold: 7, totalThreshold: 20 },
    executionBudget: { recursionLimit: recursionLimit ?? UNBOUNDED_ADVISORY_RECURSION_LIMIT, warningPct: 80 },
    toolTruncation: { maxChars: execConfig?.maxToolResultChars || 30_000 },
    costCap: maxCostUsd > 0
      ? {
          maxCostUsd,
          inputPricePerMillion: pricing.inputPricePerMillion,
          outputPricePerMillion: pricing.outputPricePerMillion,
          cacheReadPricePerMillion: pricing.cacheReadPricePerMillion,
          warningPct: 80,
        }
      : null,
    otelSpans: { toolServerMap: gate.toolServerMap },
    approvalGate: approvalGateConfig,
    // Every graph, every mode (issue #754): the dialect-repair seam that keeps
    // model-supplied paths canonical for the virtual-rooted backend and every
    // downstream consumer (gate, capture, spans).
    pathNormalization: { rootDir: primaryDir },
  });
  sink.setupTiming.mark("build_middleware");

  // web_fetch is always-on for every native run (issue #214 parity with the
  // Cursor harness); its URL guard posture — strict on managed cloud runners,
  // relaxed on user-owned machines — is derived from the runner mode.
  const webFetchPosture = resolveGuardPosture(config.mode);
  const mcpTools = (tools.connection.tools as DynamicStructuredTool[]) ?? [];
  const graphTools = [...mcpTools, createThinkTool(), createWebFetchTool({ posture: webFetchPosture })];

  const subAgentProtos = blueprint.subAgents;
  await sink.reportProgress("Configuring sub-agents…");
  const parentMcpServerToolMap = new Map<string, DynamicStructuredTool[]>();
  for (const [serverName, serverTools] of Object.entries(tools.connection.serverToolMap)) {
    parentMcpServerToolMap.set(serverName, serverTools as DynamicStructuredTool[]);
  }
  const compiledSubagents = await transformAndCompileSubagents({
    subAgents: subAgentProtos,
    parentMcpTools: mcpTools,
    parentMcpServerToolMap,
    parentMcpUsages: blueprint.mergedMcpServerUsages,
    skills: input.skills.bySubAgent,
    workspaceBackend: workspace.backend,
    approvalGate: approvalGateConfig,
    // Capture is universal: every sub-agent gets a CAS-observing backend wired
    // to the SAME per-turn observer as the parent (Session 26, DD-19).
    casObserver: workspace.casObserver,
    parentModelName: modelName,
    parentHasNativeThinking: modelHasNativeThinking(modelName),
    webFetchPosture,
    costCap: costCapMiddleware ?? undefined,
    modelFactory: buildModelFor,
    shellEnv,
    ...(planModePermissions ? { permissions: planModePermissions } : {}),
  });
  sink.setupTiming.mark("compile_subagents");
  sink.recordActivity();

  await sink.reportProgress("Creating agent…");
  const systemPrompt = buildEnhancedSystemPrompt({
    instructions: blueprint.instructions,
    provisionResults: input.workspace.provision.provisionResults,
    containerRoot: primaryDir,
    skillsPromptSection: renderRootSkillsSection(input),
    // "" (nothing sendable) threads as undefined: the tool alone still serves
    // text sends inside a 24-hour window (DD-006 D6).
    channelTemplatesPromptSection: input.mcp.channelMessaging.length > 0
      ? formatChannelTemplatesSection(input.mcp.channelMessaging) || undefined
      : undefined,
    workspaceFileRefs: spec.workspaceFileRefs ?? [],
    workspaceRoot: primaryDir,
    inputFiles: input.attachments.results,
    vision: input.attachments.visionImages.length > 0 || input.attachments.visionNotViewable.length > 0
      ? {
          inlineFilenames: input.attachments.visionImages.map((v) => v.filename),
          notViewable: input.attachments.visionNotViewable,
        }
      : undefined,
    downloadUrlKind: artifactStorage?.downloadUrlKind,
    interactionMode: execConfig?.interactionMode,
    buildFromPlan: execConfig?.buildFromPlan,
    contextBridge: input.standing.contextBridge,
    senderIdentity: input.standing.senderIdentity,
    sessionContext: input.standing.sessionContext,
    declaredPreferences: input.standing.declaredPreferences,
    // The runtime's memoized selection; it stamps the report on the status
    // the first time it is pulled, before this turn's first persist.
    recalledMemories: await input.standing.selectRecalledMemories(),
  });

  const outputSchema = input.structuredOutputSchema;
  const responseFormat = outputSchema ? jsonSchemaToZod(outputSchema) : undefined;

  // File capture point: the CAS-observing backend — git-tracked edits flow to
  // disk (the boundary's git diff is authoritative) and the shared observer
  // records the pre-turn bytes of every CAS-owned path. Gate-independent, so
  // it holds even under the global bypass.
  const fileBackend = await createCasCaptureBackend({ rootDir: primaryDir, observer: workspace.casObserver, shellEnv });
  const graph = await createDeepAgent({
    model,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    checkpointer: checkpointer as any,
    backend: fileBackend,
    systemPrompt,
    tools: graphTools,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    middleware: middleware as any,
    subagents: compiledSubagents ?? undefined,
    ...(responseFormat ? { responseFormat } : {}),
    ...(planModePermissions ? { permissions: planModePermissions } : {}),
  } as Parameters<typeof createDeepAgent>[0]);

  const langgraphConfig: Record<string, unknown> = {
    configurable: { thread_id: input.threadId },
    // Hard enforcement of max_tool_rounds (null = unlimited): when the graph
    // exhausts this, the stream throws GraphRecursionError and the adapter
    // ends the turn `tool_call_limit` with the work checkpointed.
    ...(recursionLimit !== null ? { recursionLimit } : {}),
  };

  console.log(
    `[turn-setup] Complete: model=${modelName}, tools=${graphTools.length}, ` +
    `middleware=${middleware.length}, thread_id=${input.threadId}`,
  );
  sink.setupTiming.mark("create_agent_graph");
  emitTimingLog("execution_setup", {
    execution_id: executionId,
    session_id: sessionId,
    harness: "native",
    mcp_server_count: blueprint.mergedMcpServerUsages.length,
    skill_count: blueprint.mergedSkillRefs.length,
    workspace_entry_count: input.session.spec?.workspaceEntries?.length ?? 0,
  }, sink.setupTiming);
  sink.recordActivity();

  return {
    graph,
    checkpointer,
    langgraphConfig,
    modelName,
    pricing,
    gate,
    hasStructuredOutput: !!outputSchema,
  };
}

/**
 * What the graph is invoked with. The checkpoint is read once (on the
 * durable http saver an extra `getState` is a network round-trip): pending
 * interrupts that the runtime's decisions answer make a `Command(resume)`;
 * anything else is the turn's user message — the conversation catchup
 * framed before it (cloud DD-006; in the USER MESSAGE so it enters the
 * checkpointer with the turn), the structured-output contract appended, and
 * the inline images FIRST as content blocks when the turn carries any (per
 * Anthropic's images-before-text guidance; a plain string otherwise).
 */
export async function composeGraphInput(input: TurnInput, engine: DeepAgentEngine): Promise<DeepAgentGraphInput> {
  const graphState: GraphStateSnapshot = await engine.graph.getState(engine.langgraphConfig);
  const resume = resolveResumeInput(input.approvalDecisions, graphState);
  if (resume.isResumeFromApproval) {
    return { kind: "resume", command: resume.graphInput };
  }

  const spec = input.execution.spec!;
  let userMessage = composeUserMessage(spec.message, input.standing.conversationCatchup);
  if (engine.hasStructuredOutput) {
    userMessage += `\n\n---\nIMPORTANT: When your analysis is complete, provide your findings as structured output matching the required schema. The system will capture your structured response automatically.`;
  }
  const { visionImages } = input.attachments;
  return {
    kind: "message",
    input: {
      messages: [
        {
          role: "user",
          content: visionImages.length > 0
            ? [...toLangChainImageBlocks(visionImages), { type: "text", text: userMessage }]
            : userMessage,
        },
      ],
    },
  };
}

/**
 * Turn start in capture mode: pin the pre-turn tree and author BASELINE on
 * the status (the event rides the next persist), then choose the mid-run
 * progress substrate for this turn's workspace shape (git → hybrid of
 * numstat for tracked paths and the observer for ignored ones; non-git →
 * CAS over the observer). Taken AFTER the runtime's reconcile and AFTER its
 * skill and attachment phases wrote into the workspace, so the baseline
 * absorbs the reconciled state and the runner-owned entries.
 *
 * The two id snapshots scope the turn boundary to THIS turn's rows: the
 * sub-agent stamp to sub-agent rows created this turn, the DD-28 provenance
 * to commands executed this turn (the deep-agent's approved shell executes
 * in place at its seeded position, so a positional scope would miss it).
 */
export async function pinCaptureBaseline(input: TurnInput, sink: TurnSink, workspace: DeepAgentWorkspace): Promise<DeepAgentCapture> {
  const { executionId } = input;
  const { primaryDir, gitWorkspace, captureMode, changeSetId } = input.workspace;
  const { status } = sink;

  const priorSubAgentToolCallIds = collectSubAgentToolCallIds(status.subAgentExecutions);
  const priorSettledToolCallIds = collectSettledToolCallIds(status.messages);

  let baselineTree = "";
  if (captureMode) {
    baselineTree = await captureBaselineToLedger({
      status,
      gitRoot: primaryDir,
      executionId,
      changeSetId,
      harnessId: DEEP_AGENT_HARNESS_ID,
      gitWorkspace,
    });
  }

  const readObserverTouched = (): CasTouchedSnapshot => ({
    before: new Map(workspace.casObserver.before),
    blockedSecretPaths: new Set(workspace.casObserver.blockedSecretPaths),
  });
  const progressSubstrate: ProgressSubstrate | undefined = !captureMode
    ? undefined
    : gitWorkspace
      ? baselineTree
        ? createHybridProgressSubstrate(
            createGitProgressSubstrate({ workspaceRoot: primaryDir, executionId, baselineTree }),
            createCasProgressSubstrate({ workspaceRoot: primaryDir, read: readObserverTouched }),
          )
        : undefined
      : createCasProgressSubstrate({ workspaceRoot: primaryDir, read: readObserverTouched });

  return {
    baselineTree,
    progressSubstrate,
    progressState: newProgressCaptureState(),
    priorSubAgentToolCallIds,
    priorSettledToolCallIds,
  };
}
