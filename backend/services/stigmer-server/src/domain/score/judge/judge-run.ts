/**
 * The judge run: the one run the grading workflow creates to grade a
 * completed run with an AI judge, and the one predicate every reader uses
 * to tell such a run apart.
 *
 * A judge run is an ordinary run, so billing, the out-of-credit refusal,
 * an organization's own provider keys, pricing, the cost cap and the model
 * stack all apply to it unchanged. What makes it a judge is one reserved
 * label, `stigmer.ai/grades-run = <judged run id>`, which the server
 * writes and a client may not introduce wherever the edition guards
 * reserved labels (pipeline/steps/guard-reserved-labels.ts; the hosted
 * edition admits only its operators). Where a client can write it, all it
 * buys is a tool-less, memory-less run of its own that is not graded. Its
 * readers:
 *
 *   - the runner, which swaps in its built-in judge (code-defined, every
 *     built-in tool denied, no MCP server, skill or sub-agent) for the
 *     built-in assistant (the runner's shared/builtin-judge.ts carries the
 *     same key);
 *   - the run create chain's two compose steps, which compose no standing
 *     context and no memories for a judge (domain/run/create-steps.ts);
 *   - the grading observer and the judge planner, which grade no judge run.
 *
 * The grading workflow's start finds a judge run by this label only
 * through the run list index's `grades` key (domain/run/list-index.ts),
 * never by findAllByLabel, which scans the run kind. The workflow owns the
 * judge run's session and deletes it when the grade is recorded.
 *
 * Proven by __tests__/judge.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import type { JsonObject } from "@bufbuild/protobuf";

import { RunSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import type { Run } from "@stigmer/protos/ai/stigmer/agentic/run/v1/api_pb";
import { RunConfigSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/invocation_pb";
import { RunSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/run/v1/spec_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import { SessionSpecSchema } from "@stigmer/protos/ai/stigmer/agentic/session/v1/spec_pb";
import { ApiResourceMetadataSchema } from "@stigmer/protos/ai/stigmer/commons/apiresource/metadata_pb";

/**
 * The reserved label that marks a judge run, valued with the judged run's
 * id. Wire contract: the runner reads the same key.
 */
export const GRADES_RUN_LABEL = "stigmer.ai/grades-run";

/**
 * The judge session's subject. Set, so the run makes no titling call; the
 * session is deleted when the grade is recorded, so nobody reads it.
 */
export const JUDGE_SESSION_SUBJECT = "Grading";

/**
 * The most one grade may spend, in estimated US dollars: the judge run's
 * `max_cost_usd`, and what the evaluator's budget sets aside before the
 * judge starts (domain/evaluator/budget.ts).
 */
export const PER_GRADE_CAP_USD = 0.25;

/** Whether `run` is a judge run (the module header). */
export function isJudgeRun(run: Pick<Run, "metadata"> | undefined): boolean {
  return (run?.metadata?.labels[GRADES_RUN_LABEL] ?? "") !== "";
}

/**
 * The judge run's name, fixed by the judged run's id so the row says what
 * it grades. Names are not unique and nothing finds a judge run by its
 * name: a retried start finds an earlier attempt's run by its label. A run
 * id is slug-shaped once lowercased with its underscores made hyphens.
 */
export function judgeRunName(judgedRunId: string): string {
  return `grade-${judgedRunId.toLowerCase().replaceAll("_", "-")}`;
}

export interface JudgeRunRequest {
  /** The completed run being graded. */
  readonly judged: Run;
  /** The judge's model; empty for the platform's default. */
  readonly modelName: string;
  /** The rubrics and the fenced subject (rubrics.ts, judgeMessage). */
  readonly message: string;
  /** The verdict's shape (rubrics.ts, VERDICT_SCHEMA). */
  readonly verdictSchema: JsonObject;
}

/**
 * The judge run's create request: a new session of its own on the native
 * harness, in the judged run's organization (so that organization's
 * credit pays, and the hosted edition's create gate refuses it when the
 * credit is out), capped at one grade's cost.
 */
export function judgeRunRequest(request: JudgeRunRequest): Run {
  const judgedId = request.judged.metadata?.id ?? "";
  return create(RunSchema, {
    apiVersion: "agentic.stigmer.ai/v1",
    kind: "Run",
    metadata: create(ApiResourceMetadataSchema, {
      name: judgeRunName(judgedId),
      org: request.judged.metadata?.org ?? "",
      labels: { [GRADES_RUN_LABEL]: judgedId },
    }),
    spec: create(RunSpecSchema, {
      target: {
        case: "sessionSpec",
        value: create(SessionSpecSchema, {
          subject: JUDGE_SESSION_SUBJECT,
          harness: Harness.NATIVE,
        }),
      },
      message: request.message,
      runConfig: create(RunConfigSchema, {
        modelName: request.modelName,
        maxCostUsd: PER_GRADE_CAP_USD,
      }),
      structuredOutputSchema: request.verdictSchema,
    }),
  });
}
