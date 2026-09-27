// The judge of a quality task: hands a composed subject (subject.ts) to the
// platform's own `eval` task in a set_vars -> eval workflow
// (support/workflows.ts makeEvalWorkflow), and reads its verdict off the
// terminal WorkflowExecution.
// Domain: conformance benchmark (the quality cells' grade).
//
// The judge is a pinned model in EVAL_MULTI_CRITERIA mode: it scores each of
// the task's criteria 0..1, and the eval weights them into one score. The
// threshold is 0 and the policy EVAL_FAIL_WARN, so a low grade is a recorded
// number and never a failed run; the benchmark wants the number, not a
// verdict on it.
//
// The verdict is read STRICTLY, because the eval's own parse is lenient in
// ways a benchmark must not inherit (runner activities/call-eval.ts): an
// unparseable reply yields an empty criteria list and a score of 0, and the
// weighted score is taken over whichever criteria the judge happened to
// return, so a skipped criterion silently changes the scale. So the criteria
// returned must be exactly the rubric's, each once. Otherwise the grade is
// refused (`failure.stage: "judge"`, `score: null`), never read as a number.
// The judge model on the grade is the one the eval reports it used, not the
// one the benchmark asked for.
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import type { WorkflowExecution } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/api_pb";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/workflowexecution/v1/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import type { FixtureTracker } from "../harness/fixtures";
import { awaitTerminal, makeWorkflowExecution, taskByName } from "../support/workflowexecutions";
import { EVAL_TASK_NAME, makeEvalWorkflow } from "../support/workflows";
import { uniqueName } from "../support/naming";
import type { QualityCriterion, QualityTask } from "./quality-tasks";
import type { CriterionGrade, SampleFailure, SampleOutcome } from "./report";

export interface Verdict {
  score: number | null;
  criteria: CriterionGrade[];
  reasoning: string;
  judge_model: string;
  outcome: SampleOutcome;
  failure?: SampleFailure;
}

export interface JudgeRequest {
  org: string;
  task: QualityTask;
  subject: string;
  judgeModel: string;
  timeoutMs: number;
}

/** Grades `subject` against the task's rubric; the workflow and its run are deferred for cleanup on `fixtures`. */
export async function judge(
  clients: ConformanceClients,
  fixtures: FixtureTracker,
  request: JudgeRequest,
): Promise<Verdict & { workflow_execution_id: string }> {
  const workflow = await clients.workflowCommand.create(
    makeEvalWorkflow({
      org: request.org,
      name: uniqueName("bench-judge"),
      subject: request.subject,
      rubric: request.task.rubric,
      scoringMode: "EVAL_MULTI_CRITERIA",
      threshold: 0,
      onFail: "EVAL_FAIL_WARN",
      model: request.judgeModel,
      criteria: request.task.criteria,
    }),
  );
  fixtures.defer(() => clients.workflowCommand.delete({ value: workflow.metadata!.id }));
  const execution = await clients.workflowExecutionCommand.create(
    makeWorkflowExecution({ org: request.org, name: uniqueName("bench-judge-run"), workflowId: workflow.metadata!.id }),
  );
  const executionId = execution.metadata!.id;
  fixtures.defer(() => clients.workflowExecutionCommand.delete({ value: executionId }));
  try {
    return { ...verdictOf(await awaitTerminal(clients, executionId, { timeoutMs: request.timeoutMs }), request.task.criteria), workflow_execution_id: executionId };
  } catch (error) {
    return {
      ...refused(`the judge workflow did not reach a terminal phase: ${error instanceof Error ? error.message : String(error)}`, "timeout"),
      workflow_execution_id: executionId,
    };
  }
}

/** The verdict on a terminal judge workflow, refused unless its criteria are exactly `rubric`'s. */
export function verdictOf(execution: WorkflowExecution, rubric: readonly QualityCriterion[]): Verdict {
  const outcome = workflowOutcome(execution.status?.phase);
  if (outcome !== "completed") {
    return refused(execution.status?.error || `the judge workflow ended ${outcome}`, outcome);
  }
  const output: JsonObject = taskByName(execution, EVAL_TASK_NAME)?.output ?? {};
  const judgeModel = typeof output["model_used"] === "string" ? output["model_used"] : "";
  const score = output["score"];
  const returned = Array.isArray(output["criteria"]) ? output["criteria"].map(criterionOf) : [];

  const wanted = rubric.map((criterion) => criterion.name);
  const got = returned.map((criterion) => criterion?.name ?? "?");
  const exact =
    returned.every((criterion) => criterion !== undefined) &&
    got.length === wanted.length &&
    new Set(got).size === got.length &&
    wanted.every((name) => got.includes(name));
  if (!exact || typeof score !== "number") {
    return {
      ...refused(`the judge returned criteria ${JSON.stringify(got)} for a rubric of ${JSON.stringify(wanted)}`, "failed"),
      judge_model: judgeModel,
    };
  }

  const grades = rubric.map((criterion): CriterionGrade => {
    const grade = returned.find((entry) => entry?.name === criterion.name)!;
    return { name: criterion.name, weight: criterion.weight, score: grade.score, reasoning: grade.reasoning };
  });
  return {
    score,
    criteria: grades,
    reasoning: typeof output["reasoning"] === "string" ? output["reasoning"] : "",
    judge_model: judgeModel,
    outcome: "completed",
  };
}

function criterionOf(value: JsonValue): { name: string; score: number; reasoning: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { name, score, reasoning } = value;
  if (typeof name !== "string" || typeof score !== "number") return undefined;
  return { name, score, reasoning: typeof reasoning === "string" ? reasoning : "" };
}

function refused(message: string, outcome: SampleOutcome): Verdict {
  return { score: null, criteria: [], reasoning: "", judge_model: "", outcome, failure: { stage: "judge", message } };
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
