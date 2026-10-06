// The judge of a quality task: hands a composed subject (subject.ts) to a
// judge agent as one agent run, and reads its verdict off the terminal run's
// structured output.
// Domain: conformance benchmark (the quality cells' grade).
//
// The judge is an agent made for the one grade: its instructions carry the
// task's rubric and criteria, it has no skills, MCP servers or sub-agents, and
// it runs on the native harness with the pinned judge model in the run's
// settings. The subject is the run's message, and the run's
// `structured_output_schema` names exactly the task's criteria, each a score
// in 0..1 and a reason (`verdictSchema`). One agent and one run per sample,
// both deferred for cleanup.
//
// The verdict is read STRICTLY, because a model's structured reply can still
// miss the schema (the runner's extraction tiers fall back to the reply's
// text), and a skipped criterion read as a lower grade would silently change
// the scale. So the criteria returned must be exactly the rubric's, each a
// score in 0..1. Otherwise the grade is refused (`failure.stage: "judge"`,
// `score: null`), never read as a number. The score is the benchmark's own:
// the mean of the criteria's scores weighted by the task's weights
// (quality-tasks.ts). The judge model on the grade is the one the run reports
// it served, not the one the benchmark asked for.
import type { JsonObject, JsonValue } from "@bufbuild/protobuf";
import type { AgentRun } from "@stigmer/protos/ai/stigmer/agentic/agentrun/v1/api_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import type { FixtureTracker } from "../harness/fixtures";
import { awaitTerminal, makeAgentExecution } from "../support/agentruns";
import { agentRefOf, makeAgent } from "../support/agents";
import { uniqueName } from "../support/naming";
import type { QualityCriterion, QualityTask } from "./quality-tasks";
import type { CriterionGrade, SampleFailure, SampleOutcome } from "./report";
import { outcomeOf } from "./status-facts";

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

/** The judge's session subject: set, so the run spends no call titling it. */
const JUDGE_SESSION_SUBJECT = "benchmark judge";

/** Grades `subject` against the task's rubric; the judge agent and its run are deferred for cleanup on `fixtures`. */
export async function judge(
  clients: ConformanceClients,
  fixtures: FixtureTracker,
  request: JudgeRequest,
): Promise<Verdict & { judge_run_id: string }> {
  const agent = await clients.agentCommand.create(
    makeAgent({
      org: request.org,
      name: uniqueName("bench-judge"),
      description: "Grades one benchmark sample against its rubric",
      instructions: judgeInstructions(request.task),
      harness: Harness.NATIVE,
    }),
  );
  fixtures.defer(() => clients.agentCommand.delete({ value: agent.metadata!.id }));
  const run = await clients.agentExecutionCommand.create(
    makeAgentExecution({
      org: request.org,
      name: uniqueName("bench-judge-run"),
      agentRef: agentRefOf(agent),
      sessionSpec: { subject: JUDGE_SESSION_SUBJECT },
      message: request.subject,
      autoApproveAll: true,
      runConfig: { modelName: request.judgeModel },
      structuredOutputSchema: verdictSchema(request.task.criteria),
    }),
  );
  const runId = run.metadata!.id;
  fixtures.defer(() => clients.agentExecutionCommand.delete({ value: runId }));
  try {
    return { ...verdictOf(await awaitTerminal(clients, runId, { timeoutMs: request.timeoutMs }), request.task.criteria), judge_run_id: runId };
  } catch (error) {
    return {
      ...refused(`the judge run did not reach a terminal phase: ${error instanceof Error ? error.message : String(error)}`, "timeout"),
      judge_run_id: runId,
    };
  }
}

/** The judge agent's instructions: the task's rubric, its criteria, and how to answer. */
export function judgeInstructions(task: QualityTask): string {
  const criteria = task.criteria.map((criterion) => `- ${criterion.name}: ${criterion.description}`).join("\n");
  return [
    "You are an expert evaluator. The user's message is the subject to grade. Do not use any tool; read the subject and answer.",
    "",
    "## Rubric",
    task.rubric,
    "",
    "## Criteria",
    criteria,
    "",
    "## Answer",
    "Score the subject on every criterion above from 0.0 (worst) to 1.0 (best), with a short reason for each score. " +
      "Answer with ONLY a JSON object that has one key per criterion, named exactly as above, " +
      'each holding {"score": <0.0..1.0>, "reasoning": "<why>"}, and no other key.',
  ].join("\n");
}

/** The run's structured output schema: exactly the rubric's criteria, each a score in 0..1 and a reason. */
export function verdictSchema(rubric: readonly QualityCriterion[]): JsonObject {
  return {
    type: "object",
    properties: Object.fromEntries(
      rubric.map((criterion): [string, JsonValue] => [
        criterion.name,
        {
          type: "object",
          description: criterion.description,
          properties: {
            score: { type: "number", minimum: 0, maximum: 1 },
            reasoning: { type: "string" },
          },
          required: ["score", "reasoning"],
          additionalProperties: false,
        },
      ]),
    ),
    required: rubric.map((criterion) => criterion.name),
    additionalProperties: false,
  };
}

/** The verdict on a terminal judge run, refused unless its criteria are exactly `rubric`'s. */
export function verdictOf(run: AgentRun, rubric: readonly QualityCriterion[]): Verdict {
  const outcome = outcomeOf(run.status?.phase);
  if (outcome !== "completed") {
    return refused(run.status?.error || `the judge run ended ${outcome}`, outcome);
  }
  const judgeModel = run.status?.streamingUsage?.model ?? "";
  const output: JsonObject = run.status?.structuredOutput ?? {};

  const wanted = rubric.map((criterion) => criterion.name);
  const got = Object.keys(output);
  const grades = rubric.map((criterion): CriterionGrade | undefined => {
    const grade = gradeOf(output[criterion.name]);
    return grade === undefined ? undefined : { name: criterion.name, weight: criterion.weight, ...grade };
  });
  const exact = got.length === wanted.length && wanted.every((name) => got.includes(name));
  if (!exact || grades.some((grade) => grade === undefined)) {
    return {
      ...refused(`the judge returned criteria ${JSON.stringify(got)} for a rubric of ${JSON.stringify(wanted)}`, "failed"),
      judge_model: judgeModel,
    };
  }

  const graded = grades.filter((grade): grade is CriterionGrade => grade !== undefined);
  return {
    score: weightedScore(graded),
    criteria: graded,
    reasoning: graded.map((grade) => `${grade.name}: ${grade.reasoning}`).join("; "),
    judge_model: judgeModel,
    outcome: "completed",
  };
}

/** The mean of the criteria's scores weighted by the rubric's weights. */
export function weightedScore(grades: readonly CriterionGrade[]): number {
  const totalWeight = grades.reduce((sum, grade) => sum + grade.weight, 0);
  return totalWeight > 0 ? grades.reduce((sum, grade) => sum + grade.score * grade.weight, 0) / totalWeight : 0;
}

function gradeOf(value: JsonValue | undefined): { score: number; reasoning: string } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { score, reasoning } = value;
  if (typeof score !== "number" || score < 0 || score > 1) return undefined;
  return { score, reasoning: typeof reasoning === "string" ? reasoning : "" };
}

function refused(message: string, outcome: SampleOutcome): Verdict {
  return { score: null, criteria: [], reasoning: "", judge_model: "", outcome, failure: { stage: "judge", message } };
}
