// Lifecycle control for executions (cancel / terminate / pause / resume).
//
// Mirrors Go's execution.Cancel/Terminate/Pause/Resume (cancel.go + pause.go):
// each verb auto-detects agent vs workflow from the ID prefix, issues the
// matching controller RPC, and returns the resulting phase as a human label.
// The phase is read back from the RPC response so the success line reports the
// authoritative post-mutation state, exactly as the Go CLI does.
//
// These return a plain `{ type, phase }` rather than a CommandResult so the
// command layer owns presentation (single source of the success wording).

import { create } from "@bufbuild/protobuf";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import {
  CancelAgentExecutionInputSchema,
  PauseAgentExecutionInputSchema,
  ResumeAgentExecutionInputSchema,
  TerminateAgentExecutionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/io_pb";
import { ExecutionPhase as WorkflowExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import {
  CancelWorkflowExecutionInputSchema,
  PauseWorkflowExecutionInputSchema,
  ResumeWorkflowExecutionInputSchema,
  TerminateWorkflowExecutionInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/io_pb";
import type { Stigmer } from "@stigmer/sdk";
import { type ExecutionType, formatAgentPhase, formatWorkflowPhase, resolveExecutionType } from "./execution.js";

/** Outcome of a control verb: the resolved type and the post-mutation phase. */
export interface ControlResult {
  readonly type: ExecutionType;
  readonly phase: string;
}

/** Gracefully cancel an execution (agent or workflow). Mirrors Go execution.Cancel. */
export async function cancelExecution(client: Stigmer, id: string, reason: string): Promise<ControlResult> {
  const type = resolveExecutionType(id);
  if (type === "agent") {
    const result = await client.agentExecution.cancel(create(CancelAgentExecutionInputSchema, { id, reason }));
    return { type, phase: formatAgentPhase(result.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) };
  }
  const result = await client.workflowExecution.cancel(create(CancelWorkflowExecutionInputSchema, { id, reason }));
  return { type, phase: formatWorkflowPhase(result.status?.phase ?? WorkflowExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) };
}

/** Force-stop an execution immediately (agent or workflow). Mirrors Go execution.Terminate. */
export async function terminateExecution(client: Stigmer, id: string, reason: string): Promise<ControlResult> {
  const type = resolveExecutionType(id);
  if (type === "agent") {
    const result = await client.agentExecution.terminate(create(TerminateAgentExecutionInputSchema, { id, reason }));
    return { type, phase: formatAgentPhase(result.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) };
  }
  const result = await client.workflowExecution.terminate(create(TerminateWorkflowExecutionInputSchema, { id, reason }));
  return { type, phase: formatWorkflowPhase(result.status?.phase ?? WorkflowExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) };
}

/** Pause a running execution (agent or workflow). Mirrors Go execution.Pause. */
export async function pauseExecution(client: Stigmer, id: string, reason: string): Promise<ControlResult> {
  const type = resolveExecutionType(id);
  if (type === "agent") {
    const result = await client.agentExecution.pause(create(PauseAgentExecutionInputSchema, { id, reason }));
    return { type, phase: formatAgentPhase(result.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) };
  }
  const result = await client.workflowExecution.pause(create(PauseWorkflowExecutionInputSchema, { id, reason }));
  return { type, phase: formatWorkflowPhase(result.status?.phase ?? WorkflowExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) };
}

/** Resume a paused execution (agent or workflow). Mirrors Go execution.Resume (no reason). */
export async function resumeExecution(client: Stigmer, id: string): Promise<ControlResult> {
  const type = resolveExecutionType(id);
  if (type === "agent") {
    const result = await client.agentExecution.resume(create(ResumeAgentExecutionInputSchema, { id }));
    return { type, phase: formatAgentPhase(result.status?.phase ?? ExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) };
  }
  const result = await client.workflowExecution.resume(create(ResumeWorkflowExecutionInputSchema, { id }));
  return { type, phase: formatWorkflowPhase(result.status?.phase ?? WorkflowExecutionPhase.EXECUTION_PHASE_UNSPECIFIED) };
}
