// Canonical WorkflowExecution fixtures + execution polling helpers.
// Domain: conformance support (execution engine).
//
// A WorkflowExecution is created against a Workflow's wfl_ id; the server
// resolves the {slug}-default instance and dispatches to the runner. Unlike the
// flat CRUD resources, an execution is a *running thing* — so this module also
// owns the poll-don't-sleep helpers the execution suites use to await a phase,
// shared so the smoke test and the domain suite gate on one definition.
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import { type PollCoreOptions, pollUntil } from "./execution-poll";

export const WORKFLOW_EXECUTION_API_VERSION = "agentic.stigmer.ai/v1";
export const WORKFLOW_EXECUTION_KIND = "WorkflowExecution";

export interface WorkflowExecutionOptions {
  org: string;
  name: string;
  // The wfl_ id returned by Workflow.create; the server resolves its default instance.
  workflowId: string;
  triggerMessage?: string;
}

// A complete, valid WorkflowExecution create request. execution_target is left
// unset (-> LOCAL -> the stigmer_runner queue).
export function makeWorkflowExecution(
  opts: WorkflowExecutionOptions,
): MessageInitShape<typeof WorkflowExecutionSchema> {
  return {
    apiVersion: WORKFLOW_EXECUTION_API_VERSION,
    kind: WORKFLOW_EXECUTION_KIND,
    metadata: { name: opts.name, org: opts.org },
    spec: {
      workflowId: opts.workflowId,
      ...(opts.triggerMessage !== undefined ? { triggerMessage: opts.triggerMessage } : {}),
    },
  };
}

// Terminal = the engine will never move the phase again. PAUSED is NOT terminal
// (resume revives it); PENDING/IN_PROGRESS are in-flight.
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
// Delegates the timing loop to the shared, enum-agnostic core; this module owns
// only the WorkflowExecution-typed getter and the phase rendering.
export function pollExecution(
  clients: ConformanceClients,
  executionId: string,
  predicate: (exec: WorkflowExecution) => boolean,
  opts: PollOptions = {},
): Promise<WorkflowExecution> {
  return pollUntil(
    () => clients.workflowExecutionQuery.get({ value: executionId }),
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
): Promise<WorkflowExecution> {
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
): Promise<WorkflowExecution> {
  return pollExecution(clients, executionId, (e) => isTerminalPhase(e.status?.phase), {
    label: "a terminal phase",
    ...opts,
  });
}
