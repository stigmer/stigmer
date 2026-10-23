/**
 * The native deep-agent harness's setup — what the LangGraph engine needs
 * before it can run a turn, as small named steps over the runtime's resolved
 * `TurnInput`, each returning a typed slice (the Cursor adapter's
 * `turn-setup.ts` mold; never one long function).
 *
 * Everything harness-agnostic has already happened when these run: the
 * execution, session and blueprint are fetched, the workspace is provisioned
 * and locked, the MCP servers are resolved with the approval default's MCP
 * half and the agent's tool scope, the skills
 * are mounted per owner, the conversation's Files are mounted, the transcript is
 * seeded. What remains is this engine's own reading of that record: the
 * checkpointer; the deepagents backend and the CAS observer, rooted at the
 * tree the runtime locked; the MCP connection that turns resolved servers
 * into LangChain tools; the model; the middleware stack with the tool scope
 * and the approval gate over the runtime's default; the compiled
 * sub-agents, each under its own narrowed scope; the system
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
 * observer and the gate's path normalization are all rooted
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
import { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

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
import type { ApprovalGateConfig, PersonRefusal } from "../../middleware/approval-gate.js";
import { WEB_FETCH_TOOL_NAME, createWebFetchTool, resolveGuardPosture } from "../../tools/index.js";
import { executionFingerprintKey } from "../../shared/fingerprint-secret.js";
import { getModelPricing, ensureLoaded as ensurePricingLoaded, type ModelPricing } from "../../shared/model-pricing.js";
import { getDefaultModel, getNativeRequestProfile } from "../../shared/model-registry.js";
import { buildChatModel } from "../../shared/model-client.js";
import { recordModelWindow, windowLogLines } from "../../shared/model-window.js";
import { createCompactionMiddleware } from "../../middleware/compaction.js";
import { graphThinks, toAnthropicThinking } from "../../shared/thinking-mode.js";
import { buildMcpApprovalDefault, isUnattendedApprovalMode, type McpApprovalDefault } from "../../shared/approval-policy.js";
import type { McpToolListing } from "../../shared/mcp-tool-listing.js";
import { NATIVE_TOOL_COVERS } from "@stigmer/tool-vocabulary";
import {
  checkMainToolListResolution,
  checkToolListResolution,
  claudeToolsOf,
  type ToolScope,
  type TurnToolInventory,
} from "../../shared/tool-lists.js";
import type { ToolApprovalCategory } from "../../shared/tool-kind.js";
import { visionPromptInfoOf } from "../../shared/prompt-sections.js";
import { findApprovedPlanPath } from "../../shared/implement-plan-prompt.js";
import type { RecalledMemoriesContent } from "../../shared/recalled-memories.js";
import { toLangChainImageBlocks } from "../../shared/attachment-vision.js";
import { workspaceResourcesOf } from "../../shared/workspace/provisioner.js";
import { backstopRecursionLimit, resolveToolRoundLimit } from "../../shared/tool-rounds.js";
import { jsonSchemaToZod } from "../../shared/json-schema-to-zod.js";
import { skillContentReadCheck } from "../../shared/skill-mount.js";
import { CasCaptureObserver } from "./cas-capture-observer.js";
import { CasCaptureShellBackend, createCasCaptureBackend } from "./cas-capture-backend.js";
import { createShellTool } from "./shell-tool.js";
import { loadStreamingConfig } from "../../shared/streaming-scheduler.js";
import { admitsRoutedRead, mountPlatformRoute } from "./platform-route.js";
import { resolveResumeInput, type GraphStateSnapshot } from "./hitl.js";
import { RUN_STAMP_KEY, createRunStampMiddleware, stampedRunOf } from "./run-stamp.js";
import { createTurnInputMiddleware } from "./turn-input-middleware.js";
import { InputBarriers } from "./input-barrier.js";
import { resumedMessages, threadIsEmpty } from "./resumed-history.js";
import { buildEnhancedSystemPrompt, composeUserMessage, renderSkillsSection } from "./prompt-builder.js";
import { buildShellEnv, shellRunValues } from "../../shared/shell-env.js";
import { transformAndCompileSubagents, type SavedSubagentGraph, type SubagentScopeBase } from "./subagent-transformer.js";
import { pluginSubagentScope } from "../../shared/subagents.js";
import { ENGINE_TOOL } from "./engine-tools.js";
import { createTodoListMiddleware } from "./todo-list.js";
import { buildHookEvaluator } from "./hooks-setup.js";
import { declaredServerCount } from "../../shared/mcp-resolver.js";
import { ApprovalAction } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";

/**
 * The runner config this harness reads per turn, as a named slice
 * (`execute-cursor/turn-setup.ts` `CursorAdapterConfig` is the idiom): a
 * whole `Config` satisfies it, a test constructs these fields and nothing
 * else. Smaller than the orchestrator's reach — the synthesized attachments'
 * endpoints it read are the runtime's now (since #1096).
 */
export type DeepAgentAdapterConfig = Pick<
  Config,
  "checkpointerType" | "checkpointerProxyEndpoint" | "stigmerTokenRef" | "proxyEndpoint" | "mode" | "cursorStreamStallTimeoutMs" | "shellTimeoutMaxSeconds"
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
  /** The main agent's MCP tools: its servers' (the platform's own included), never a server only a subagent has. */
  readonly mcpTools: readonly DynamicStructuredTool[];
  /** Every connected server's tools, the subagents' servers included, by slug. */
  readonly serverToolMap: ReadonlyMap<string, readonly DynamicStructuredTool[]>;
  readonly toolServerMap: ReadonlyMap<string, string>;
}

/** The gate's posture for this turn, read once and shared by the builders, the reconciler and the sub-agents. */
export interface DeepAgentGateState {
  /** The approval default's MCP half: which MCP tools ask, and which servers a lease cleared. */
  readonly mcpDefault: McpApprovalDefault;
  readonly toolServerMap: ReadonlyMap<string, string>;
  readonly leasedCategories: ReadonlySet<ToolApprovalCategory>;
  /** Pre-armed spec.auto_approve_all — the one unscoped, whole-run bypass; the gate is not installed under it. */
  readonly globalBypass: boolean;
  /** Unattended approval mode: the gate auto-skips instead of interrupting. */
  readonly unattended: boolean;
  /** Tool-call ids the gate auto-skipped this turn, each with the hook whose ask it was (`null`: the default's); written by the gate, read by `reconcileUnattendedSkips`. */
  readonly unattendedSkips: Map<string, string | null>;
  /** The calls a person skipped or rejected among the decisions this turn resumes with. */
  readonly refusedByPerson?: ReadonlyMap<string, PersonRefusal>;
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
  /** The barriers the input middleware crosses before it takes a person's messages (`input-barrier.ts`). */
  readonly inputBarriers?: InputBarriers;
}

/**
 * What the graph is invoked with: a resume of the paused gate, a continued
 * turn's resume from its last saved step (`null` input), the turn's user
 * message, or nothing at all, when a continued turn's graph had already
 * finished (its final state settles the turn with no model call).
 */
export type DeepAgentGraphInput =
  | { readonly kind: "resume"; readonly command: Command }
  | { readonly kind: "continue" }
  | { readonly kind: "finished"; readonly values: Record<string, unknown> }
  | { readonly kind: "message"; readonly input: Record<string, unknown> };

// ── Steps ───────────────────────────────────────────────────────────────────

/**
 * The registry id the turn runs on: the model the turn's resolved settings
 * name, as the runtime already read it (`input.model.requested`, `"default"` when the
 * turn's resolved settings name none — the runtime is the one reader of
 * `status.runConfig.modelName`, and the Cursor adapter reads the same
 * value), or the registry's default for `"default"`.
 * The same reading the runtime's File phase made for the vision budget,
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
 * and each saved subagent's servers into LangChain tools, each server once
 * by slug: a server the main agent and a subagent both have is one
 * connection. The main agent binds only its own servers' tools
 * (`mcpTools`); a subagent's graph binds its own (`buildEngine`). The connect covers the whole fan-out — stdio servers
 * spawn npx/uvx subprocesses here, so on-demand package installs land in
 * this span. A turn with no servers connects nothing: `MultiServerMCPClient`
 * refuses an empty config, which is what the orchestrator's MCP gate
 * (`mcp-gate.ts`) guarded against beside its channel-only reason; the
 * runtime resolves unconditionally, so the one remaining question is
 * "anything to connect?" (since #1096).
 */
export async function connectTools(input: TurnInput, sink: TurnSink): Promise<DeepAgentTools> {
  const servers = new Map(input.mcp.servers.map((server) => [server.slug, server] as const));
  for (const subagent of input.subagents) {
    for (const server of subagent.servers) {
      if (!servers.has(server.slug)) servers.set(server.slug, server);
    }
  }
  if (servers.size === 0) {
    return { connection: undefined, mcpTools: [], serverToolMap: new Map(), toolServerMap: new Map() };
  }
  await sink.reportProgress("Connecting tools…");
  const connection = await connectMcpServers([...servers.values()]);
  const serverToolMap = new Map<string, readonly DynamicStructuredTool[]>();
  const toolServerMap = new Map<string, string>();
  for (const [serverName, serverTools] of Object.entries(connection.serverToolMap)) {
    serverToolMap.set(serverName, serverTools as DynamicStructuredTool[]);
    for (const t of serverTools) toolServerMap.set(t.name, serverName);
  }
  sink.setupTiming.mark("connect_mcp");
  sink.recordActivity();
  return { connection, mcpTools: toolsOf(serverToolMap, input.mcp.servers), serverToolMap, toolServerMap };
}

/** The connected tools of `servers`, in their order. */
export function toolsOf(
  serverToolMap: ReadonlyMap<string, readonly DynamicStructuredTool[]>,
  servers: readonly { readonly slug: string }[],
): DynamicStructuredTool[] {
  return servers.flatMap((server) => [...(serverToolMap.get(server.slug) ?? [])]);
}

/**
 * What the tools this engine loaded say of themselves: each plugin server's
 * tools whose own MCP annotation says `destructiveHint: true`
 * (`@langchain/mcp-adapters` keeps a loaded tool's annotations on its
 * `metadata`). The platform's own servers are never read: none of their
 * tools asks. Read live every turn, so a tool its maker marks destructive
 * asks first from the turn after the mark appears; a server that did not
 * connect has no tools to call, so none is left unread.
 */
export function listingOfLoadedTools(
  serverToolMap: ReadonlyMap<string, readonly DynamicStructuredTool[]>,
  platformServerSlugs: ReadonlySet<string>,
): McpToolListing {
  const listed: { server: string; tools: string[] }[] = [];
  const destructive: { server: string; tool: string }[] = [];
  for (const [server, tools] of serverToolMap) {
    if (platformServerSlugs.has(server)) continue;
    listed.push({ server, tools: tools.map((tool) => tool.name) });
    for (const tool of tools) {
      const annotations = (tool.metadata as { annotations?: { destructiveHint?: unknown } } | undefined)?.annotations;
      if (annotations?.destructiveHint === true) destructive.push({ server, tool: tool.name });
    }
  }
  return { listed, destructive, unlisted: [] };
}

/**
 * The gate's posture. Two distinct bypasses (`shared/approval-policy.ts`
 * `ActiveLeases`): the pre-armed spec.auto_approve_all is the one whole-run
 * global bypass; an interactive APPROVE_ALL grants a run-lifetime lease
 * scoped to that action's class. Server leases ride the runtime's approval
 * default, completed here with the marks of the tools this engine loaded;
 * built-in category leases are applied inside the gate. Both flow into
 * sub-agents via the shared gate config.
 */
export function readGateState(input: TurnInput, tools: DeepAgentTools): DeepAgentGateState {
  return {
    mcpDefault: buildMcpApprovalDefault(
      listingOfLoadedTools(tools.serverToolMap, input.mcp.platformServerSlugs),
      input.mcp.leases,
    ),
    toolServerMap: tools.toolServerMap,
    leasedCategories: input.mcp.leases.categories,
    globalBypass: input.mcp.leases.global,
    unattended: isUnattendedApprovalMode(input.execution),
    unattendedSkips: new Map<string, string | null>(),
    refusedByPerson: refusalsOf(input.approvalDecisions, input.approvalDenyMessages),
  };
}

/** The skip and reject decisions among a turn's resumed approvals, by tool-call id, each with the reason given. */
export function refusalsOf(
  decisions: ReadonlyMap<string, ApprovalAction>,
  denyMessages: ReadonlyMap<string, string> = new Map(),
): ReadonlyMap<string, PersonRefusal> {
  const refused = new Map<string, PersonRefusal>();
  for (const [id, action] of decisions) {
    const comment = denyMessages.get(id) ?? "";
    if (action === ApprovalAction.SKIP) refused.set(id, { action: "skip", comment });
    else if (action === ApprovalAction.REJECT) refused.set(id, { action: "reject", comment });
  }
  return refused;
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
 * The approved plan's path is the one fact taken from the message's files, and
 * only on a build-from-plan turn, where the mode already changes the prompt.
 */
export function composeSystemPrompt(input: TurnInput, recalledMemories: RecalledMemoriesContent | undefined): string {
  const spec = input.execution.spec!;
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
    interactionMode: spec.interactionMode,
    buildFromPlan: spec.buildFromPlan,
    ...(spec.buildFromPlan
      ? { approvedPlanPath: findApprovedPlanPath(input.files.message) }
      : {}),
    contextBridge: input.standing.contextBridge,
    senderIdentity: input.standing.senderIdentity,
    sessionContext: input.standing.sessionContext,
    declaredPreferences: input.standing.declaredPreferences,
    recalledMemories,
    appendSystemPrompt: input.appendSystemPrompt,
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
    inputFiles: input.files,
    vision: visionPromptInfoOf(input.files),
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
  // The bounds the turn runs with: the control plane's one resolution
  // (`status.run_config`), never the request's own settings. The mode is the
  // message's intent, on the spec.
  const runConfig = input.execution.status?.runConfig;
  const interactionMode = input.execution.spec!.interactionMode;
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
  //
  // Each model's context window is recorded on it for the summarizer
  // (`shared/model-window.ts`: the library on the first-party id, then the
  // row's `contextWindowTokens`), and said once per model in the turn's log.
  const windowLines = new Set<string>();
  const buildModelFor = async (name: string) => {
    const profile = await getNativeRequestProfile(name);
    const built = await buildChatModel({
      modelName: name,
      proxyEndpoint: config.proxyEndpoint ?? undefined,
      stigmerToken: config.stigmerTokenRef.current ?? undefined,
      headerScope: { executionId },
      serviceTier: input.model.serviceTier,
      temperature: null,
      maxTokens: profile?.maxOutputTokens,
      streaming: true,
      thinking: toAnthropicThinking(input.model.thinkingMode, profile?.thinking),
    });
    const windowFacts = { provider: built.provider, apiModelId: built.apiModelId, catalogTokens: profile?.contextWindowTokens };
    recordModelWindow(built.model, windowFacts);
    for (const line of windowLogLines(name, { model: built.model, ...windowFacts })) {
      if (windowLines.has(line)) continue;
      windowLines.add(line);
      console.log(line);
    }
    return built.model;
  };
  const model = await buildModelFor(modelName);
  // Whether this graph reasons natively, derived from the same mapping the
  // request carries: it decides the structured-output strategy below, so the
  // strategy cannot disagree with the wire.
  const parentThinks = graphThinks(input.model.thinkingMode, (await getNativeRequestProfile(modelName))?.thinking);
  sink.setupTiming.mark("build_model");

  await ensurePricingLoaded();
  const pricing = getModelPricing(modelName);
  const isPlanMode = interactionMode === InteractionMode.PLAN;
  const shellEnv = isPlanMode
    ? undefined
    : buildShellEnv(shellRunValues(input.values));
  // Plan mode's filesystem permission rules, hoisted once: the parent graph
  // and every sub-agent graph carry this single value (the write-deny half
  // of plan mode; the read boundary is structural, issue #754).
  const planModePermissions = isPlanMode ? buildPlanModePermissions() : undefined;

  // The agent's tool lists, checked against what this turn binds before
  // anything is built: a list that names nothing the turn has refuses the
  // turn (`classifyThrown`), as Claude Code refuses to launch such an agent.
  const toolScope = input.mcp.toolScope;
  checkTurnToolLists(input, tools, toolScope, shellEnv !== undefined);
  const scopeBase: SubagentScopeBase = {
    serverToolMap: tools.serverToolMap,
    platformServerSlugs: input.mcp.platformServerSlugs,
    admitsRoutedRead,
    readsSkillContent: skillContentReadCheck(workspace.backend.platformDir),
  };

  // The agent's hooks, run inside the gate before the default
  // (`hooks-setup.ts`); null when the agent has none. A hook that cannot run
  // as written refuses the turn here (`HookSetupError`).
  const hooks = await buildHookEvaluator(input, sink, tools, config.cursorStreamStallTimeoutMs);

  // The approval gate config is the single source of truth for HITL gating,
  // built once and inherited verbatim by sub-agents. Null under the global
  // pre-arm when the agent has no hooks, where the gate is inert; with hooks
  // it is installed there too and runs only them (`approval-gate.ts`).
  // Capture mode: file edits flow (tracked to the git diff, ignored into CAS
  // on THIS gate); secret-like paths are hard-blocked; shell/MCP stay gated.
  // The CAS arm additionally requires storage to persist its blobs. With the
  // turn's file review off, file edits flow uncaptured; the secret-like block
  // stays, keyed on the workspace's substrate.
  const captureMode = input.workspace.captureMode;
  const gateConfigFor = (evaluator: typeof hooks): ApprovalGateConfig | null => !gate.globalBypass || evaluator !== null
    ? {
        mcpDefault: gate.mcpDefault,
        leasedCategories: gate.leasedCategories,
        toolServerMap: gate.toolServerMap,
        fingerprintKey: executionFingerprintKey(executionId),
        executionId,
        fileCaptureMode: captureMode,
        fileReviewOff: !input.workspace.fileReview,
        fileCaptureSubstrate: input.workspace.captureSubstrate,
        isCapturablePath: workspace.isCapturablePath,
        captureIgnored: captureMode && !!artifactStorage,
        recordBlockedSecret: (rawPath: string) => workspace.casObserver.recordBlockedSecret(rawPath),
        // Pre-delete byte capture (issue #303): a flowing delete's before-bytes
        // are recorded by the gate at authorization time through the SAME
        // shared observer, so the boundary authors a restorable DELETE.
        captureDeleteBefore: (rawPath: string) => workspace.casObserver.recordBefore(rawPath),
        unattended: gate.unattended,
        unattendedSkips: gate.unattendedSkips,
        ...(gate.refusedByPerson !== undefined ? { refusedByPerson: gate.refusedByPerson } : {}),
        hooks: evaluator,
        globalBypass: gate.globalBypass,
      }
    : null;
  const approvalGateConfig = gateConfigFor(hooks);

  // Each saved subagent's graph: its own servers' tools, its own gate (the
  // conversation's hooks, then its own, `hooks-setup.ts`) and its own shell,
  // which holds its values and never the agent's. Plan mode gives no
  // subagent a shell, as it gives the parent none.
  const subagentGraphs: SavedSubagentGraph[] = [];
  for (const subagent of input.subagents) {
    const evaluator = await buildHookEvaluator(input, sink, tools, config.cursorStreamStallTimeoutMs, subagent);
    subagentGraphs.push({
      subagent,
      mcpTools: toolsOf(tools.serverToolMap, subagent.servers),
      approvalGate: gateConfigFor(evaluator),
      shellEnv: isPlanMode ? undefined : buildShellEnv(subagent.values),
    });
  }

  // File capture point: the CAS-observing backend — git-tracked edits flow to
  // disk (the boundary's git diff is authoritative) and the shared observer
  // records the pre-turn bytes of every CAS-owned path. Gate-independent, so
  // it holds even under the global bypass. Built before the stack, because a
  // shell-capable backend is what the runner's shell tool runs through
  // (`middleware/shell.ts`); plan mode's is filesystem-only and gets none.
  const workspaceBackend = await createCasCaptureBackend({ rootDir: primaryDir, observer: workspace.casObserver, shellEnv });
  const shellStreaming = { maxTimeoutSeconds: config.shellTimeoutMaxSeconds, floorMs: loadStreamingConfig().minIntervalMs };
  const shell = workspaceBackend instanceof CasCaptureShellBackend
    ? { tool: createShellTool({ backend: workspaceBackend, ...shellStreaming }) }
    : null;

  // Platform content (skills, inputs, the approved plan) is mounted over the
  // workspace backend read-only at `.stigmer/` (`platform-route.ts`): the
  // virtual-rooted backend refuses to follow the workspace link out of the
  // root. Mounted before the stack, whose truncation keeps a long tool
  // result whole through it, in the session's offload directory
  // (`middleware/tool-truncation.ts`).
  const fileBackend = await mountPlatformRoute(workspaceBackend, {
    workspaceDir: primaryDir,
    platformDir: workspace.backend.platformDir,
  });
  const maxToolResultChars = runConfig?.maxToolResultChars || 30_000;

  const maxCostUsd = runConfig?.maxCostUsd ?? 0;
  const toolRoundLimit = resolveToolRoundLimit(runConfig?.maxToolRounds);
  // The turn's stop and yield, taken inside the graph at its model calls
  // (`middleware/turn-boundary.ts`): the stream loop reads the graph's events
  // and lags behind it, so a stop the loop takes alone can land after steps
  // the session's log never received (stigmer#2469).
  const turnBoundary = { stopSignal: sink.stopSignal, yieldSignal: sink.yieldSignal };
  const { middleware, costAdvisory } = buildMiddlewareStack({
    turnBoundary,
    shell,
    loopDetection: { historySize: 20, consecutiveThreshold: 7, totalThreshold: 20 },
    executionBudget: { maxToolRounds: toolRoundLimit, warningPct: 80 },
    toolTruncation: { maxChars: maxToolResultChars, backend: fileBackend },
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
    toolScope: { ...scopeBase, scope: toolScope },
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
  // No tool stands in for reasoning: a graph reasons before it acts through
  // its thinking mode, which every native row supports (#1976).
  const graphTools = [...tools.mcpTools, createWebFetchTool({ posture: webFetchPosture })];

  await sink.reportProgress("Configuring sub-agents…");
  const compiledSubagents = await transformAndCompileSubagents({
    pluginAgents: blueprint.pluginAgents,
    subagents: subagentGraphs,
    parentMcpTools: tools.mcpTools,
    parentScope: toolScope,
    scopeBase,
    skills: input.skills.bySubAgent,
    workspaceBackend: workspace.backend,
    approvalGate: approvalGateConfig,
    // Capture is universal: every sub-agent gets a CAS-observing backend wired
    // to the SAME per-turn observer as the parent.
    casObserver: workspace.casObserver,
    parentModelName: modelName,
    toolServerMap: tools.toolServerMap,
    webFetchPosture,
    costAdvisory: costAdvisory ?? undefined,
    turnBoundary,
    toolTruncation: { maxChars: maxToolResultChars },
    modelFactory: buildModelFor,
    shellEnv,
    shellStreaming,
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

  const inputBarriers = new InputBarriers();
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
    // (`todo-list.ts` says why for both). The person's messages sent while
    // the turn works are the parent's alone too (`turn-input-middleware.ts`).
    // The summarizer replaces deepagents' own by name, here and in the
    // general-purpose sub-agent it builds (`middleware/compaction.ts`).
    middleware: [
      createCompactionMiddleware({ backend: fileBackend }),
      createTodoListMiddleware(),
      createRunStampMiddleware(),
      createTurnInputMiddleware({
        input: sink.input,
        stopped: () => sink.stopSignal.aborted || sink.yieldSignal.aborted,
        barriers: inputBarriers,
      }),
      ...middleware,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any,
    subagents: compiledSubagents ?? undefined,
    ...(responseFormat ? { responseFormat } : {}),
    ...(planModePermissions ? { permissions: planModePermissions } : {}),
  } as Parameters<typeof createDeepAgent>[0]);

  const langgraphConfig: Record<string, unknown> = {
    configurable: { thread_id: input.threadId },
    // Each step is saved before the next one starts (LangGraph's default
    // saves while the next step runs). A drained turn yields at its next
    // model call (`middleware/turn-boundary.ts`), and only a synchronous
    // save makes the step before that call durable by then, so the next
    // runner resumes after it instead of repeating it. One awaited put per
    // step.
    durability: "sync",
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
    mcp_server_count: declaredServerCount(input.mcp.servers),
    skill_count: blueprint.mergedSkillRefs.length,
    workspace_entry_count: workspaceResourcesOf(input.session.spec?.resources ?? []).length,
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
    inputBarriers,
  };
}

/**
 * The native built-ins a graph of this turn binds, by their engine names: the
 * filesystem tools and `task` on every graph, `execute` on a shell-capable
 * one, the parent's to-do list, and the runner's own `web_fetch`.
 */
function nativeBoundToolNames(options: { readonly shellCapable: boolean; readonly todos: boolean }): string[] {
  return [
    ENGINE_TOOL.ls,
    ENGINE_TOOL.readFile,
    ENGINE_TOOL.writeFile,
    ENGINE_TOOL.editFile,
    ENGINE_TOOL.glob,
    ENGINE_TOOL.grep,
    ENGINE_TOOL.task,
    ...(options.shellCapable ? [ENGINE_TOOL.execute] : []),
    ...(options.todos ? [ENGINE_TOOL.writeTodos] : []),
    WEB_FETCH_TOOL_NAME,
  ];
}

/**
 * What one graph of this turn has, for deciding whether a list entry names
 * anything: its native built-ins and the live tools of the servers it binds
 * (`boundServers`; every connected server when absent). The platform's own
 * servers are left out: no list can name them.
 */
export function turnToolInventory(
  boundNames: readonly string[],
  tools: DeepAgentTools,
  platformServerSlugs: ReadonlySet<string>,
  boundServers?: readonly { readonly slug: string }[],
): TurnToolInventory {
  const bound = boundServers === undefined ? undefined : new Set(boundServers.map((server) => server.slug));
  const servers = new Map<string, Set<string>>();
  for (const [slug, serverTools] of tools.serverToolMap) {
    if (platformServerSlugs.has(slug) || (bound !== undefined && !bound.has(slug))) continue;
    servers.set(slug, new Set(serverTools.map((t) => t.name)));
  }
  return {
    claudeTools: claudeToolsOf(boundNames, NATIVE_TOOL_COVERS),
    hasMcp: (server, tool) => {
      const names = servers.get(server);
      return names !== undefined && (tool === null || names.has(tool));
    },
    anyMcp: servers.size > 0,
  };
}

/**
 * Check the agent's lists (and the turn's over them) and each subagent's
 * against what its graph binds: an entry naming nothing is logged, and a
 * `tools` list that resolves to nothing throws `ToolListResolutionError`.
 * A subagent's graph binds no to-do list. Only a subagent the main agent's
 * `Agent(type, …)` admits is checked: one it keeps from compiling
 * (`transformAndCompileSubagents` applies the same filter) can never run, so
 * its lists cannot refuse the turn.
 *
 * A plugin subagent binds the parent's tools, and its lists are judged
 * against the agent's layers alone, the prefix of the main scope before the
 * turn's (`mainToolScope` puts the agent's first, and adds it only when it
 * carries a list): the agent's definition is what they are written against,
 * so a turn that narrows the agent, as an eval's read-only set does, never
 * refuses the turn over a plugin subagent that lists only write or shell
 * tools. The turn still narrows what it may use, since its graph runs
 * under the whole scope. A saved subagent binds its own servers, and its
 * own lists are judged against them alone, before the turn's cap.
 */
export function checkTurnToolLists(
  input: Pick<TurnInput, "mcp" | "blueprint" | "subagents">,
  tools: DeepAgentTools,
  parentScope: ToolScope,
  shellCapable: boolean,
): void {
  const log = (line: string): void => console.warn(`[turn-setup] ${line}`);
  const { platformServerSlugs } = input.mcp;
  const parentNames = nativeBoundToolNames({ shellCapable, todos: true });
  checkMainToolListResolution(parentScope, turnToolInventory(parentNames, tools, platformServerSlugs, input.mcp.servers), log);
  const subagentNames = nativeBoundToolNames({ shellCapable, todos: false });
  const pluginAgentInventory = turnToolInventory(subagentNames, tools, platformServerSlugs, input.mcp.servers);
  const agentSpec = input.blueprint.agent?.spec;
  const agentHasLists = agentSpec !== undefined && (agentSpec.tools.length > 0 || agentSpec.disallowedTools.length > 0);
  const agentScope = parentScope.upTo(agentHasLists ? 1 : 0);
  for (const agent of input.blueprint.pluginAgents) {
    const hasLists = agent.tools.length > 0 || agent.disallowedTools.length > 0;
    if (!hasLists || !parentScope.allowsSubAgentType(agent.name)) continue;
    checkToolListResolution(pluginSubagentScope(agentScope, agent).upTo(agentScope.depth + 1), pluginAgentInventory, log);
  }
  for (const subagent of input.subagents) {
    if (!subagent.bringsOwn.lists || !parentScope.allowsSubAgentType(subagent.name)) continue;
    checkToolListResolution(subagent.toolScope.upTo(1), turnToolInventory(subagentNames, tools, platformServerSlugs, subagent.servers), log);
  }
}

/**
 * What the graph is invoked with. The checkpoint is read once (on the
 * durable http saver an extra `getState` is a network round-trip): pending
 * interrupts that the runtime's decisions answer make a `Command(resume)`;
 * a run whose input the thread already took (`run-stamp.ts`) resumes from
 * its last saved step (`continue`), or, when that save finished the graph,
 * runs nothing (`finished`): the engine is never handed the task again
 * (stigmer#2417). The thread's stamp decides, not `TurnInput.continuation`:
 * the stamp is saved with the input, while the runtime learns of a run only
 * from what reached the session's log, so a runner lost after the engine
 * took the input but before its first write landed is still a continuation
 * here; anything else is the turn's user message, stamped with its run — this turn's payload and the
 * conversation catchup framed before it (`composeTurnMessage`; in the USER
 * MESSAGE so it enters the checkpointer with the turn and the system prompt
 * stays the session's), the structured-output contract appended, and
 * the inline images FIRST as content blocks when the turn carries any (per
 * Anthropic's images-before-text guidance; a plain string otherwise). A
 * eval-run try's recorded conversation goes ahead of that message when
 * the thread holds none yet (`resumed-history.ts`).
 */
export async function composeGraphInput(input: TurnInput, engine: DeepAgentEngine): Promise<DeepAgentGraphInput> {
  const graphState: GraphStateSnapshot = await engine.graph.getState(engine.langgraphConfig);
  const resume = resolveResumeInput(input.approvalDecisions, graphState, input.approvalDenyMessages);
  if (resume.isResumeFromApproval) {
    return { kind: "resume", command: resume.graphInput };
  }
  if (stampedRunOf(graphState.values) === input.executionId) {
    return graphState.next.length > 0 ? { kind: "continue" } : { kind: "finished", values: graphState.values };
  }

  let userMessage = composeTurnMessage(input);
  if (engine.hasStructuredOutput) {
    userMessage += `\n\n---\nIMPORTANT: When your analysis is complete, provide your findings as structured output matching the required schema. The system will capture your structured response automatically.`;
  }
  const { visionImages } = input.files;
  const history = input.resumedHistory !== undefined && threadIsEmpty(graphState.values) ? resumedMessages(input.resumedHistory) : [];
  return {
    kind: "message",
    input: {
      [RUN_STAMP_KEY]: input.executionId,
      messages: [
        ...history,
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
