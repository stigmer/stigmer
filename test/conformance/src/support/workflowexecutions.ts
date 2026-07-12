// Canonical WorkflowExecution fixtures + execution polling helpers.
// Domain: conformance support (execution engine).
//
// A WorkflowExecution is created against a Workflow's wfl_ id; the server
// resolves the {slug}-default instance and dispatches to the runner. Unlike the
// flat CRUD resources, an execution is a *running thing* — so this module also
// owns the poll-don't-sleep helpers the execution suites use to await a phase,
// shared so the smoke test and the domain suite gate on one definition.
import type { MessageInitShape } from "@bufbuild/protobuf";
import type { WorkflowExecution, WorkflowTask } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import {
  ExecutionPhase,
  WorkflowTaskStatus,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import { type ExecutionValueInit, makeExecutionValues } from "./executioncontexts";
import { type PollCoreOptions, pollUntil } from "./execution-poll";

export const WORKFLOW_EXECUTION_API_VERSION = "agentic.stigmer.ai/v1";
export const WORKFLOW_EXECUTION_KIND = "WorkflowExecution";

export interface WorkflowExecutionOptions {
  org: string;
  name: string;
  // The wfl_ id returned by Workflow.create; the server resolves its default
  // instance. Provide this OR workflowInstanceId (the create handler requires
  // one of the two).
  workflowId?: string;
  // The wfi_ id of an explicit WorkflowInstance. When set, the server uses this
  // instance's environment_refs for the env merge instead of auto-resolving the
  // workflow's default instance (create.go skips default-instance creation).
  workflowInstanceId?: string;
  triggerMessage?: string;
  // Execution-scoped env overrides (spec.runtime_env) — the highest-precedence
  // layer of the env merge, materialized into the ExecutionContext at create.
  runtimeEnv?: Record<string, ExecutionValueInit>;
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
      ...(opts.workflowId !== undefined ? { workflowId: opts.workflowId } : {}),
      ...(opts.workflowInstanceId !== undefined ? { workflowInstanceId: opts.workflowInstanceId } : {}),
      ...(opts.triggerMessage !== undefined ? { triggerMessage: opts.triggerMessage } : {}),
      ...(opts.runtimeEnv !== undefined ? { runtimeEnv: makeExecutionValues(opts.runtimeEnv) } : {}),
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

// Looks up a task in an execution's per-task status array by its workflow name.
// The HITL gate is observed and resolved by task_name, so the suite reads tasks
// through this rather than positional indexing.
export function taskByName(exec: WorkflowExecution, taskName: string): WorkflowTask | undefined {
  return exec.status?.tasks.find((t) => t.taskName === taskName);
}

// Polls get() until the named task reaches `status`, returning the execution at
// that point. Fails fast (rather than burning the full timeout) if the execution
// reaches a terminal phase before the task does: a run that errors instead of
// reaching the expected task status is a real failure the caller wants surfaced
// immediately with a precise message. The TS analogue of the Go integration
// harness's WaitForTaskWaitingApproval.
export async function awaitTaskStatus(
  clients: ConformanceClients,
  executionId: string,
  taskName: string,
  status: WorkflowTaskStatus,
  opts: PollOptions = {},
): Promise<WorkflowExecution> {
  const exec = await pollExecution(
    clients,
    executionId,
    (e) => taskByName(e, taskName)?.status === status || isTerminalPhase(e.status?.phase),
    { label: `task ${taskName} status ${WorkflowTaskStatus[status]}`, ...opts },
  );

  const observed = taskByName(exec, taskName)?.status;
  if (observed !== status) {
    const phase = exec.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
    throw new Error(
      `execution ${executionId} reached terminal phase ${ExecutionPhase[phase]} ` +
        `before task ${taskName} reached ${WorkflowTaskStatus[status]} ` +
        `(task status: ${observed === undefined ? "absent" : WorkflowTaskStatus[observed]})`,
    );
  }
  return exec;
}

// Convenience: await the human_input gate (task at WORKFLOW_TASK_WAITING_APPROVAL).
export function awaitTaskWaitingApproval(
  clients: ConformanceClients,
  executionId: string,
  taskName: string,
  opts: PollOptions = {},
): Promise<WorkflowExecution> {
  return awaitTaskStatus(clients, executionId, taskName, WorkflowTaskStatus.WORKFLOW_TASK_WAITING_APPROVAL, opts);
}

// Polls get() until the execution surfaces a child agent's approval gate at the
// workflow level (status.pending_approvals non-empty — the child_approval_required
// signal has propagated). Fails fast if the execution reaches a terminal phase
// first, so a run that finishes without ever surfacing the gate is reported
// immediately rather than burning the full timeout. This is the parent-level
// analogue of awaitTaskWaitingApproval, and only fires on editions that emit the
// signal (capability workflowChildApprovalForwarding; see DD-012).
export async function awaitParentPendingApproval(
  clients: ConformanceClients,
  executionId: string,
  opts: PollOptions = {},
): Promise<WorkflowExecution> {
  const exec = await pollExecution(
    clients,
    executionId,
    (e) => (e.status?.pendingApprovals.length ?? 0) > 0 || isTerminalPhase(e.status?.phase),
    { label: "a child approval surfaced at the workflow level", ...opts },
  );

  if ((exec.status?.pendingApprovals.length ?? 0) === 0) {
    const phase = exec.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED;
    throw new Error(
      `execution ${executionId} reached terminal phase ${ExecutionPhase[phase]} ` +
        "before surfacing a child agent approval in status.pending_approvals",
    );
  }
  return exec;
}
