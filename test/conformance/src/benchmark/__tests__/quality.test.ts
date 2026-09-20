// Unit arms for the verdict reader, over a hand-built WorkflowExecution whose
// two task outputs carry the shapes the runner and the server write.
// Domain: conformance benchmark.
//
// Pinned: the score, reasoning and `model_used` come off the judge task; the
// child's id comes off the agent task; a missing or non-numeric score is
// null; the outcome follows the workflow's phase.
import { create } from "@bufbuild/protobuf";
import { WorkflowExecutionSchema } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import { describe, expect, it } from "vitest";
import { GRADED_AGENT_TASK_NAME, GRADED_JUDGE_TASK_NAME } from "../../support/workflows";
import { verdictOf } from "../quality";

describe("verdictOf", () => {
  it("reads the grade, the judge's model and the child's id off the two tasks", () => {
    const execution = create(WorkflowExecutionSchema, {
      status: {
        phase: ExecutionPhase.EXECUTION_COMPLETED,
        tasks: [
          {
            taskName: GRADED_AGENT_TASK_NAME,
            output: { agent_execution_id: "aex_child", final_text: "Hello." },
          },
          {
            taskName: GRADED_JUDGE_TASK_NAME,
            output: {
              pass: true,
              score: 0.85,
              reasoning: "Clear and correct.",
              model_used: "claude-sonnet-4-6",
            },
          },
        ],
      },
    });
    expect(verdictOf(execution)).toEqual({
      score: 0.85,
      reasoning: "Clear and correct.",
      judge_model: "claude-sonnet-4-6",
      agent_execution_id: "aex_child",
      outcome: "completed",
    });
  });

  it("a failed run with no judge output reads as a null score and a failed outcome", () => {
    const execution = create(WorkflowExecutionSchema, {
      status: { phase: ExecutionPhase.EXECUTION_FAILED, tasks: [{ taskName: GRADED_AGENT_TASK_NAME }] },
    });
    expect(verdictOf(execution)).toEqual({
      score: null,
      reasoning: "",
      judge_model: "",
      agent_execution_id: "",
      outcome: "failed",
    });
  });
});
