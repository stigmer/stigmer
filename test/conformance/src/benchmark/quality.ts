// Reads a graded agent call's verdict off the terminal WorkflowExecution: the
// judge's score and reasoning, the judge model the eval activity reports it
// used, and the child agent execution's id from the agent task's output.
// Domain: conformance benchmark (the quality cells).
//
// The two task outputs are the runner's and the server's own records
// (runner activities/call-eval.ts `EvalResult` for the judge; the server's
// callback result for the agent call), read as the Struct each task carries
// on `status.tasks[].output`; nothing here restates a constant the run
// already recorded — the judge model on the grade is what the runner used,
// not what the fixture asked for. The stubs render a Struct field as a plain
// JSON object, so the outputs are read as such.
import type { JsonObject } from "@bufbuild/protobuf";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { taskByName } from "../support/workflowexecutions";
import { GRADED_AGENT_TASK_NAME, GRADED_JUDGE_TASK_NAME } from "../support/workflows";
import type { SampleOutcome } from "./report";

export interface Verdict {
  score: number | null;
  reasoning: string;
  judge_model: string;
  agent_execution_id: string;
  outcome: SampleOutcome;
}

export function verdictOf(execution: WorkflowExecution): Verdict {
  const judge: JsonObject = taskByName(execution, GRADED_JUDGE_TASK_NAME)?.output ?? {};
  const agent: JsonObject = taskByName(execution, GRADED_AGENT_TASK_NAME)?.output ?? {};
  const score = judge["score"];
  return {
    score: typeof score === "number" ? score : null,
    reasoning: typeof judge["reasoning"] === "string" ? judge["reasoning"] : "",
    judge_model: typeof judge["model_used"] === "string" ? judge["model_used"] : "",
    agent_execution_id: typeof agent["agent_execution_id"] === "string" ? agent["agent_execution_id"] : "",
    outcome: workflowOutcome(execution.status?.phase),
  };
}

function workflowOutcome(phase: ExecutionPhase | undefined): SampleOutcome {
  switch (phase) {
    case ExecutionPhase.EXECUTION_COMPLETED:
      return "completed";
    case ExecutionPhase.EXECUTION_CANCELLED:
    case ExecutionPhase.EXECUTION_TERMINATED:
      return "cancelled";
    default:
      return "failed";
  }
}