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
// so both execution domains share one definition.
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { AgentExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import type { McpToolFixture } from "../harness/mcp-server";
import type { MockLlmProxy } from "../harness/mock-llm";
import type { TargetProfile } from "../targets/target";
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
  // The user message that triggers the run; must be non-empty (proto min_len=1).
  message?: string;
  // Runtime bypass of all tool-approval gates (spec.auto_approve_all). Omitted =
  // gates apply; true = the run never pauses for approval. The top of the
  // approval-policy chain.
  autoApproveAll?: boolean;
}

// A complete, valid AgentExecution create request. execution_config is left unset
// (the runner picks defaults), so the only variable inputs are the reference, the
// message, and the optional auto-approve bypass.
export function makeAgentExecution(opts: AgentExecutionOptions): MessageInitShape<typeof AgentExecutionSchema> {
  return {
    apiVersion: AGENT_EXECUTION_API_VERSION,
    kind: AGENT_EXECUTION_KIND,
    metadata: { name: opts.name, org: opts.org },
    spec: {
      ...(opts.agentId !== undefined ? { agentId: opts.agentId } : {}),
      ...(opts.sessionId !== undefined ? { sessionId: opts.sessionId } : {}),
      message: opts.message ?? "Say hello.",
      ...(opts.autoApproveAll !== undefined ? { autoApproveAll: opts.autoApproveAll } : {}),
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
// Throws with the last observed phase on timeout (never sleeps blindly).
export function pollExecution(
  clients: ConformanceClients,
  executionId: string,
  predicate: (exec: AgentExecution) => boolean,
  opts: PollOptions = {},
): Promise<AgentExecution> {
  return pollUntil(
    () => clients.agentExecutionQuery.get({ value: executionId }),
    predicate,
    (last, timeoutMs) => {
      const phase = last?.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
      return (
        `execution ${executionId} did not satisfy ${opts.label ?? "the predicate"} ` +
        `within ${timeoutMs}ms (last phase: ${ExecutionPhase[phase]})`
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

// Obtain the mock LLM proxy from an execution target, failing loudly if the
// active target does not provide one (e.g. a CRUD or cloud target). Agent
// execution suites must run against local-go-execution.
export function requireLlmProxy(target: TargetProfile): MockLlmProxy {
  if (target.llmProxy === undefined) {
    throw new Error(
      `target ${target.name} does not provide a mock LLM proxy; ` +
        "agent execution suites require the local-go-execution target",
    );
  }
  return target.llmProxy();
}

// Obtain the HTTP MCP tool fixture from an execution target, failing loudly if
// the active target does not provide one. Tool-using (HITL) agent suites must
// run against local-go-execution.
export function requireMcpFixture(target: TargetProfile): McpToolFixture {
  if (target.mcpFixture === undefined) {
    throw new Error(
      `target ${target.name} does not provide an MCP tool fixture; ` +
        "tool-using agent suites require the local-go-execution target",
    );
  }
  return target.mcpFixture();
}
