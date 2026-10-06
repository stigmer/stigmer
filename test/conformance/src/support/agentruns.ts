// Canonical AgentExecution fixtures + execution polling helpers.
// Domain: conformance support (execution engine).
//
// An AgentExecution is one user message and the agent's response (a turn),
// run through the engine (Temporal orchestrator + TS runner + a mock LLM). It
// names its conversation through the spec's `target` oneof: an existing
// session (`session_id`), or a new one (`session_spec`, the one-call
// bootstrap) whose agent_ref names the agent it runs; with neither, the turn
// starts a conversation with the built-in assistant. The builder takes the
// agent as a reference (`agentRef`, merged into the new session's spec), so
// a turn on an agent never names an agent id: the server pins the agent and
// version on the session and stamps them on the turn's status. Like
// WorkflowExecution this is a *running thing*, so this module also exposes
// phase-await helpers, delegating the timing loop to the shared poll core
// so both execution domains share one definition — and the submit-approval
// seam: the one place the approval read-model contract is
// asserted (see the seam's own header below).
import { create, type MessageInitShape } from "@bufbuild/protobuf";
import type { InitShape } from "./init-shape";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { AgentRunSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/message_pb";
import type { InteractionMode } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import type { RunConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/invocation_pb";
import type {
  AttachmentSchema,
  WorkflowParentSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/spec_pb";
import type { JsonObject } from "@bufbuild/protobuf";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceReferenceSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/io_pb";
import type { ConformanceClients } from "../harness/clients";
import type { McpServer } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/api_pb";
import { ConnectPhase } from "@stigmer/protos/ai/stigmer/agentic/mcpserver/v1/status_pb";
import type { FixtureTracker } from "../harness/fixtures";
import { DESTRUCTIVE_ECHO_TOOL_NAME, type FixtureTool, type McpToolFixture } from "../harness/mcp-server";
import type { MockLlmProxy } from "@stigmer/test-support/mock-llm";
import type { TargetProfile } from "../targets/target";
import { type AgentRefInit, makeAgentRef } from "./agents";
import { type ExecutionValueInit, makeExecutionValues } from "./executioncontexts";
import { type PollCoreOptions, pollUntil } from "./run-poll";
import { makeHttpMcpServer } from "./mcpservers";

export const AGENT_EXECUTION_API_VERSION = "agentic.stigmer.ai/v1";
export const AGENT_EXECUTION_KIND = "AgentExecution";

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
  // The workflow run that started the turn (spec.parent): honoured only from
  // that run's runner, the server, or a holder of can_write_reserved_labels.
  parent?: MessageInitShape<typeof WorkflowParentSchema>;
  // Metadata labels, passed through verbatim (the lineage-label arms).
  labels?: Record<string, string>;
  // The user message that triggers the run; must be non-empty (proto min_len=1).
  message?: string;
  // Runtime bypass of all tool-approval gates (spec.auto_approve_all). Omitted =
  // gates apply; true = the run never pauses for approval. The top of the
  // approval-policy chain.
  autoApproveAll?: boolean;
  // Execution-scoped env overrides (spec.runtime_env) — the highest-precedence
  // layer of the env merge, materialized into the ExecutionContext at create.
  runtimeEnv?: Record<string, ExecutionValueInit>;
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
  // Input attachments (spec.attachments). Each carries a storage_key from
  // uploadAttachment; the runner materializes them under .stigmer/inputs/.
  attachments?: MessageInitShape<typeof AttachmentSchema>[];
  // Workspace paths the user highlighted for this message
  // (spec.workspace_file_refs): named to the agent, never uploaded.
  workspaceFileRefs?: string[];
}

// A complete, valid AgentExecution create request. run_config is left unset
// unless provided, so the only variable inputs are the target, the message,
// and the optional overrides.
export function makeAgentExecution(opts: AgentExecutionOptions): InitShape<typeof AgentRunSchema> {
  return {
    apiVersion: AGENT_EXECUTION_API_VERSION,
    kind: AGENT_EXECUTION_KIND,
    metadata: {
      name: opts.name,
      org: opts.org,
      ...(opts.labels !== undefined ? { labels: opts.labels } : {}),
    },
    spec: {
      ...executionTarget(opts),
      ...(opts.parent !== undefined ? { parent: opts.parent } : {}),
      message: opts.message ?? "Say hello.",
      ...(opts.autoApproveAll !== undefined ? { autoApproveAll: opts.autoApproveAll } : {}),
      ...(opts.runtimeEnv !== undefined ? { runtimeEnv: makeExecutionValues(opts.runtimeEnv) } : {}),
      ...(opts.runConfig !== undefined ? { runConfig: opts.runConfig } : {}),
      ...(opts.interactionMode !== undefined ? { interactionMode: opts.interactionMode } : {}),
      ...(opts.buildFromPlan !== undefined ? { buildFromPlan: opts.buildFromPlan } : {}),
      ...(opts.structuredOutputSchema !== undefined
        ? { structuredOutputSchema: opts.structuredOutputSchema }
        : {}),
      ...(opts.attachments !== undefined ? { attachments: opts.attachments } : {}),
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
): Pick<NonNullable<InitShape<typeof AgentRunSchema>["spec"]>, "target"> {
  if (opts.sessionId !== undefined) {
    if (opts.agentRef !== undefined || opts.sessionSpec !== undefined) {
      throw new Error("makeAgentExecution: sessionId excludes agentRef and sessionSpec (spec.target is a oneof)");
    }
    return { target: { case: "sessionId", value: opts.sessionId } };
  }
  if (opts.agentRef === undefined && opts.sessionSpec === undefined) {
    return {};
  }
  const sessionSpec = create(SessionSpecSchema, opts.sessionSpec ?? {});
  if (opts.agentRef !== undefined) {
    sessionSpec.agentRef = create(ApiResourceReferenceSchema, makeAgentRef(opts.agentRef));
  }
  return { target: { case: "sessionSpec", value: sessionSpec } };
}

// The session a persisted turn belongs to: the server replaces a new
// conversation's session_spec with the id of the session it created, so
// every stored turn reads through the session_id arm ("" when it has none).
export function sessionIdOf(execution: AgentRun | undefined): string {
  const target = execution?.spec?.target;
  return target?.case === "sessionId" ? target.value : "";
}

// Terminal = the engine will never move the phase again. PAUSED is NOT terminal
// (resume revives it) and WAITING_FOR_APPROVAL is a wait, not an end state.
// Note the AgentExecution enum numbering diverges from WorkflowExecution:
// WAITING_FOR_APPROVAL=6, PAUSED=7, TERMINATED=8.
const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set([
  RunPhase.RUN_COMPLETED,
  RunPhase.RUN_FAILED,
  RunPhase.RUN_CANCELLED,
  RunPhase.RUN_TERMINATED,
]);

export function isTerminalPhase(phase: RunPhase | undefined): boolean {
  return phase !== undefined && TERMINAL_PHASES.has(phase);
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
  predicate: (exec: AgentRun) => boolean,
  opts: PollOptions = {},
): Promise<AgentRun> {
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
    (last, timeoutMs) => {
      const lastMessage = last?.status?.messages?.at(-1)?.content ?? "";
      return (
        `execution ${executionId} did not satisfy ${opts.label ?? "the predicate"} ` +
        `within ${timeoutMs}ms (observed phases: ${phaseTrace.join(" -> ")}; ` +
        `status.error: ${JSON.stringify(last?.status?.error ?? "")}; ` +
        `messages: ${last?.status?.messages?.length ?? 0}, ` +
        `last: ${JSON.stringify(lastMessage.slice(0, 160))})`
      );
    },
    opts,
  );
}

// Convenience: await a specific phase.
export function awaitPhase(
  clients: ConformanceClients,
  executionId: string,
  phase: RunPhase,
  opts: PollOptions = {},
): Promise<AgentRun> {
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
): Promise<AgentRun> {
  return pollExecution(clients, executionId, (e) => isTerminalPhase(e.status?.phase), {
    label: "a terminal phase",
    ...opts,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// The submit-approval seam.
//
// Every approval submit in the execution suites is one gesture: submit the
// decision right after the gate appears, assert the response's pending_approvals
// reflects it (the contract the approval suite's header states — recomputed
// SYNCHRONOUSLY, in the same locked write that records the decision), continue.
// The seam owns that gesture once, for two reasons that hold on every target:
//
// - it is the ONE definition of the approval read-model contract, so a change
//   to what a submit response must carry lands here and not at ten sites;
// - asserting AT the submit turns a decision the server failed to record into a
//   red that names the decision, where a bare submit would surface it later as
//   an awaitTerminal timeout with a misleading face.
//
// History: the seam arrived to contain a Java-only race
// (the workflow's WAITING heartbeat overwriting a concurrent submit) that the
// OSS server was structurally immune to — its submit and its status writes are
// each one read-modify-write under the store write lock. The race path retired
// with the Java service (stigmer#1023).
// ─────────────────────────────────────────────────────────────────────────────

export interface SubmitApprovalPerContractOptions {
  // Issues the decision. Resolves to the AgentExecution whose read model the
  // contract is asserted on: the submit response for a direct submit; for the
  // workflow forwarder — whose own response is the PARENT, loaded before the
  // forward — a fresh get of the child.
  submit: () => Promise<AgentRun>;
  // pending_approvals the response must carry after this decision: 0 for a
  // single gate, 1 for the first approve of two co-pending calls.
  expectedRemaining: number;
  // Names the decision in the contract assertion's failure message.
  label: string;
}

// Submits per the contract and returns the response the contract held on.
// `expect` is imported here, at the call, not at the module's top: this
// module's builders and phase helpers are also read by the live benchmark
// script (scripts/benchmark-harnesses.ts), which runs outside vitest, and
// vitest's `expect` refuses to load without a running test worker.
export async function submitApprovalPerContract(
  opts: SubmitApprovalPerContractOptions,
): Promise<AgentRun> {
  const { expect } = await import("vitest");
  const response = await opts.submit();
  expect(response.status?.pendingApprovals.length, opts.label).toBe(opts.expectedRemaining);
  return response;
}

// Who the approval ledger names as the decider of `toolCallId`: the decided
// event's decided_by, or undefined when no decision is recorded. Read from the
// append-only stream rather than the tool call, whose id an approved call's
// resumed stream does not keep stable. The server records the principal it
// authorized, the same id it stamps as created_by on what that caller creates,
// so a suite compares the two without knowing the edition's identity scheme.
export function decidedByOf(execution: AgentRun, toolCallId: string): string | undefined {
  const decided = (execution.status?.approvalEventStream?.events ?? []).find(
    (event) => event.approvalRequestId === toolCallId && event.payload.case === "decided",
  );
  return decided?.payload.case === "decided" ? decided.payload.value.decidedBy : undefined;
}

// Root and sub-agent transcripts, the same scan the server's pending-approval
// projection runs — the REJECT arm reads the decided tool call through it.
export function allToolCalls(execution: AgentRun): ToolCall[] {
  const root = execution.status?.messages.flatMap((message) => message.toolCalls) ?? [];
  const nested =
    execution.status?.subAgentRuns.flatMap((subAgent) =>
      subAgent.messages.flatMap((message) => message.toolCalls),
    ) ?? [];
  return [...root, ...nested];
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

export interface ConnectedMcpServerOptions {
  org: string;
  name: string;
  // The fixture's tool surface to register (McpToolFixture.url).
  tools: readonly FixtureTool[];
}

// An McpServer on the fixture, created AND connected. The approval default
// asks before a tool its server marks destructive, and the runner reads that
// mark only from the stored discovery (DiscoveredTool.destructive_hint), so an
// arm that needs the gate connects first. The connect's outcome and the stored
// hints are asserted here, so an arm whose gate never parks is red at its
// cause rather than as a timeout waiting for WAITING_FOR_APPROVAL. The delete
// is deferred on the caller's tracker. `expect` is imported at the call for
// the reason submitApprovalPerContract gives.
export async function createConnectedMcpServer(
  clients: ConformanceClients,
  mcp: McpToolFixture,
  fixtures: FixtureTracker,
  opts: ConnectedMcpServerOptions,
): Promise<McpServer> {
  const { expect } = await import("vitest");
  const created = await clients.mcpServerCommand.create(
    makeHttpMcpServer({ org: opts.org, name: opts.name, url: mcp.url(opts.tools) }),
  );
  fixtures.defer(() => clients.mcpServerCommand.delete({ resourceId: created.metadata!.id }));

  const connected = await clients.mcpServerCommand.connect({ mcpServerId: created.metadata!.id, org: opts.org });
  const connect = connected.status?.connectStatus;
  expect(
    connect?.phase,
    `connect of ${created.metadata!.id}: ${connect?.failureCode ?? ""} ${connect?.failureMessage ?? ""}`,
  ).toBe(ConnectPhase.succeeded);
  const hints = Object.fromEntries(
    (connected.status?.discoveredCapabilities?.tools ?? []).map((tool) => [tool.name, tool.destructiveHint]),
  );
  expect(hints, "the stored discovery marks exactly the fixture's destructive tool").toEqual(
    Object.fromEntries(opts.tools.map((tool) => [tool, tool === DESTRUCTIVE_ECHO_TOOL_NAME])),
  );
  return connected;
}
