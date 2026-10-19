// Canonical Run fixtures + execution polling helpers.
// Domain: conformance support (execution engine).
//
// A Run is one user message and the agent's response (a turn),
// run through the engine (Temporal orchestrator + TS runner + a mock LLM). It
// names its conversation through the spec's `target` oneof: an existing
// session (`session_id`), or a new one (`session_spec`, the one-call
// bootstrap) whose agent_ref names the agent it runs; with neither, the turn
// starts a conversation with the built-in assistant. The builder takes the
// agent as a reference (`agentRef`, merged into the new session's spec), so
// a turn on an agent never names an agent id: the server pins the agent and
// version on the session and stamps them on the turn's status. A Run
// is a *running thing*, so this module also exposes phase-await helpers,
// delegating the timing loop to the shared poll core. What a turn did (its
// messages, tool uses, sub-agents) is the session's log: support/turn.ts.
// What waits for a person, and the answers, are support/answers.ts.
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import type { InitShape } from "./init-shape";
import type { Run } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/api_pb";
import { RunPhase } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { InteractionMode } from "@stigmer/apis/ai/stigmer/agentic/run/v1/enum_pb";
import type { RunConfigSchema } from "@stigmer/apis/ai/stigmer/agentic/run/v1/invocation_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import { SessionSpecSchema } from "@stigmer/apis/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/apis/ai/stigmer/commons/apiresource/io_pb";
import type { ConformanceClients } from "../harness/clients";
import type { Plugin } from "@stigmer/apis/ai/stigmer/agentic/plugin/v1/api_pb";
import type { FixtureTracker } from "../harness/fixtures";
import type { FixtureTool, McpToolFixture } from "../harness/mcp-server";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import type { TargetProfile } from "../targets/target";
import { type AgentRefInit, makeAgentRef } from "./agents";
import { type PollCoreOptions, pollUntil } from "./run-poll";
import { FIXTURE_SERVER, oneServerPlugin, pushPlugin } from "./plugins";

export const AGENT_EXECUTION_API_VERSION = "agentic.stigmer.ai/v1";
export const AGENT_EXECUTION_KIND = "Run";

export interface AgentExecutionOptions {
  org: string;
  name: string;
  // The conversation the turn joins (spec.target). `sessionId` continues an
  // existing session. Otherwise the turn starts a new one: `agentRef` names
  // its agent (the new session's agent_ref) and `sessionSpec` carries the
  // rest of its shape (the one-call bootstrap, stigmer/stigmer#249); with
  // neither, the conversation is the built-in assistant's. `sessionId`
  // excludes the other two: the oneof holds one arm.
  agentRef?: AgentRefInit;
  sessionId?: string;
  sessionSpec?: MessageInitShape<typeof SessionSpecSchema>;
  // The user message that triggers the run; must be non-empty (proto min_len=1).
  message?: string;
  // Runtime bypass of all tool-approval gates (spec.auto_approve_all). Omitted =
  // gates apply; true = the run never pauses for approval. The top of the
  // approval-policy chain.
  autoApproveAll?: boolean;
  // Whether the new conversation uses each sender's My vault, first
  // (session_spec.include_my_vault). Only a turn that starts a
  // conversation carries it; a later change is a session update.
  includeMyVault?: boolean;
  // The settings this message asks for (spec.run_config): model, tier,
  // thinking, bounds. Left unset by default: the agent's defaults and the
  // engine's choose; the server records what the turn ran with on
  // status.run_config.
  runConfig?: MessageInitShape<typeof RunConfigSchema>;
  // The per-message intents (spec.interaction_mode, spec.build_from_plan,
  // spec.structured_output_schema).
  interactionMode?: InteractionMode;
  buildFromPlan?: boolean;
  structuredOutputSchema?: JsonObject;
  // Files given with the message (spec.file_ids), by id. Each joins the
  // conversation's resources as its own copy, and the runner places it under
  // .stigmer/uploads/.
  fileIds?: string[];
  // Workspace paths the user highlighted for this message
  // (spec.workspace_file_refs): named to the agent, never uploaded.
  workspaceFileRefs?: string[];
}

// A complete, valid Run create request. run_config is left unset
// unless provided, so the only variable inputs are the target, the message,
// and the optional overrides.
export function makeAgentExecution(opts: AgentExecutionOptions): InitShape<typeof RunSchema> {
  return {
    apiVersion: AGENT_EXECUTION_API_VERSION,
    kind: AGENT_EXECUTION_KIND,
    metadata: {
      name: opts.name,
      org: opts.org,
    },
    spec: {
      ...executionTarget(opts),
      message: opts.message ?? "Say hello.",
      ...(opts.autoApproveAll !== undefined ? { autoApproveAll: opts.autoApproveAll } : {}),
      ...(opts.runConfig !== undefined ? { runConfig: opts.runConfig } : {}),
      ...(opts.interactionMode !== undefined ? { interactionMode: opts.interactionMode } : {}),
      ...(opts.buildFromPlan !== undefined ? { buildFromPlan: opts.buildFromPlan } : {}),
      ...(opts.structuredOutputSchema !== undefined
        ? { structuredOutputSchema: opts.structuredOutputSchema }
        : {}),
      ...(opts.fileIds !== undefined ? { fileIds: opts.fileIds } : {}),
      ...(opts.workspaceFileRefs !== undefined ? { workspaceFileRefs: opts.workspaceFileRefs } : {}),
    },
  };
}

// The spec's target oneof for the options: the existing session, or the new
// conversation's session spec with its agent reference folded in. A
// `sessionId` beside `agentRef` or `sessionSpec` is a fixture mistake (the
// oneof holds one arm), refused here rather than silently dropping one.
function executionTarget(
  opts: AgentExecutionOptions,
): Pick<NonNullable<InitShape<typeof RunSchema>["spec"]>, "target"> {
  if (opts.sessionId !== undefined) {
    if (opts.agentRef !== undefined || opts.sessionSpec !== undefined || opts.includeMyVault !== undefined) {
      throw new Error(
        "makeAgentExecution: sessionId excludes agentRef, sessionSpec and includeMyVault (spec.target is a oneof; an existing session's vault choice changes by session update)",
      );
    }
    return { target: { case: "sessionId", value: opts.sessionId } };
  }
  if (opts.agentRef === undefined && opts.sessionSpec === undefined && opts.includeMyVault === undefined) {
    return {};
  }
  const sessionSpec = create(SessionSpecSchema, opts.sessionSpec ?? {});
  if (opts.includeMyVault !== undefined) {
    sessionSpec.includeMyVault = opts.includeMyVault;
  }
  if (opts.agentRef !== undefined) {
    sessionSpec.agentRef = create(ApiResourceReferenceSchema, makeAgentRef(opts.agentRef));
  }
  return { target: { case: "sessionSpec", value: sessionSpec } };
}

// The session a persisted turn belongs to: the server replaces a new
// conversation's session_spec with the id of the session it created, so
// every stored turn reads through the session_id arm ("" when it has none).
export function sessionIdOf(execution: Run | undefined): string {
  const target = execution?.spec?.target;
  return target?.case === "sessionId" ? target.value : "";
}

// Terminal = the engine will never move the phase again. PAUSED is NOT terminal
// (resume revives it) and WAITING_FOR_APPROVAL is a wait, not an end state.
const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

export function isTerminalPhase(phase: RunPhase | undefined): boolean {
  return phase !== undefined && TERMINAL_PHASES.has(phase);
}

// Stops a turn that may still be working the way a person does: the session's
// interrupt, which stops every unfinished turn of the run's session (each
// ends CANCELLED with stop cause user). A run already finished is left as it
// is.
export async function interruptRunSession(clients: ConformanceClients, runId: string): Promise<void> {
  const run = await clients.agentExecutionQuery.get({ value: runId });
  await clients.sessionCommand.interrupt({ sessionId: sessionIdOf(run) });
}

export interface PollOptions extends PollCoreOptions {
  // Used in the timeout error for diagnosis.
  label?: string;
}

// Polls get() until `predicate` holds, returning the matching execution.
// Throws with the OBSERVED PHASE TRACE on timeout (never sleeps blindly):
// a phase-transition assertion that times out is a race report, and the
// sequence of phases the poll actually saw is what makes the failure
// attributable to a writer without re-running under instrumentation.
export function pollExecution(
  clients: ConformanceClients,
  executionId: string,
  predicate: (exec: Run) => boolean,
  opts: PollOptions = {},
): Promise<Run> {
  const phaseTrace: string[] = [];
  return pollUntil(
    async () => {
      const execution = await clients.agentExecutionQuery.get({ value: executionId });
      const phase =
        RunPhase[execution.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED];
      if (phaseTrace.at(-1) !== phase) {
        phaseTrace.push(phase);
      }
      return execution;
    },
    predicate,
    (last, timeoutMs) =>
      `execution ${executionId} did not satisfy ${opts.label ?? "the predicate"} ` +
      `within ${timeoutMs}ms (observed phases: ${phaseTrace.join(" -> ")}; ` +
      `status.error: ${JSON.stringify(last?.status?.error ?? "")}; ` +
      `stop_cause: ${JSON.stringify(last?.status?.stopCause ?? "")})`,
    opts,
  );
}

// Convenience: await a specific phase.
export function awaitPhase(
  clients: ConformanceClients,
  executionId: string,
  phase: RunPhase,
  opts: PollOptions = {},
): Promise<Run> {
  return pollExecution(clients, executionId, (e) => e.status?.phase === phase, {
    label: `phase ${RunPhase[phase]}`,
    ...opts,
  });
}

// Convenience: await any terminal phase (returns whichever it settles in).
export function awaitTerminal(
  clients: ConformanceClients,
  executionId: string,
  opts: PollOptions = {},
): Promise<Run> {
  return pollExecution(clients, executionId, (e) => isTerminalPhase(e.status?.phase), {
    label: "a terminal phase",
    ...opts,
  });
}

// Obtain the mock LLM proxy from an execution target, failing loudly if the
// active target does not provide one (e.g. a CRUD-only target). Agent
// execution suites require an execution target (local-execution or
// cloud-execution).
export function requireLlmProxy(target: TargetProfile): MockLlmProxy {
  if (target.llmProxy === undefined) {
    throw new Error(
      `target ${target.name} does not provide a mock LLM proxy; ` +
        "agent execution suites require an execution target (local-execution or cloud-execution)",
    );
  }
  return target.llmProxy();
}

// Obtain the HTTP MCP tool fixture from an execution target, failing loudly if
// the active target does not provide one. Tool-using (HITL) agent suites
// require an execution target (local-execution or cloud-execution).
export function requireMcpFixture(target: TargetProfile): McpToolFixture {
  if (target.mcpFixture === undefined) {
    throw new Error(
      `target ${target.name} does not provide an MCP tool fixture; ` +
        "tool-using agent suites require an execution target (local-execution or cloud-execution)",
    );
  }
  return target.mcpFixture();
}

export interface FixturePluginOptions {
  org: string;
  // The plugin's name: the turn names its server `plugin_<name>_tools`.
  name: string;
  // The fixture's tool surface its one server offers (McpToolFixture.url).
  tools: readonly FixtureTool[];
  // Headers the server is sent, `${VAR}` references included.
  headers?: Readonly<Record<string, string>>;
}

// A one-server plugin whose server is the fixture's `tools` surface, pushed
// into the organization; its delete is deferred on the caller's tracker. A
// run reads a tool's destructive mark live from the server, so nothing is
// connected first. The stored entry is asserted here (the server, at the
// surface's URL, with no sign-in: the fixture answers the install's probe
// without a challenge), so an arm whose tools never appear is red at its
// cause rather than as a timeout waiting on the model. `expect` is imported
// at the call, not at the module's top: this module's builders and phase
// helpers are also read by the live benchmark script
// (scripts/benchmark-harnesses.ts), which runs outside vitest, and vitest's
// `expect` refuses to load without a running test worker.
export async function pushFixturePlugin(
  clients: Pick<ConformanceClients, "pluginCommand">,
  mcp: Pick<McpToolFixture, "url">,
  fixtures: FixtureTracker,
  opts: FixturePluginOptions,
): Promise<Plugin> {
  const { expect } = await import("vitest");
  const url = mcp.url(opts.tools);
  const plugin = await pushPlugin(
    clients,
    fixtures,
    opts.org,
    oneServerPlugin({
      name: opts.name,
      server: { url, ...(opts.headers !== undefined ? { headers: opts.headers } : {}) },
    }),
  );
  const entries = plugin.status?.mcpServers ?? [];
  expect(
    entries.map((entry) => [
      entry.name,
      entry.transport.case === "http" ? entry.transport.value.url : entry.transport.case,
      entry.signIn?.oauthOnly ?? false,
    ]),
    `the installed plugin ${plugin.metadata?.id ?? ""} lists its one server at the fixture's surface`,
  ).toEqual([[FIXTURE_SERVER, url, false]]);
  return plugin;
}
