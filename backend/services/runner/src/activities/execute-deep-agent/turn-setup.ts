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
 * prompt and the user message; `createDeepAgent`; and the checkpoint read
 * that decides between a `Command(resume)` and a fresh message. The
 * file-review capture is the runtime's (`harness/capture.ts`); this harness
 * hands it only what its CAS observer saw (`turn.ts`).
 *
 * Every step reads `TurnInput` and the sink and nothing else of the
 * runtime's. The `execution_setup` cold-start line is emitted here, once the
 * graph exists, over the runtime's timeline (`sink.setupTiming`), so the one
 * timeline reads end to end. The three progress labels only this harness
 * knows are reported through the sink exactly as the orchestrator reported
 * them (the resolution labels are the runtime's).
 *
 * One root for everything: the deepagents backend, the CAS
 * observer, the gate's path normalization and the publisher are all rooted
 * at `workspace.primaryDir` — the same tree the runtime locks, links and
 * captures. For zero or one workspace entry this is byte-identical to the
 * orchestrator's `workspaceBackend.rootDir`.
 *
 * Moved from `setup.ts` `performSetup` (the LangGraph half; the resolution
 * half is the runtime's twelve phases) in #1096; the step bodies are the
 * orchestrator's, verbatim where nothing changed.
 */

import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import type { Command } from "@langchain/langgraph";
import { createDeepAgent } from "deepagents";
import { providerStrategy } from "langchain";
import { transformJSONSchema } from "@anthropic-ai/sdk/lib/transform-json-schema";
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
import { getDefaultModel, getNativeRequestProfile } from "../../shared/model-registry.js";
import { buildChatModel } from "../../shared/model-client.js";
import { graphThinks, toAnthropicThinking } from "../../shared/thinking-mode.js";
import { isUnattendedApprovalMode, type MergedToolPolicy } from "../../shared/approval-policy.js";
import type { ToolApprovalCategory } from "../../shared/tool-kind.js";
import { visionPromptInfoOf } from "../../shared/prompt-sections.js";
import { findApprovedPlanPath } from "../../shared/implement-plan-prompt.js";
import type { RecalledMemoriesContent } from "../../shared/recalled-memories.js";
import { toLangChainImageBlocks } from "../../shared/attachment-vision.js";
import { backstopRecursionLimit, resolveToolRoundLimit } from "../../shared/tool-rounds.js";
import { jsonSchemaToZod } from "../../shared/json-schema-to-zod.js";
import { CasCaptureObserver } from "./cas-capture-observer.js";
import { createCasCaptureBackend } from "./cas-capture-backend.js";
import { mountPlatformRoute } from "./platform-route.js";
import { resolveResumeInput, type GraphStateSnapshot } from "./hitl.js";
import { buildEnhancedSystemPrompt, composeUserMessage, renderSkillsSection } from "./prompt-builder.js";
import { buildShellEnv, shellRunValues } from "./shell-env.js";
import { transformAndCompileSubagents } from "./subagent-transformer.js";
import { createTodoListMiddleware } from "./todo-list.js";

/**
 * The runner config this harness reads per turn, as a named slice
 * (`execute-cursor/turn-setup.ts` `CursorAdapterConfig` is the idiom): a
 * whole `Config` satisfies it, a test constructs these fields and nothing
 * else. Smaller than the orchestrator's reach — the synthesized attachments'
 * endpoints it read are the runtime's now (since #1096).
 */
export type DeepAgentAdapterConfig = Pick<
  Config,
  "checkpointerType" | "checkpointerProxyEndpoint" | "stigmerTokenRef" | "proxyEndpoint" | "mode"
>;

/**
 * A JSON object schema, the shape langchain's provider strategy takes for a
 * plain schema (its own type for it is not exported). An execution's
 * structured output schema is an object schema; the SDK's transform keeps
 * its root `type`.
 */
type ObjectJsonSchema = { type: "object"; [key: string]: unknown };

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
  /** Absent when the turn has no servers to connect: `MultiServerMCPClient` refuses an empty config. */
  readonly connection: McpConnectionResult | undefined;
  readonly mcpTools: readonly DynamicStructuredTool[];
  readonly serverToolMap: ReadonlyMap<string, readonly DynamicStructuredTool[]>;
  readonly toolServerMap: ReadonlyMap<string, string>;
}

/** The gate's posture for this turn, read once and shared by the builders, the reconciler and the sub-agents. */
export interface DeepAgentGateState {
  readonly policies: ReadonlyMap<string, MergedToolPolicy>;
  readonly toolServerMap: ReadonlyMap<string, string>;
  readonly leasedCategories: ReadonlySet<ToolApprovalCategory>;
  /** Pre-armed spec.auto_approve_all — the one unscoped, whole-run bypass; the gate is not installed under it. */
  readonly globalBypass: boolean;
  /** Unattended approval mode: the gate auto-skips instead of interrupting. */
  readonly unattended: boolean;
  /** Tool-call ids the gate auto-skipped this turn; written by the gate, read by `reconcileUnattendedSkips`. */
  readonly unattendedSkips: Set<string>;
}

/** The engine this turn runs on and everything the stream and the settle read from it. */
export interface DeepAgentEngine {
  readonly graph: AgentGraph;
  readonly checkpointer: BaseCheckpointSaver;
  readonly langgraphConfig: Record<string, unknown>;
  /** The registry id the turn runs on (pricing and sub-agent inheritance key on it). */
  readonly modelName: string;
  readonly pricing: ModelPricing;
  readonly gate: DeepAgentGateState;
  readonly hasStructuredOutput: boolean;
}

/** What the graph is invoked with: a resume of the paused gate, or the turn's user message. */
export type DeepAgentGraphInput =
  | { readonly kind: "resume"; readonly command: Command }
  | { readonly kind: "message"; readonly input: Record<string, unknown> };

// ── Steps ───────────────────────────────────────────────────────────────────

/**
 * The registry id the turn runs on: what the execution asked for, as the
 * runtime already resolved it (`input.model.requested`, `"default"` when the
 * spec named none — the one reader of `spec.executionConfig.modelName`, which
 * the Cursor adapter reads too), or the registry's default for `"default"`.
 * The same reading the runtime's attachment phase made for the vision budget,
 * so the model that sees the images is the model that runs. (Until #1096 this
 * read the spec field beside the runtime's resolved copy.)
 */
export async function resolveModelName(input: TurnInput): Promise<string> {
  return input.model.requested === "default" ? await getDefaultModel() : input.model.requested;
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
    authToken: config.stigmerTokenRef,
    sqlitePath: config.checkpointerType === "sqlite" ? await ensureCheckpointDbPath(input.sessionId) : undefined,
  });
  sink.setupTiming.mark("create_checkpointer");
  return checkpointer;
}

/**
 * The workspace as the engine sees it, rooted at the runtime's primary tree
 * (the one root). The platform dir the shared provision ensured rides along so
 * the backend routes `.stigmer/…` reads to it.
 *
 * CAS capture: the single per-turn observer owns the
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
 * this span. A turn with no servers connects nothing: `MultiServerMCPClient`
 * refuses an empty config, which is what the orchestrator's MCP gate
 * (`mcp-gate.ts`) guarded against beside its channel-only reason; the
 * runtime resolves unconditionally, so the one remaining question is
 * "anything to connect?" (since #1096).
 */
export async function connectTools(input: TurnInput, sink: TurnSink): Promise<DeepAgentTools> {
  if (input.mcp.servers.length === 0) {
    return { connection: undefined, mcpTools: [], serverToolMap: new Map(), toolServerMap: new Map() };
  }
  await sink.reportProgress("Connecting tools…");
  const connection = await connectMcpServers([...input.mcp.servers]);
  const serverToolMap = new Map<string, readonly DynamicStructuredTool[]>();
  const toolServerMap = new Map<string, string>();
  for (const [serverName, serverTools] of Object.entries(connection.serverToolMap)) {
    serverToolMap.set(serverName, serverTools as DynamicStructuredTool[]);
    for (const t of serverTools) toolServerMap.set(t.name, serverName);
  }
  sink.setupTiming.mark("connect_mcp");
  sink.recordActivity();
  return { connection, mcpTools: connection.tools as DynamicStructuredTool[], serverToolMap, toolServerMap };
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
 * The system prompt over the runtime's resolved record: every input the
 * builder renders is read from `TurnInput` here, in one place, so the mapping
 * is a pure step a test can pin whole (`__tests__/prompt-goldens.test.ts`
 * calls exactly this) rather than a stretch of `buildEngine`. The one input
 * that is not on the record is the memoized memory selection, which the
 * caller awaits (the runtime stamps the report on the status the first time
 * it is pulled, before this turn's first persist).
 *
 * Nothing here reads the turn's message or payload: the system prompt is the
 * session's (`prompt-builder.ts` says why), so every mounted skill is
 * described and the turn's files ride its message (`composeTurnMessage`).
 * The approved plan's path is the one fact taken from the attachments, and
 * only on a build-from-plan turn, where the mode already changes the prompt.
 */
export function composeSystemPrompt(input: TurnInput, recalledMemories: RecalledMemoriesContent | undefined): string {
  const spec = input.execution.spec!;
  const execConfig = spec.executionConfig;
  const primaryDir = input.workspace.primaryDir;
  return buildEnhancedSystemPrompt({
    instructions: input.blueprint.instructions,
    provisionResults: input.workspace.provision.provisionResults,
    containerRoot: primaryDir,
    skillsPromptSection: renderSkillsSection(input.skills.root),
    // "" (nothing sendable) threads as undefined: the tool alone still serves
    // text sends inside a 24-hour window.
    channelTemplatesPromptSection: input.mcp.channelMessaging.length > 0
      ? formatChannelTemplatesSection(input.mcp.channelMessaging) || undefined
      : undefined,
    interactionMode: execConfig?.interactionMode,
    buildFromPlan: execConfig?.buildFromPlan,
    ...(execConfig?.buildFromPlan
      ? { approvedPlanPath: findApprovedPlanPath(input.attachments.results.map((f) => f.relativePath)) }
      : {}),
    contextBridge: input.standing.contextBridge,
    senderIdentity: input.standing.senderIdentity,
    sessionContext: input.standing.sessionContext,
    declaredPreferences: input.standing.declaredPreferences,
    recalledMemories,
  });
}

/**
 * The turn's user message over the runtime's resolved record: what the user
 * typed, with this turn's payload (its input files and referenced paths) and
 * the conversation catchup composed around it (`prompt-builder.ts`
 * `composeUserMessage`). The twin of `composeSystemPrompt` for the turn's
 * half, so the goldens pin this mapping and not a copy of it.
 */
export function composeTurnMessage(input: TurnInput): string {
  const spec = input.execution.spec!;
  return composeUserMessage({
    message: spec.message,
    conversationCatchup: input.standing.conversationCatchup,
    inputFiles: input.attachments.results,
    vision: visionPromptInfoOf(input.attachments),
    downloadUrlKind: input.artifactStorage?.downloadUrlKind,
    workspaceFileRefs: spec.workspaceFileRefs ?? [],
  });
}

/**
 * Build the engine: the model, the middleware stack with the gate, the
 * tools, the compiled sub-agents, the system prompt and `createDeepAgent`.
 *
 * The service tier and the thinking mode resolved ONCE by the runtime ride
 * every model this execution constructs — the primary AND the sub-agent
 * factory — so the provider account's default can never pick the price of
 * any turn (#361), and every graph thinks in its own model's form.
 * `max_tool_rounds` resolves to one recursion limit that feeds BOTH the hard
 * stop on the invoke config and the budget middleware's ~80% advisory, so
 * the warning and the enforcement can never disagree.
 *
 * Nothing in the middleware stack stops the run (since #1096):
 * the runtime's abort is the platform's one stop, and its TERMINATED arm the
 * one enforcement of `max_cost_usd`; the cost advisory warns the model at
 * ~80% of the cap the way the budget middleware warns at ~80% of the
 * recursion limit.
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
  const execConfig = input.execution.spec!.executionConfig;
  const primaryDir = input.workspace.primaryDir;

  // The model. Resolution to the provider API id happens inside
  // buildChatModel; modelName stays the registry id for pricing and
  // sub-agent inheritance. The credential is read from the ref at build,
  // once per turn: a LangChain client carries its headers for its life, so
  // this is the freshest a turn's model can be.
  //
  // What the request tells the provider about a model comes from the
  // model's native registry row, never from a model name or a library's
  // table, and is read here, the one place the execution's choices meet the
  // row. The same factory builds every sub-agent's model, so each graph
  // follows the row of the model it runs on:
  // - no temperature: current Anthropic models refuse one other than their
  //   default, and the Cursor harness sends none (stigmer/stigmer#1341);
  // - the row's output ceiling, where LangChain's per-model default falls to
  //   4096 on models its table does not know (stigmer/stigmer#1343), and
  //   streaming on every call because the SDK refuses a non-streaming
  //   request at that ceiling;
  // - the execution's thinking mode in the form the row declares
  //   (thinking-mode.ts toAnthropicThinking).
  // A model with no native row (an unreachable registry) keeps the library
  // defaults and sends no thinking parameter, as before.
  const buildModelFor = async (name: string) => {
    const profile = await getNativeRequestProfile(name);
    return (await buildChatModel({
      modelName: name,
      proxyEndpoint: config.proxyEndpoint ?? undefined,
      stigmerToken: config.stigmerTokenRef.current ?? undefined,
      headerScope: { executionId },
      serviceTier: input.model.serviceTier,
      temperature: null,
      maxTokens: profile?.maxOutputTokens,
      streaming: true,
      thinking: toAnthropicThinking(input.model.thinkingMode, profile?.thinking),
    })).model;
  };
  const model = await buildModelFor(modelName);
  // Whether this graph reasons natively, derived from the same mapping the
  // request carries: it decides the `think` tool and the structured-output
  // strategy below, so neither can disagree with the wire.
  const parentThinks = graphThinks(input.model.thinkingMode, (await getNativeRequestProfile(modelName))?.thinking);
  sink.setupTiming.mark("build_model");

  await ensurePricingLoaded();
  const pricing = getModelPricing(modelName);
  const isPlanMode = execConfig?.interactionMode === InteractionMode.PLAN;
  const shellEnv = isPlanMode
    ? undefined
    : buildShellEnv(
        shellRunValues(
          input.environment.envVars,
          blueprint.agent?.spec?.env,
          input.mcp.servers,
          input.workspace.provision.provisionResults,
        ),
      );
  // Plan mode's filesystem permission rules, hoisted once: the parent graph
  // and every sub-agent graph carry this single value (the write-deny half
  // of plan mode; the read boundary is structural, issue #754).
  const planModePermissions = isPlanMode ? buildPlanModePermissions() : undefined;

  // The approval gate config is the single source of truth for HITL gating,
  // built once and inherited verbatim by sub-agents. Null under the global
  // pre-arm, where the gate is inert. Capture mode: file edits flow (tracked
  // to the git diff, ignored into CAS on THIS gate); secret-like paths are
  // hard-blocked; shell/MCP stay gated. The CAS arm additionally
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
  const toolRoundLimit = resolveToolRoundLimit(execConfig?.maxToolRounds);
  const { middleware, costAdvisory } = buildMiddlewareStack({
    loopDetection: { historySize: 20, consecutiveThreshold: 7, totalThreshold: 20 },
    executionBudget: { maxToolRounds: toolRoundLimit, warningPct: 80 },
    toolTruncation: { maxChars: execConfig?.maxToolResultChars || 30_000 },
    costAdvisory: maxCostUsd > 0
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
  // `think` is a reasoning aid for a graph that does not reason natively;
  // a graph that thinks has no use for it.
  const graphTools = [
    ...tools.mcpTools,
    ...(parentThinks ? [] : [createThinkTool()]),
    createWebFetchTool({ posture: webFetchPosture }),
  ];

  await sink.reportProgress("Configuring sub-agents…");
  const compiledSubagents = await transformAndCompileSubagents({
    subAgents: blueprint.subAgents,
    parentMcpTools: tools.mcpTools,
    parentMcpServerToolMap: tools.serverToolMap,
    parentMcpUsages: blueprint.mergedMcpServerUsages,
    skills: input.skills.bySubAgent,
    workspaceBackend: workspace.backend,
    approvalGate: approvalGateConfig,
    // Capture is universal: every sub-agent gets a CAS-observing backend wired
    // to the SAME per-turn observer as the parent.
    casObserver: workspace.casObserver,
    parentModelName: modelName,
    parentThinks,
    thinkingMode: input.model.thinkingMode,
    webFetchPosture,
    costAdvisory: costAdvisory ?? undefined,
    modelFactory: buildModelFor,
    shellEnv,
    ...(planModePermissions ? { permissions: planModePermissions } : {}),
  });
  sink.setupTiming.mark("compile_subagents");
  sink.recordActivity();

  await sink.reportProgress("Creating agent…");
  // The runtime's memoized memory selection; it stamps the report on the
  // status the first time it is pulled, before this turn's first persist.
  const systemPrompt = composeSystemPrompt(input, await input.standing.selectRecalledMemories());

  // Structured output takes one of langchain's two strategies, chosen here
  // explicitly. A graph that thinks uses the provider strategy: Anthropic's
  // own JSON output (`output_config.format`), which forces no tool, because
  // forced tool use and thinking do not combine on every platform and
  // model. Its schema goes through the SDK's own transform (the one
  // @langchain/anthropic's withStructuredOutput applies): Anthropic accepts
  // only closed objects, and the runner's zod keeps them open. A graph that
  // does not think keeps the tool strategy, the raw zod, unchanged.
  const outputSchema = input.structuredOutputSchema;
  const responseFormat = outputSchema === undefined
    ? undefined
    : parentThinks
      ? providerStrategy({ schema: transformJSONSchema(outputSchema) as ObjectJsonSchema })
      : jsonSchemaToZod(outputSchema);

  // File capture point: the CAS-observing backend — git-tracked edits flow to
  // disk (the boundary's git diff is authoritative) and the shared observer
  // records the pre-turn bytes of every CAS-owned path. Gate-independent, so
  // it holds even under the global bypass. Platform content (skills, inputs,
  // the approved plan) is mounted over it read-only at `.stigmer/`
  // (`platform-route.ts`): the virtual-rooted backend refuses to follow the
  // workspace link out of the root.
  const fileBackend = await mountPlatformRoute(
    await createCasCaptureBackend({ rootDir: primaryDir, observer: workspace.casObserver, shellEnv }),
    { workspaceDir: primaryDir, platformDir: workspace.backend.platformDir },
  );
  const graph = await createDeepAgent({
    model,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    checkpointer: checkpointer as any,
    backend: fileBackend,
    systemPrompt,
    tools: graphTools,
    // The to-do list rides ahead of Stigmer's stack: deepagents stopped
    // installing it by default (1.12), and the product reads it. The
    // framework's own middleware with Stigmer's texts; parent only
    // (`todo-list.ts` says why for both).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    middleware: [createTodoListMiddleware(), ...middleware] as any,
    subagents: compiledSubagents ?? undefined,
    ...(responseFormat ? { responseFormat } : {}),
    ...(planModePermissions ? { permissions: planModePermissions } : {}),
  } as Parameters<typeof createDeepAgent>[0]);

  const langgraphConfig: Record<string, unknown> = {
    configurable: { thread_id: input.threadId },
    // max_tool_rounds is enforced by the execution budget middleware, round
    // by round; this is only its backstop against a graph that loops without
    // calling the model (`shared/tool-rounds.ts`). Unset = unlimited = none.
    ...(toolRoundLimit !== null ? { recursionLimit: backstopRecursionLimit(toolRoundLimit) } : {}),
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
 * anything else is the turn's user message — this turn's payload and the
 * conversation catchup framed before it (`composeTurnMessage`; in the USER
 * MESSAGE so it enters the checkpointer with the turn and the system prompt
 * stays the session's), the structured-output contract appended, and
 * the inline images FIRST as content blocks when the turn carries any (per
 * Anthropic's images-before-text guidance; a plain string otherwise).
 */
export async function composeGraphInput(input: TurnInput, engine: DeepAgentEngine): Promise<DeepAgentGraphInput> {
  const graphState: GraphStateSnapshot = await engine.graph.getState(engine.langgraphConfig);
  const resume = resolveResumeInput(input.approvalDecisions, graphState);
  if (resume.isResumeFromApproval) {
    return { kind: "resume", command: resume.graphInput };
  }

  let userMessage = composeTurnMessage(input);
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
