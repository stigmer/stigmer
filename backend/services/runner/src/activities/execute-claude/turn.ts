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
 *     an agent with skills or sub-agents, the fast tier, a model that is not
 *     Claude. Each refusal is `actionable`, with the sentence that says how.
 *  2. Connect the turn's MCP servers in the host (`mcp-bridge.ts`), decide
 *     the tools the engine is offered (`engine-options.ts`), and build the
 *     gate over them (`gate.ts`).
 *  3. Read the session's transcript from the store (`session-store.ts`,
 *     `transcript-facts.ts`): a new run hands the engine its message; a run
 *     the engine already took is continued without the task (stigmer#2417),
 *     with the messages sent while it worked that it never read, or a short
 *     note to go on; a run whose engine had already finished settles with no
 *     model call.
 *  4. Run the engine to its result, folding each message into the
 *     transcript (`translator.ts`), reporting each model call's usage
 *     (`usage.ts`), persisting on the shared cadence, and taking every
 *     message a person sends while it works into the open prompt, where the
 *     engine reads it before its next model call. Before it may end, the
 *     turn claims once more; a message the engine has not read keeps it
 *     going one more round.
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
import { InteractionMode, ServiceTier } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";

import type { Config } from "../../config.js";
import type { TurnInputChannel } from "../../harness/turn-input.js";
import type { TurnInput, TurnOutcome, TurnSink } from "../../harness/types.js";
import { buildMcpApprovalDefault } from "../../shared/approval-policy.js";
import { toAnthropicImageBlocks } from "../../shared/attachment-vision.js";
import { emitTimingLog } from "../../shared/cold-start-timing.js";
import { getExecutionContext } from "../../shared/execution-context.js";
import { isPathCapturable } from "../../shared/filereview/git-substrate.js";
import { declaredServerCount } from "../../shared/mcp-resolver.js";
import { describeExecutionError } from "../../shared/model-error.js";
import { modelLaneUrl, modelLanes } from "../../shared/model-lanes.js";
import { ensureLoaded as ensurePricingLoaded, getModelPricing } from "../../shared/model-pricing.js";
import { getDefaultModel, resolveToApiModelId } from "../../shared/model-registry.js";
import { shouldPersistStreamingStatus } from "../../shared/persist-decision.js";
import { readRootInstructionsWith, renderRepositoryInstructions } from "../../shared/repository-instructions.js";
import { buildShellEnv, shellRunValues } from "../../shared/shell-env.js";
import { StreamingUpdateScheduler, loadStreamingConfig } from "../../shared/streaming-scheduler.js";
import { checkMainToolListResolution, claudeToolsOf } from "../../shared/tool-lists.js";
import { getClaudeInvocationDir, getClaudeTranscriptDir } from "../../shared/workspace/platform-dir.js";
import { engineEnvironment } from "./engine-env.js";
import { CLAUDE_ENGINE_TOOL_COVERS, engineOptions, offeredBuiltins, userMessageOf } from "./engine-options.js";
import { engineSessionIdOf, runMessageIdOf, sentMessageIdOf } from "./engine-session-id.js";
import { FileTranscripts } from "./file-store.js";
import { ClaudeGate, canUseToolOf, gateFactsOf, preToolUseHooks } from "./gate.js";
import { hostShellServer, HOST_SHELL_TOOL } from "./host-shell.js";
import { HttpTranscripts } from "./http-store.js";
import { connectBridge, type McpBridge } from "./mcp-bridge.js";
import { composeSystemAppend, composeTurnMessage, instructionRoots, workspaceInstructionReader } from "./prompt.js";
import { PromptStream } from "./prompt-stream.js";
import { MidTurnInput, sentMessageOf } from "./mid-turn-input.js";
import { MemoryTranscripts, sessionStoreFor, type TranscriptBacking } from "./session-store.js";
import { settleClaudeTurn, type InvocationEnd } from "./settle.js";
import { transcriptFactsOf, type TranscriptFacts } from "./transcript-facts.js";
import { ClaudeTranslator } from "./translator.js";
import { ClaudeUsage } from "./usage.js";

/** The SDK, as `boot` loaded it. */
export type ClaudeSdk = typeof import("@anthropic-ai/claude-agent-sdk");

/** The runner config this harness reads per turn; a whole `Config` satisfies it. */
export type ClaudeAdapterConfig = Pick<Config, "checkpointerType" | "checkpointerProxyEndpoint" | "stigmerTokenRef" | "proxyEndpoint" | "shellTimeoutMaxSeconds" | "mode">;

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
  try {
    refuseUnsupported(input);
    const model = await resolveModel(input);
    bridge = await connectTools(input, sink);
    return await engineTurn(input, sink, config, sdk, { model, bridge, home });
  } catch (err) {
    if (err instanceof Refusal) {
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

/** Step 1 of the header. */
function refuseUnsupported(input: TurnInput): void {
  const skills = input.skills.root.length + [...input.skills.bySubAgent.values()].reduce((n, list) => n + list.length, 0);
  if (skills > 0) throw new Refusal("This agent has skills, which Claude does not run yet. Run it on another engine, or remove its skills.");
  if (input.subagents.length > 0 || input.blueprint.pluginAgents.length > 0) {
    throw new Refusal("This agent hands work to sub-agents, which Claude does not run yet. Run it on another engine, or remove its sub-agents.");
  }
  if (input.model.serviceTier === ServiceTier.FAST) throw new Refusal("Claude does not offer the fast tier yet. Run this turn on the standard tier.");
}

/** The model the turn runs on: its registry id, priced by, and the provider's id, sent. */
interface TurnModel {
  readonly registryId: string;
  readonly apiId: string;
}

async function resolveModel(input: TurnInput): Promise<TurnModel> {
  const registryId = input.model.requested === "default" ? await getDefaultModel() : input.model.requested;
  const apiId = await resolveToApiModelId(registryId);
  if (!apiId.startsWith("claude")) throw new Refusal(`Claude runs Claude models only, and "${registryId}" is not one. Choose a Claude model for this agent.`);
  return { registryId, apiId };
}

async function connectTools(input: TurnInput, sink: TurnSink): Promise<McpBridge> {
  if (input.mcp.servers.length > 0) await sink.reportProgress("Connecting tools…");
  const bridge = await connectBridge(input.mcp.servers, input.mcp.toolScope, input.mcp.platformServerSlugs);
  sink.setupTiming.mark("connect_mcp");
  sink.recordActivity();
  return bridge;
}

/** The backing the session's conversation is kept in (`session-store.ts`). */
function backingFor(config: ClaudeAdapterConfig, sessionId: string): TranscriptBacking {
  switch (config.checkpointerType) {
    case "http":
      if (config.checkpointerProxyEndpoint === null) throw new Error("the http checkpointer has no proxy endpoint on this runner");
      return new HttpTranscripts(config.checkpointerProxyEndpoint, config.stigmerTokenRef);
    case "sqlite":
      return new FileTranscripts(getClaudeTranscriptDir(sessionId));
    case "memory":
      return new MemoryTranscripts();
    default: {
      const exhaustive: never = config.checkpointerType;
      throw new Error(`unknown checkpointer type ${String(exhaustive)}`);
    }
  }
}

/** What the engine is handed first, by the transcript's facts (step 3 of the header). */
type Opening =
  | { readonly kind: "finished" }
  | { readonly kind: "run"; readonly messages: readonly SDKUserMessage[] };

async function openingOf(input: TurnInput, channel: TurnInputChannel, facts: TranscriptFacts): Promise<Opening> {
  const runId = runMessageIdOf(input.executionId);
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
}

async function engineTurn(input: TurnInput, sink: TurnSink, config: ClaudeAdapterConfig, sdk: ClaudeSdk, deps: EngineTurnDeps): Promise<TurnOutcome> {
  const { bridge, model, home } = deps;
  const { workspace } = input;
  const turnKey = getExecutionContext().getStore()?.turnKey;
  if (turnKey === undefined) throw new Error("the Claude engine runs only in the agent host, which holds the turn's key");
  const laneEndpoint = config.proxyEndpoint ?? modelLanes()?.endpoint;
  if (laneEndpoint === undefined) throw new Error("the agent host has no model lane to send the Claude engine's calls through");

  // The tools, the gate over them, and the lists checked against what binds.
  const planMode = input.execution.spec!.interactionMode === InteractionMode.PLAN;
  const builtins = offeredBuiltins(input.mcp.toolScope, planMode);
  const shell = builtins.includes(HOST_SHELL_TOOL.engineName);
  checkMainToolListResolution(
    input.mcp.toolScope,
    { claudeTools: claudeToolsOf(builtins, CLAUDE_ENGINE_TOOL_COVERS), hasMcp: (server, tool) => hasTool(bridge, server, tool), anyMcp: bridge.offered.size > 0 },
    (line) => console.warn(`[claude-turn] ${line}`),
  );
  let halted = false;
  const offered = new Set([...builtins, ...bridge.offered, ...(shell ? [HOST_SHELL_TOOL.aliasedName] : [])]);
  const isCapturable = (path: string): Promise<boolean> => (workspace.gitWorkspace ? isPathCapturable(workspace.primaryDir, path.replace(/^\/+/, "")) : Promise.resolve(false));
  const gate = new ClaudeGate(gateFactsOf(input, offered, bridge.serverOf, buildMcpApprovalDefault(bridge.listing, input.mcp.leases), isCapturable), () => halted);
  sink.setupTiming.mark("build_gate");

  // The conversation so far, and what the engine is handed first.
  const backing = backingFor(config, input.sessionId);
  const facts = transcriptFactsOf(await backing.load(input.threadId, undefined));
  const opening = await openingOf(input, sink.input, facts);
  if (opening.kind === "finished") {
    console.log(`[claude-turn] execution=${input.executionId} continued a run its engine had finished; settling with no model call`);
    return { kind: "completed" };
  }

  // The prompt's append, with the repository's own instructions.
  const maxChars = input.execution.status?.runConfig?.maxToolResultChars || 30_000;
  const roots = instructionRoots(workspace.primaryDir, workspace.provision.provisionResults.map((result) => result.rootDir));
  const instructions = await readRootInstructionsWith(workspaceInstructionReader(workspace.primaryDir), roots, maxChars);
  const systemAppend = composeSystemAppend(input, await input.standing.selectRecalledMemories(), renderRepositoryInstructions(instructions));

  // The engine's servers: the host's shell and the bridged ones.
  const abort = new AbortController();
  const mcpServers: Record<string, McpServerConfig> = {};
  if (shell) {
    const shellServer = hostShellServer({
      cwd: workspace.primaryDir,
      env: buildShellEnv(shellRunValues(input.values)),
      maxTimeoutSeconds: config.shellTimeoutMaxSeconds,
      gate,
      stopSignal: sink.stopSignal,
      onOutput: (callId, delta) => sink.transcript.apply({ kind: "tool_output_delta", callId, delta }),
      onActivity: (detail) => sink.recordActivity(detail),
    });
    mcpServers[HOST_SHELL_TOOL.server] = { type: "sdk", name: HOST_SHELL_TOOL.server, instance: shellServer };
  }
  for (const [slug, server] of bridge.servers) mcpServers[slug] = { type: "sdk", name: slug, instance: server };

  // The prompt the engine reads, and the messages sent while it works (`mid-turn-input.ts`).
  const stream = new PromptStream();
  for (const message of opening.messages) stream.push(message);
  const midTurn = new MidTurnInput(sink, stream);

  await mkdir(home, { recursive: true });
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
    builtins,
    mcpServers,
    anyMcpTool: bridge.offered.size > 0,
    systemAppend,
    model: model.apiId,
    thinkingMode: input.model.thinkingMode,
    hooks: preToolUseHooks(gate),
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
    skill_count: 0,
    workspace_entry_count: workspace.provision.provisionResults.length,
  }, sink.setupTiming);

  const end = await runEngine(input, sink, sdk, {
    stream,
    midTurn,
    options,
    abort,
    translator: new ClaudeTranslator({ serverOf: bridge.serverOf, verdictOf: (id) => gate.verdictOf(id) }),
    usage: new ClaudeUsage(getModelPricing(model.registryId), model.registryId),
    halt: () => {
      halted = true;
    },
    unattendedSkips: gate.unattendedSkips,
  });
  return settleClaudeTurn(sink, end);
}

/** Whether the bridge offers `tool` of `server` (any of its tools for `null`). */
function hasTool(bridge: McpBridge, server: string, tool: string | null): boolean {
  for (const name of bridge.offered) {
    const owner = bridge.serverOf(name);
    if (owner?.slug === server && (tool === null || owner.tool === tool)) return true;
  }
  return false;
}

interface EngineRun {
  readonly stream: PromptStream;
  readonly midTurn: MidTurnInput;
  readonly options: Parameters<ClaudeSdk["query"]>[0]["options"];
  readonly abort: AbortController;
  readonly translator: ClaudeTranslator;
  readonly usage: ClaudeUsage;
  /** Tells the gate the turn is stopping or yielding. */
  readonly halt: () => void;
  readonly unattendedSkips: ReadonlyMap<string, string | null>;
}

/** Step 4 of the header: the engine run to its last result. */
async function runEngine(input: TurnInput, sink: TurnSink, sdk: ClaudeSdk, run: EngineRun): Promise<InvocationEnd> {
  const { stream, midTurn, abort, translator, usage } = run;
  const builder = sink.transcript;
  const scheduler = new StreamingUpdateScheduler(loadStreamingConfig());
  const query: Query = sdk.query({ prompt: stream, options: run.options });
  const openCalls = new Set<string>();
  let stopped = false;
  let yielding = false;
  let forceAbort: ReturnType<typeof setTimeout> | undefined;
  let result: SDKResultMessage | undefined;
  let mirrorError: string | undefined;
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
        }
        if (message.subtype === "mirror_error") {
          mirrorError ??= message.error;
          console.error(`[claude-turn] execution=${input.executionId} the session store lost a batch: ${message.error}`);
        }
      }
      if (message.type === "result") {
        result = message;
        if (stopped || yielding) {
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
  return { stopped: stopped || yielding, result, mirrorError, unattendedSkips: run.unattendedSkips, structuredOutput: input.structuredOutputSchema !== undefined };
}

/** Best-effort teardown: a failed close is logged and never masks the turn's outcome. */
async function closeQuietly(executionId: string, what: string, close: () => Promise<unknown> | undefined): Promise<void> {
  try {
    await close();
  } catch (err) {
    console.warn(`ExecuteClaude ${what} cleanup failed (non-fatal): execution=${executionId}, error=${err instanceof Error ? err.message : String(err)}`);
  }
}
