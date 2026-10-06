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
import { RunPhase } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/enum_pb";
import {
  CancelAgentRunInputSchema,
  PauseAgentRunInputSchema,
  ResumeAgentRunInputSchema,
  TerminateAgentRunInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/io_pb";
import { RunPhase as WorkflowExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/enum_pb";
import {
  CancelWorkflowRunInputSchema,
  PauseWorkflowRunInputSchema,
  ResumeWorkflowRunInputSchema,
  TerminateWorkflowRunInputSchema,
} from "@stigmer/protos/ai/stigmer/agentic/workflowrun/v1/io_pb";
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
    const result = await client.agentRun.cancel(create(CancelAgentRunInputSchema, { id, reason }));
    return { type, phase: formatAgentPhase(result.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED) };
  }
  const result = await client.workflowRun.cancel(create(CancelWorkflowRunInputSchema, { id, reason }));
  return { type, phase: formatWorkflowPhase(result.status?.phase ?? WorkflowExecutionPhase.RUN_PHASE_UNSPECIFIED) };
}

/** Force-stop an execution immediately (agent or workflow). Mirrors Go execution.Terminate. */
export async function terminateExecution(client: Stigmer, id: string, reason: string): Promise<ControlResult> {
  const type = resolveExecutionType(id);
  if (type === "agent") {
    const result = await client.agentRun.terminate(create(TerminateAgentRunInputSchema, { id, reason }));
    return { type, phase: formatAgentPhase(result.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED) };
  }
  const result = await client.workflowRun.terminate(create(TerminateWorkflowRunInputSchema, { id, reason }));
  return { type, phase: formatWorkflowPhase(result.status?.phase ?? WorkflowExecutionPhase.RUN_PHASE_UNSPECIFIED) };
}

/** Pause a running execution (agent or workflow). Mirrors Go execution.Pause. */
export async function pauseExecution(client: Stigmer, id: string, reason: string): Promise<ControlResult> {
  const type = resolveExecutionType(id);
  if (type === "agent") {
    const result = await client.agentRun.pause(create(PauseAgentRunInputSchema, { id, reason }));
    return { type, phase: formatAgentPhase(result.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED) };
  }
  const result = await client.workflowRun.pause(create(PauseWorkflowRunInputSchema, { id, reason }));
  return { type, phase: formatWorkflowPhase(result.status?.phase ?? WorkflowExecutionPhase.RUN_PHASE_UNSPECIFIED) };
}

/** Resume a paused execution (agent or workflow). Mirrors Go execution.Resume (no reason). */
export async function resumeExecution(client: Stigmer, id: string): Promise<ControlResult> {
  const type = resolveExecutionType(id);
  if (type === "agent") {
    const result = await client.agentRun.resume(create(ResumeAgentRunInputSchema, { id }));
    return { type, phase: formatAgentPhase(result.status?.phase ?? RunPhase.RUN_PHASE_UNSPECIFIED) };
  }
  const result = await client.workflowRun.resume(create(ResumeWorkflowRunInputSchema, { id }));
  return { type, phase: formatWorkflowPhase(result.status?.phase ?? WorkflowExecutionPhase.RUN_PHASE_UNSPECIFIED) };
}
