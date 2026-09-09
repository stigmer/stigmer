// Canonical AgentExecution fixtures + execution polling helpers.
// Domain: conformance support (execution engine).
//
// An AgentExecution is one user message and the agent's response, run through the
// engine (Temporal orchestrator + TS runner + a mock LLM). It is created with a
// `message` plus a reference — `agent_id` (auto-creates a session) or `session_id`
// (existing session); with neither, the server resolves the platform default
// agent, which the OSS single-tenant target does not seed, so suites always pass a
// reference. Like WorkflowExecution this is a *running thing*, so this module also
// exposes phase-await helpers, delegating the timing loop to the shared poll core
// so both execution domains share one definition — and, since entry 20260908.01,
// the submit-approval seam: the one place the approval read-model contract is
// asserted (see the seam's own header below).
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { InitShape } from "./init-shape";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ToolCall } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { AttachmentSchema, ExecutionConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/spec_pb";
import type { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { expect } from "vitest";
import type { ConformanceClients } from "../harness/clients";
import type { McpToolFixture } from "../harness/mcp-server";
import type { MockLlmProxy } from "../harness/mock-llm";
import type { TargetProfile } from "../targets/target";
import { type ExecutionValueInit, makeExecutionValues } from "./executioncontexts";
import { type PollCoreOptions, pollUntil } from "./execution-poll";

export const AGENT_EXECUTION_API_VERSION = "agentic.stigmer.ai/v1";
export const AGENT_EXECUTION_KIND = "AgentExecution";

export interface AgentExecutionOptions {
  org: string;
  name: string;
  // Reference to run against. Provide agent_id (auto-creates a session) and/or
  // session_id (existing session). At least one is required for a hermetic run.
  agentId?: string;
  sessionId?: string;
  // Spec for the auto-created session (spec.session_spec) — the one-call
  // bootstrap (stigmer/stigmer#249). Mutually exclusive with sessionId.
  sessionSpec?: MessageInitShape<typeof SessionSpecSchema>;
  // The user message that triggers the run; must be non-empty (proto min_len=1).
  message?: string;
  // Runtime bypass of all tool-approval gates (spec.auto_approve_all). Omitted =
  // gates apply; true = the run never pauses for approval. The top of the
  // approval-policy chain.
  autoApproveAll?: boolean;
  // Execution-scoped env overrides (spec.runtime_env) — the highest-precedence
  // layer of the env merge, materialized into the ExecutionContext at create.
  runtimeEnv?: Record<string, ExecutionValueInit>;
  // Execution-time overrides (spec.execution_config) — model pin, service
  // tier, interaction mode. Left unset by default (the runner picks defaults).
  executionConfig?: MessageInitShape<typeof ExecutionConfigSchema>;
  // Input attachments (spec.attachments). Each carries a storage_key from
  // uploadAttachment; the runner materializes them under .stigmer/inputs/.
  attachments?: MessageInitShape<typeof AttachmentSchema>[];
}

// A complete, valid AgentExecution create request. execution_config is left unset
// unless provided, so the only variable inputs are the reference, the message,
// and the optional overrides.
export function makeAgentExecution(opts: AgentExecutionOptions): InitShape<typeof AgentExecutionSchema> {
  return {
    apiVersion: AGENT_EXECUTION_API_VERSION,
    kind: AGENT_EXECUTION_KIND,
    metadata: { name: opts.name, org: opts.org },
    spec: {
      ...(opts.agentId !== undefined ? { agentId: opts.agentId } : {}),
      ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
      ...(opts.sessionSpec !== undefined ? { sessionSpec: opts.sessionSpec } : {}),
      message: opts.message ?? "Say hello.",
      ...(opts.autoApproveAll !== undefined ? { autoApproveAll: opts.autoApproveAll } : {}),
      ...(opts.runtimeEnv !== undefined ? { runtimeEnv: makeExecutionValues(opts.runtimeEnv) } : {}),
      ...(opts.executionConfig !== undefined ? { executionConfig: opts.executionConfig } : {}),
      ...(opts.attachments !== undefined ? { attachments: opts.attachments } : {}),
    },
  };
}

// Terminal = the engine will never move the phase again. PAUSED is NOT terminal
// (resume revives it) and WAITING_FOR_APPROVAL is a wait, not an end state.
// Note the AgentExecution enum numbering diverges from WorkflowExecution:
// WAITING_FOR_APPROVAL=6, PAUSED=7, TERMINATED=8.
const TERMINAL_PHASES: ReadonlySet<ExecutionPhase> = new Set([
  ExecutionPhase.EXECUTION_COMPLETED,
  ExecutionPhase.EXECUTION_FAILED,
  ExecutionPhase.EXECUTION_CANCELLED,
  ExecutionPhase.EXECUTION_TERMINATED,
]);

export function isTerminalPhase(phase: ExecutionPhase | undefined): boolean {
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
  predicate: (exec: AgentExecution) => boolean,
  opts: PollOptions = {},
): Promise<AgentExecution> {
  const phaseTrace: string[] = [];
  return pollUntil(
    async () => {
      const execution = await clients.agentExecutionQuery.get({ value: executionId });
      const phase =
        ExecutionPhase[execution.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED];
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
  phase: ExecutionPhase,
  opts: PollOptions = {},
): Promise<AgentExecution> {
  return pollExecution(clients, executionId, (e) => e.status?.phase === phase, {
    label: `phase ${ExecutionPhase[phase]}`,
    ...opts,
  });
}

// Convenience: await any terminal phase (returns whichever it settles in).
export function awaitTerminal(
  clients: ConformanceClients,
  executionId: string,
  opts: PollOptions = {},
): Promise<AgentExecution> {
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
// History: the seam arrived with entry 20260908.01 to contain a Java-only race
// (the workflow's WAITING heartbeat overwriting a concurrent submit) that the
// OSS server was structurally immune to — its submit and its status writes are
// each one read-modify-write under the store write lock. The race path retired
// with the Java service (stigmer-cloud DD-013, stigmer#1023).
// ─────────────────────────────────────────────────────────────────────────────

export interface SubmitApprovalPerContractOptions {
  // Issues the decision. Resolves to the AgentExecution whose read model the
  // contract is asserted on: the submit response for a direct submit; for the
  // workflow forwarder — whose own response is the PARENT, loaded before the
  // forward — a fresh get of the child.
  submit: () => Promise<AgentExecution>;
  // pending_approvals the response must carry after this decision: 0 for a
  // single gate, 1 for the first approve of two co-pending calls.
  expectedRemaining: number;
  // Names the decision in the contract assertion's failure message.
  label: string;
}

// Submits per the contract and returns the response the contract held on.
export async function submitApprovalPerContract(
  opts: SubmitApprovalPerContractOptions,
): Promise<AgentExecution> {
  const response = await opts.submit();
  expect(response.status?.pendingApprovals.length, opts.label).toBe(opts.expectedRemaining);
  return response;
}

// Root and sub-agent transcripts, the same scan the server's pending-approval
// projection runs — the REJECT arm reads the decided tool call through it.
export function allToolCalls(execution: AgentExecution): ToolCall[] {
  const root = execution.status?.messages.flatMap((message) => message.toolCalls) ?? [];
  const nested =
    execution.status?.subAgentExecutions.flatMap((subAgent) =>
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
