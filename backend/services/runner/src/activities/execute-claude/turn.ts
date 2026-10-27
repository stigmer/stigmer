/**
 * One Claude engine turn — the Agent SDK slice of the harness, behind the
 * turn runtime's contract (`harness/types.ts`). `adapter.ts` loads this
 * module with a dynamic import inside `boot`, since this is where the SDK's
 * types and the MCP SDK enter the adapter's graph.
 *
 * One engine process per invocation: `query()` starts it, the held prompt
 * stream ends it once the turn's last result is in (`prompt-stream.ts`), and
 * nothing is parked between invocations. What an invocation does, in order:
 *
 *  1. Refuse what this harness does not run yet, before anything starts:
 *     the fast tier, a model that is not Claude. Each refusal is
 *     `actionable`, with the sentence that says how; so is a turn whose
 *     skills cannot be named apart (`skill-plugins.ts`), or whose hooks
 *     cannot run as written (`hooks.ts`).
 *  2. Decide the turn's agents, the main one and every sub-agent it may
 *     start (`agents.ts`); connect their MCP servers in the host, once each
 *     (`mcp-bridge.ts`); decide what each is offered (`engine-options.ts`);
 *     build every caller's hooks (`hooks.ts`) and the gate over every
 *     caller's reach (`gate.ts`); serve the host's tools to the engine
 *     (`loopback-mcp.ts`); write the turn's skills as plugins in the
 *     engine's home (`skill-plugins.ts`).
 *  3. Read the session's transcript from the store (`session-store.ts`,
 *     `transcript-facts.ts`): a new run hands the engine its message; a run
 *     the engine already took is continued without the task (stigmer#2417),
 *     with the messages sent while it worked that it never read, or a short
 *     note to go on; a run whose engine had already finished settles with no
 *     model call. A run whose call waits on a person's answer (its WAITING
 *     row, `sink.rows`) resumes with no prompt at all: the engine re-runs
 *     that call first, the gate answering it from the person's decision
 *     (`gate.ts`), and nothing a person sent meanwhile is taken before its
 *     result. A call the transcript left pending that this run never
 *     proposed is refused when the engine reaches it: from an earlier,
 *     stopped run as a call nobody answered, from this run (a yield crossed
 *     its deferral) as one to ask for again alone.
 *  4. Run the engine to its result, folding each message into the
 *     transcript (`translator.ts`), reporting each model call's usage
 *     (`usage.ts`), persisting on the shared cadence, and taking every
 *     message a person sends while it works into the open prompt, where the
 *     engine reads it before its next model call. Before it may end, the
 *     turn claims once more; a message the engine has not read keeps it
 *     going one more round. A result that names a deferred call
 *     (`deferred_tool_use`, never `terminal_reason`: the engine defers
 *     again with no reason set, measured on SDK 0.3.310) ends the
 *     invocation instead, taking nothing: the turn proposes that call's
 *     WAITING row from the gate's pause verdict, with no arguments, so the
 *     row, the card and the session's log keep the model's own call.
 *  5. Settle (`settle.ts`).
 *
 * Stop: the runtime's stop interrupts the engine at once, and aborts it
 * after a grace if it does not end; the host's shell stops its command
 * group with the same signal. Yield: the engine is interrupted at the first
 * moment no tool call is open, and the gate refuses any call reached after
 * either signal, so nothing runs past the boundary. Both settle
 * `interrupted`.
 *
 * Never throws: a thrown engine or SDK error is `failed` on the `internal`
 * surface with the shared model-error wording. Imports nothing from
 * `@temporalio/*` (`__tests__/adapter-is-temporal-free.test.ts`).
 */

import { mkdir, rm } from "node:fs/promises";
import type { McpServerConfig, Query, SDKResultMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { JsonObject } from "@bufbuild/protobuf";
import { InteractionMode, ServiceTier } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import type { Config } from "../../config.js";
import type { TurnInputChannel } from "../../harness/turn-input.js";
import type { TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { ToolCallStatus } from "../../gen/turn/ai/stigmer/runner/turn/v1/enum_pb.js";
import { CasCaptureObserver } from "../../shared/filereview/cas-capture-observer.js";
import { HookSetupError } from "../../shared/hooks/setup.js";
import { buildMcpApprovalDefault } from "../../shared/approval-policy.js";
import { skillContentReadCheck } from "../../shared/skill-mount.js";
import { platformReadRoot } from "../../shared/workspace/stigmer-link.js";
import { toAnthropicImageBlocks } from "../../shared/attachment-vision.js";
import { emitTimingLog } from "../../shared/cold-start-timing.js";
import { getExecutionContext } from "../../shared/execution-context.js";
import { isPathCapturable } from "../../shared/filereview/git-substrate.js";
import { declaredServerCount } from "../../shared/mcp-resolver.js";
import { describeExecutionError } from "../../shared/model-error.js";
import { modelLaneUrl, modelLanes } from "../../shared/model-lanes.js";
import { ensureLoaded as ensurePricingLoaded, getModelPricing } from "../../shared/model-pricing.js";
import { getDefaultModel, getRequestProfile, resolveToApiModelId, type ThinkingProfile } from "../../shared/model-registry.js";
import { shouldPersistStreamingStatus } from "../../shared/persist-decision.js";
import { readRootInstructionsWith, renderRepositoryInstructions } from "../../shared/repository-instructions.js";
import { buildShellEnv } from "../../shared/shell-env.js";
import { StreamingUpdateScheduler, loadStreamingConfig } from "../../shared/streaming-scheduler.js";
import { getClaudeInvocationDir, getClaudeTranscriptDir, getPlatformDir } from "../../shared/workspace/platform-dir.js";
import { agentDefinitionsOf, bridgeServersOf, checkAgentToolLists, subagentSpecsOf, turnAgentsOf, type SubagentSpec, type TurnAgents } from "./agents.js";
import { engineEnvironment } from "./engine-env.js";
import { engineOptions, thinkingOf, userMessageOf } from "./engine-options.js";
import { engineSessionIdOf, runMessageIdOf, sentMessageIdOf } from "./engine-session-id.js";
import { FileTranscripts } from "./file-store.js";
import { ClaudeGate, canUseToolOf, gateFactsOf, gateHooks, type Caller, type GateVerdict, type WaitingCall } from "./gate.js";
import { HookFeedback, turnHookEvaluators } from "./hooks.js";
import { hostShellServer, HOST_SHELL_TOOL, isHostShell } from "./host-shell.js";
import { HttpTranscripts } from "./http-store.js";
import { startLoopbackMcp, type ServedServer } from "./loopback-mcp.js";
import { connectBridge, type McpBridge } from "./mcp-bridge.js";
import { composeSubagentPrompt, composeSystemAppend, composeTurnMessage, instructionRoots, skillsSection, workspaceInstructionReader } from "./prompt.js";
import { PromptStream } from "./prompt-stream.js";
import { MidTurnInput, sentMessageOf } from "./mid-turn-input.js";
import { MemoryTranscripts, sessionStoreFor, type TranscriptBacking } from "./session-store.js";
import { settleClaudeTurn, type InvocationEnd } from "./settle.js";
import { SkillNameClash, writeSkillPlugins } from "./skill-plugins.js";
import { transcriptFactsOf, type TranscriptFacts } from "./transcript-facts.js";
import { ClaudeTranslator } from "./translator.js";
import { ClaudeUsage } from "./usage.js";

/** The SDK, as `boot` loaded it. */
export type ClaudeSdk = typeof import("@anthropic-ai/claude-agent-sdk");

/** The runner config this harness reads per turn; a whole `Config` satisfies it. */
export type ClaudeAdapterConfig = Pick<
  Config,
  "checkpointerType" | "checkpointerProxyEndpoint" | "stigmerTokenRef" | "proxyEndpoint" | "shellTimeoutMaxSeconds" | "mode" | "cursorStreamStallTimeoutMs"
>;

/** How long a stopped engine has to end on its own before its process is aborted. */
export const STOP_GRACE_MS = 5_000;

/** What a continued turn is told when there is nothing new to read: never the task again. */
export const CONTINUE_NOTE = "Continue where you left off.";

/** The bound on a stderr line kept in the runner's log. */
const STDERR_LINE_CHARS = 2_000;

/** A turn this harness refuses before it starts, with the sentence that says how. */
class Refusal extends Error {}

export async function runClaudeTurn(input: TurnInput, sink: TurnSink, config: ClaudeAdapterConfig, sdk: ClaudeSdk): Promise<TurnOutcome> {
  if (sink.stopSignal.aborted || sink.yieldSignal.aborted) return { kind: "interrupted" };
  let bridge: McpBridge | undefined;
  const home = getClaudeInvocationDir(input.sessionId, input.executionId, input.turnSeq);
  const observer = captureObserverOf(input);
  // What the gate observes before a file tool writes where git cannot (`gate.ts`).
  sink.bindCasObservations(() => observer.snapshot());
  try {
    refuseUnsupported(input);
    const model = await resolveModel(input);
    const specs = await subagentSpecsOf(input);
    bridge = await connectTools(input, sink, specs);
    return await engineTurn(input, sink, config, sdk, { model, bridge, home, specs, observer });
  } catch (err) {
    if (err instanceof Refusal || err instanceof SkillNameClash || err instanceof HookSetupError) {
      console.warn(`ExecuteClaude refused the turn: execution=${input.executionId}, ${err.message}`);
      return { kind: "failed", surface: "actionable", message: err.message, cause: err };
    }
    const { errorType, errorMessage } = describeExecutionError(err, { proxyMode: config.proxyEndpoint !== null });
    console.error(`ExecuteClaude failed: execution=${input.executionId}, [${errorType}] ${errorMessage}`);
    return { kind: "failed", surface: "internal", message: `[${errorType}] ${errorMessage}`, cause: err };
  } finally {
    await closeQuietly(input.executionId, "MCP connections", () => bridge?.close());
    await closeQuietly(input.executionId, "engine directory", () => rm(home, { recursive: true, force: true }));
  }
}

/** The turn's capture observer: an ignored path's before-bytes in a git workspace, every path's in one with no git (the native engine's rule). */
function captureObserverOf(input: TurnInput): CasCaptureObserver {
  const { primaryDir, gitWorkspace } = input.workspace;
  return new CasCaptureObserver({
    rootDir: primaryDir,
    isIgnored: gitWorkspace ? async (relPath) => !(await isPathCapturable(primaryDir, relPath)) : async () => true,
  });
}

/** Step 1 of the header. */
function refuseUnsupported(input: TurnInput): void {
  if (input.model.serviceTier === ServiceTier.FAST) throw new Refusal("Claude does not offer the fast tier yet. Run this turn on the standard tier.");
}

/** The model the turn runs on: its registry id, priced by, and the provider's id, sent. */
interface TurnModel {
  readonly registryId: string;
  readonly apiId: string;
  /** The thinking form the model's Claude row declares; undefined when no Claude row lists it. */
  readonly thinking: ThinkingProfile | undefined;
}

async function resolveModel(input: TurnInput): Promise<TurnModel> {
  const registryId = input.model.requested === "default" ? await getDefaultModel("claude") : input.model.requested;
  const apiId = await resolveToApiModelId(registryId);
  if (!apiId.startsWith("claude")) throw new Refusal(`Claude runs Claude models only, and "${registryId}" is not one. Choose a Claude model for this agent.`);
  return { registryId, apiId, thinking: (await getRequestProfile(registryId, "claude"))?.thinking };
}

async function connectTools(input: TurnInput, sink: TurnSink, specs: readonly SubagentSpec[]): Promise<McpBridge> {
  const { servers, inScope } = bridgeServersOf(input, specs);
  if (servers.length > 0) await sink.reportProgress("Connecting tools…");
  const bridge = await connectBridge(servers, inScope, input.mcp.platformServerSlugs);
  sink.setupTiming.mark("connect_mcp");
  sink.recordActivity();
  return bridge;
}

/** The backing the session's conversation is kept in, by the setting that places native's state (`session-store.ts`). */
const BACKINGS: Record<ClaudeAdapterConfig["checkpointerType"], (config: ClaudeAdapterConfig, sessionId: string) => TranscriptBacking> = {
  http: (config) => {
    if (config.checkpointerProxyEndpoint === null) throw new Error("the http checkpointer has no proxy endpoint on this runner");
    return new HttpTranscripts(config.checkpointerProxyEndpoint, config.stigmerTokenRef);
  },
  sqlite: (_config, sessionId) => new FileTranscripts(getClaudeTranscriptDir(sessionId)),
  memory: () => new MemoryTranscripts(),
};

function backingFor(config: ClaudeAdapterConfig, sessionId: string): TranscriptBacking {
  return BACKINGS[config.checkpointerType](config, sessionId);
}

/** What the engine is handed first, by the transcript's facts (step 3 of the header). */
type Opening =
  | { readonly kind: "finished" }
  | { readonly kind: "run"; readonly messages: readonly SDKUserMessage[] }
  | { readonly kind: "resume"; readonly call: string };

/** The transcript's pending call, by who left it (step 3 of the header). */
interface PendingCall {
  /** The call waits on a person's answer: this run proposed it. */
  readonly answered: string | undefined;
  /** An earlier, stopped run left it, and nobody answered it. */
  readonly staleCallId: string | undefined;
  /** This run left it pending without proposing it. */
  readonly unproposedCallId: string | undefined;
}

/** Who left the transcript's pending call: this run's WAITING row, an earlier run, or this run unproposed. */
function pendingCallOf(input: TurnInput, facts: TranscriptFacts, waiting: ReadonlyMap<string, WaitingCall>): PendingCall {
  const id = facts.pendingCall;
  const none: PendingCall = { answered: undefined, staleCallId: undefined, unproposedCallId: undefined };
  if (id === undefined) return none;
  if (!facts.taken.has(runMessageIdOf(input.executionId))) return { ...none, staleCallId: id };
  return waiting.has(id) ? { ...none, answered: id } : { ...none, unproposedCallId: id };
}

/** The main agent's rows still WAITING for a person, by call id, with the tool and arguments the session's log holds for each. */
function waitingRowsOf(sink: TurnSink): Map<string, WaitingCall> {
  const waiting = new Map<string, WaitingCall>();
  for (const message of sink.rows.messages) {
    for (const row of message.toolCalls) {
      if (row.status === ToolCallStatus.TOOL_CALL_WAITING_APPROVAL) waiting.set(row.id, { name: row.name, mcpServerSlug: row.mcpServerSlug, args: (row.args ?? {}) as JsonObject });
    }
  }
  return waiting;
}

async function openingOf(input: TurnInput, channel: TurnInputChannel, facts: TranscriptFacts, pending: PendingCall): Promise<Opening> {
  const runId = runMessageIdOf(input.executionId);
  if (pending.answered !== undefined) return { kind: "resume", call: pending.answered };
  if (!facts.taken.has(runId)) {
    return { kind: "run", messages: [userMessageOf(firstMessageContent(input), runId)] };
  }
  // A continued turn: the messages this run took that the engine never read.
  if (facts.finished) await channel.claim({ force: true });
  const owed = (await channel.claimed(new Set())).filter((message) => !facts.taken.has(sentMessageIdOf(message.id)));
  if (owed.length > 0) return { kind: "run", messages: owed.map(sentMessageOf) };
  if (facts.finished) return { kind: "finished" };
  return { kind: "run", messages: [userMessageOf(CONTINUE_NOTE, runMessageIdOf(`${input.executionId}:${input.turnSeq}`))] };
}

/** The run's own message: its images first, as content blocks, then its text (`prompt.ts`). */
function firstMessageContent(input: TurnInput): SDKUserMessage["message"]["content"] {
  const text = composeTurnMessage(input);
  const images = input.files.visionImages;
  return images.length === 0 ? text : [...toAnthropicImageBlocks(images), { type: "text", text }];
}

interface EngineTurnDeps {
  readonly model: TurnModel;
  readonly bridge: McpBridge;
  readonly home: string;
  readonly specs: readonly SubagentSpec[];
  readonly observer: CasCaptureObserver;
}

async function engineTurn(input: TurnInput, sink: TurnSink, config: ClaudeAdapterConfig, sdk: ClaudeSdk, deps: EngineTurnDeps): Promise<TurnOutcome> {
  const { bridge, model, home } = deps;
  const { workspace } = input;
  const turnKey = getExecutionContext().getStore()?.turnKey;
  if (turnKey === undefined) throw new Error("the Claude engine runs only in the agent host, which holds the turn's key");
  const laneEndpoint = config.proxyEndpoint ?? modelLanes()?.endpoint;
  if (laneEndpoint === undefined) throw new Error("the agent host has no model lane to send the Claude engine's calls through");

  // The agents, each one's tools, the lists checked against what binds, and the gate over every caller.
  const planMode = input.execution.spec!.interactionMode === InteractionMode.PLAN;
  const agents = turnAgentsOf(input, deps.specs, bridge, { planMode, structuredOutput: input.structuredOutputSchema !== undefined });
  checkAgentToolLists(input, agents, bridge, { planMode });
  const hooks = await turnHookEvaluators(input, sink, config.cursorStreamStallTimeoutMs);

  // The conversation so far, and the call it left pending.
  const backing = backingFor(config, input.sessionId);
  const facts = transcriptFactsOf(await backing.load(input.threadId, undefined));
  const waiting = waitingRowsOf(sink);
  const pending = pendingCallOf(input, facts, waiting);

  let halted = false;
  const platformDir = getPlatformDir(input.sessionId);
  const isCapturable = (path: string): Promise<boolean> => (workspace.gitWorkspace ? isPathCapturable(workspace.primaryDir, path.replace(/^\/+/, "")) : Promise.resolve(false));
  const gate = new ClaudeGate(
    gateFactsOf(input, {
      agents: { root: agents.root.reach, subagents: new Map([...agents.subagents].map(([name, world]) => [name, world.reach])) },
      bridge: { serverOf: bridge.serverOf, mcpDefault: buildMcpApprovalDefault(bridge.listing, input.mcp.leases) },
      paths: { platformDir, engineHome: home, readsSkillContent: skillContentReadCheck(platformDir), platformReadRoot: await platformReadRoot(workspace.primaryDir, platformDir) },
      isCapturablePath: isCapturable,
      hooks,
      waitingCallOf: (id) => waiting.get(id),
      pending,
      observer: deps.observer,
    }),
    () => halted,
  );
  const feedback = new HookFeedback({ hooks, verdictOf: (id) => gate.verdictOf(id), serverOf: bridge.serverOf });
  sink.setupTiming.mark("build_gate");

  // What the engine is handed first.
  const opening = await openingOf(input, sink.input, facts, pending);
  if (opening.kind === "finished") {
    console.log(`[claude-turn] execution=${input.executionId} continued a run its engine had finished; settling with no model call`);
    return { kind: "completed" };
  }

  // The prompt's append, with the repository's own instructions, and each sub-agent's prompt.
  const maxChars = input.execution.status?.runConfig?.maxToolResultChars || 30_000;
  const roots = instructionRoots(workspace.primaryDir, workspace.provision.provisionResults.map((result) => result.rootDir));
  const instructions = await readRootInstructionsWith(workspaceInstructionReader(workspace.primaryDir), roots, maxChars);
  const repositoryInstructionsSection = renderRepositoryInstructions(instructions);
  const turnSkillCount = agents.skills.length;
  const systemAppend = composeSystemAppend(input, await input.standing.selectRecalledMemories(), repositoryInstructionsSection, skillsSection(agents.root.skills, turnSkillCount));
  const definitions = await agentDefinitionsOf(agents, (world) =>
    composeSubagentPrompt(world, { turnSkillCount, planMode, repositoryInstructionsSection, primaryDir: workspace.primaryDir }),
  );

  // The engine's servers: the host's shell and the bridged ones, served by the host, each call admitted by the gate.
  const abort = new AbortController();
  const served: ServedServer[] = [];
  if (agents.shell) {
    served.push(hostShellServer({
      cwd: workspace.primaryDir,
      envFor: (caller) => buildShellEnv(shellValuesOf(agents, caller)),
      maxTimeoutSeconds: config.shellTimeoutMaxSeconds,
      gate,
      stopSignal: sink.stopSignal,
      onOutput: (callId, delta) => sink.transcript.apply({ kind: "tool_output_delta", callId, delta }),
      onActivity: (detail) => sink.recordActivity(detail),
    }));
  }
  served.push(...bridge.servers.values());
  const endpoint = served.length > 0 ? await startLoopbackMcp(served, (call) => gate.admit(call)) : undefined;
  try {
    // The prompt the engine reads, and the messages sent while it works
    // (`mid-turn-input.ts`), taken only once the gate decided every open call and none waits.
    const stream = new PromptStream();
    const openCalls = new Set<string>();
    const midTurn = new MidTurnInput(sink, stream, () => [...openCalls].every((id) => {
      const verdict = gate.verdictOf(id);
      return verdict !== undefined && verdict.kind !== "pause";
    }));
    if (opening.kind === "resume") midTurn.holdUntilResultOf(opening.call);
    else for (const message of opening.messages) stream.push(message);

    // A runner lost mid-turn never reaches the `finally` that removes the
    // home, and the retried invocation's home is the same path: the engine
    // would find its own local copy of the session there and refuse to start
    // it (stigmer#2613). The home holds nothing durable; the store does.
    await rm(home, { recursive: true, force: true });
    await mkdir(home, { recursive: true });
    const plugins = await writeSkillPlugins(home, agents.skills);
    const sessionId = engineSessionIdOf(input.threadId);
    const options = engineOptions({
      cwd: workspace.primaryDir,
      additionalDirectories: workspace.dirs.filter((dir) => dir !== workspace.primaryDir),
      env: engineEnvironment({
        home,
        anthropicBaseUrl: modelLaneUrl({ endpoint: laneEndpoint.replace(/\/+$/, ""), token: "" }, "anthropic"),
        turnKey,
        projectKey: sessionId,
        path: process.env.PATH ?? "/usr/bin:/bin",
      }),
      tools: agents.sessionTools,
      mcpServers: { ...endpoint?.configs },
      plugins,
      skills: agents.skills.map((skill) => skill.id),
      agents: definitions,
      systemAppend,
      model: model.apiId,
      thinking: thinkingOf(input.model.thinkingMode, model.thinking),
      hooks: { ...gateHooks(gate), ...feedback.callbacks() },
      canUseTool: canUseToolOf(gate),
      sessionStore: sessionStoreFor(input.threadId, backing),
      session: facts.exists ? { resume: sessionId } : { start: sessionId },
      abortController: abort,
      structuredOutputSchema: input.structuredOutputSchema,
      stderr: (data) => console.warn(`[claude-engine] execution=${input.executionId} ${data.trimEnd().slice(0, STDERR_LINE_CHARS)}`),
    });

    await ensurePricingLoaded();
    emitTimingLog("execution_setup", {
      execution_id: input.executionId,
      session_id: input.sessionId,
      harness: "claude",
      mcp_server_count: declaredServerCount(input.mcp.servers),
      skill_count: agents.skills.length,
      workspace_entry_count: workspace.provision.provisionResults.length,
    }, sink.setupTiming);

    const end = await runEngine(input, sink, sdk, {
      expected: { skills: agents.skills.map((skill) => skill.id), agents: Object.keys(definitions) },
      stream,
      midTurn,
      openCalls,
      onDecided: (listener) => gate.onDecided(listener),
      options,
      abort,
      translator: new ClaudeTranslator({ serverOf: bridge.serverOf, verdictOf: (id) => gate.verdictOf(id), feedbackOf: (id) => feedback.sectionOf(id) }),
      usage: new ClaudeUsage(getModelPricing(model.registryId), model.registryId),
      halt: () => {
        halted = true;
      },
      unattendedSkips: gate.unattendedSkips,
      propose: (callId) => proposeDeferred(sink, gate, bridge, callId),
    });
    return settleClaudeTurn(sink, end);
  } finally {
    await closeQuietly(input.executionId, "the tools' endpoint", () => endpoint?.close());
  }
}

/**
 * The WAITING row of the call the engine deferred, from the gate's pause
 * verdict (step 4 of the header): its provenance and asking hook, then the
 * proposal, with no arguments, so the row keeps the model's own call as
 * the session's log holds it.
 */
export function proposeDeferred(
  sink: Pick<TurnSink, "transcript">,
  gate: Pick<ClaudeGate, "verdictOf">,
  bridge: Pick<McpBridge, "serverOf">,
  callId: string,
): void {
  const verdict = gate.verdictOf(callId);
  if (verdict?.kind !== "pause") throw new Error(`the engine deferred call ${callId}, which the gate did not hold for a person`);
  const server = isHostShell(verdict.toolName) ? undefined : bridge.serverOf(verdict.toolName);
  const name = isHostShell(verdict.toolName) ? HOST_SHELL_TOOL.engineName : (server?.tool ?? verdict.toolName);
  const mcpServerSlug = server?.slug ?? "";
  const hook = verdict.hook === undefined ? {} : { policyHook: verdict.hook };
  if (verdict.source !== undefined) sink.transcript.apply({ kind: "tool_policy", callId, provenance: verdict.source, policyHook: verdict.hook ?? "" });
  sink.transcript.apply({
    kind: "approval_proposed",
    callId,
    name,
    mcpServerSlug,
    message: verdict.message,
    ...(verdict.source !== undefined ? { provenance: verdict.source } : {}),
    ...hook,
  });
}

/** The run values a caller's shell holds: a sub-agent's own, else the main agent's. */
function shellValuesOf(agents: TurnAgents, caller: Caller): Readonly<Record<string, string>> {
  return caller.kind === "subagent" ? (agents.subagents.get(caller.type)?.shellValues ?? agents.root.shellValues) : agents.root.shellValues;
}

interface EngineRun {
  /** What the engine should report loading at its init: the turn's skills by id and its sub-agents' types. */
  readonly expected: { readonly skills: readonly string[]; readonly agents: readonly string[] };
  readonly stream: PromptStream;
  readonly midTurn: MidTurnInput;
  /** The calls open on the stream, which the mid-turn input's rule reads. */
  readonly openCalls: Set<string>;
  /** Be told each time the gate decides a call. */
  readonly onDecided: (listener: (toolUseId: string, verdict: GateVerdict) => void) => void;
  readonly options: Parameters<ClaudeSdk["query"]>[0]["options"];
  readonly abort: AbortController;
  readonly translator: ClaudeTranslator;
  readonly usage: ClaudeUsage;
  /** Tells the gate the turn is stopping or yielding. */
  readonly halt: () => void;
  readonly unattendedSkips: ReadonlyMap<string, string | null>;
  /** Propose the WAITING row of the call the engine deferred. */
  readonly propose: (callId: string) => void;
}

/** The call a result says the engine deferred; undefined when it deferred none (step 4 of the header). */
function deferredCallOf(result: SDKResultMessage): string | undefined {
  return (result as { deferred_tool_use?: { id?: unknown } }).deferred_tool_use?.id as string | undefined;
}

/** Step 4 of the header: the engine run to its last result. */
async function runEngine(input: TurnInput, sink: TurnSink, sdk: ClaudeSdk, run: EngineRun): Promise<InvocationEnd> {
  const { stream, midTurn, abort, translator, usage } = run;
  const builder = sink.transcript;
  const scheduler = new StreamingUpdateScheduler(loadStreamingConfig());
  const query: Query = sdk.query({ prompt: stream, options: run.options });
  const { openCalls } = run;
  let stopped = false;
  let yielding = false;
  let forceAbort: ReturnType<typeof setTimeout> | undefined;
  let result: SDKResultMessage | undefined;
  let mirrorError: string | undefined;
  let deferred: string | undefined;
  let events = 0;

  const interrupt = (): void => {
    void query.interrupt().catch(() => undefined);
  };
  const onStop = (): void => {
    stopped = true;
    run.halt();
    midTurn.halt();
    interrupt();
    forceAbort ??= setTimeout(() => abort.abort(), STOP_GRACE_MS);
  };
  const onYield = (): void => {
    yielding = true;
    run.halt();
    midTurn.halt();
    if (openCalls.size === 0) interrupt();
  };
  sink.stopSignal.addEventListener("abort", onStop, { once: true });
  sink.yieldSignal.addEventListener("abort", onYield, { once: true });
  /** The model's message on the main thread is still streaming. */
  let answering = false;
  const offPending = sink.input.onPending(() => {
    if (openCalls.size > 0 && !answering) void midTurn.whileWorking();
  });
  run.onDecided((toolUseId, verdict) => {
    // A call the gate lets run is RUNNING, and in the session's log while it
    // runs (`translator.ts`): written now, since a long call sends no
    // message to the loop below until it returns.
    if (verdict.kind === "allow") {
      for (const event of translator.admitted(toolUseId)) builder.apply(event);
      if (builder.dirty) {
        builder.markPersisted();
        void sink.requestPersist();
      }
    }
    // A call the gate lets run may open the way for a message the turn held back while it was undecided.
    if (openCalls.size > 0 && !answering) void midTurn.whileWorking();
  });

  try {
    for await (const message of query) {
      events += 1;
      let detail: string | undefined;
      for (const event of translator.translate(message)) {
        builder.apply(event);
        if (event.kind === "message_start" && event.subAgentId === undefined) {
          answering = true;
        } else if (event.kind === "message_finish" && event.subAgentId === undefined) {
          answering = false;
          if (openCalls.size > 0) void midTurn.whileWorking();
        } else if (event.kind === "tool_started") {
          openCalls.add(event.callId);
          detail = event.name;
        } else if (event.kind === "tool_finished" || event.kind === "tool_error") {
          openCalls.delete(event.callId);
          if (yielding && openCalls.size === 0) interrupt();
        }
      }
      const delta = usage.observe(message);
      if (delta !== undefined) sink.reportUsage(delta);
      midTurn.observe(message);
      sink.recordActivity(detail ?? message.type);

      if (message.type === "system") {
        if (message.subtype === "init") {
          const named = (names: readonly string[] | undefined): string => (names ?? []).join(",");
          console.log(
            `[claude-turn] execution=${input.executionId} engine init: tools=${named(message.tools)} mcp=${named(message.mcp_servers.map((s) => `${s.name}:${s.status}`))}` +
              ` agents=${named(message.agents)} plugins=${named(message.plugins.map((p) => p.name))} skills=${named(message.skills)}`,
          );
          const missing = [
            ...run.expected.skills.filter((skill) => !message.skills.includes(skill)).map((skill) => `skill ${skill}`),
            ...run.expected.agents.filter((agent) => !(message.agents ?? []).includes(agent)).map((agent) => `sub-agent ${agent}`),
          ];
          if (missing.length > 0) console.warn(`[claude-turn] execution=${input.executionId} the engine did not load ${missing.join(", ")}`);
        }
        if (message.subtype === "mirror_error") {
          mirrorError ??= message.error;
          console.error(`[claude-turn] execution=${input.executionId} the session store lost a batch: ${message.error}`);
        }
      }
      if (message.type === "result") {
        result = message;
        deferred = stopped || yielding ? undefined : deferredCallOf(message);
        if (stopped || yielding || deferred !== undefined) {
          stream.close();
        } else {
          await midTurn.atResult();
          if (!midTurn.owed) stream.close();
        }
      }

      if (stopped) continue;
      if (!shouldPersistStreamingStatus(builder.dirty, scheduler, events)) continue;
      builder.markPersisted();
      await sink.requestPersist();
      scheduler.markUpdateSent(events);
    }
  } catch (err) {
    // The engine's process ends after its last result, and an engine that
    // failed its run exits non-zero, which the SDK throws: once a result is
    // in, the result is the outcome, and the exit is logged.
    if (result !== undefined) {
      console.warn(`[claude-turn] execution=${input.executionId} the engine exited after its result: ${err instanceof Error ? err.message : String(err)}`);
    } else if (!(stopped || yielding || abort.signal.aborted)) {
      throw err;
    }
  } finally {
    stream.close();
    offPending();
    sink.stopSignal.removeEventListener("abort", onStop);
    sink.yieldSignal.removeEventListener("abort", onYield);
    if (forceAbort !== undefined) clearTimeout(forceAbort);
    query.close();
  }
  const awaitingApproval = deferred !== undefined && !(stopped || yielding) && result?.is_error !== true;
  if (awaitingApproval) run.propose(deferred!);
  return { stopped: stopped || yielding, result, mirrorError, unattendedSkips: run.unattendedSkips, structuredOutput: input.structuredOutputSchema !== undefined, awaitingApproval };
}

/** Best-effort teardown: a failed close is logged and never masks the turn's outcome. */
async function closeQuietly(executionId: string, what: string, close: () => Promise<unknown> | undefined): Promise<void> {
  try {
    await close();
  } catch (err) {
    console.warn(`ExecuteClaude ${what} cleanup failed (non-fatal): execution=${executionId}, error=${err instanceof Error ? err.message : String(err)}`);
  }
}
