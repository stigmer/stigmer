/**
 * A quality report and flagged scores built for the Quality tab's tests.
 *
 * The report covers 2026-09-13 to 2026-10-12 and has three graded days:
 * on 2026-10-01 the agent was unversioned and the AI judge graded under
 * its earlier rules ("judge-v1") only; from 2026-10-05 version
 * "a1b2c3d4e5f6a7b8" ran and the judge graded under "judge-v2" with two
 * rubrics (task, honest). Run health is "health-v1" throughout; thumbs
 * appear from 2026-10-05. The total lists each metric's most recently seen
 * evaluator version first, as the server does. Not a `.test` file:
 * vitest does not collect it.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { ScoreSchema, type Score } from "@stigmer/apis/ai/stigmer/agentic/score/v1/api_pb";
import { CriterionResult } from "@stigmer/apis/ai/stigmer/agentic/score/v1/enum_pb";
import {
  AgentQualityReportSchema,
  type AgentQualityReport,
} from "@stigmer/apis/ai/stigmer/agentic/score/v1/io_pb";

/** The version the agent ran from 2026-10-05. */
export const VERSION_HASH = "a1b2c3d4e5f6a7b8";

interface Tally {
  readonly metric: string;
  readonly evaluatorVersion: string;
  readonly passed: number;
  readonly failed: number;
  readonly notGraded?: number;
  readonly criteria?: readonly {
    readonly name: string;
    readonly passed: number;
    readonly failed: number;
    readonly notApplicable?: number;
  }[];
}

function summary(runs: number, metrics: readonly Tally[]) {
  return {
    runs,
    metrics: metrics.map((tally) => ({
      metric: tally.metric,
      evaluatorVersion: tally.evaluatorVersion,
      passed: tally.passed,
      failed: tally.failed,
      notGraded: tally.notGraded ?? 0,
      pending: 0,
      criteria: (tally.criteria ?? []).map((criterion) => ({
        name: criterion.name,
        passed: criterion.passed,
        failed: criterion.failed,
        notApplicable: criterion.notApplicable ?? 0,
      })),
    })),
  };
}

const OCT_01 = summary(6, [
  { metric: "judge", evaluatorVersion: "judge-v1", passed: 2, failed: 0, criteria: [{ name: "task", passed: 2, failed: 0 }] },
  { metric: "run-health", evaluatorVersion: "health-v1", passed: 5, failed: 1 },
]);

const OCT_05 = summary(3, [
  { metric: "feedback", evaluatorVersion: "", passed: 2, failed: 0 },
  {
    metric: "judge",
    evaluatorVersion: "judge-v2",
    passed: 2,
    failed: 1,
    criteria: [
      { name: "task", passed: 2, failed: 1 },
      { name: "honest", passed: 3, failed: 0 },
    ],
  },
  { metric: "run-health", evaluatorVersion: "health-v1", passed: 3, failed: 0 },
]);

const OCT_10 = summary(3, [
  { metric: "feedback", evaluatorVersion: "", passed: 1, failed: 1 },
  {
    metric: "judge",
    evaluatorVersion: "judge-v2",
    passed: 1,
    failed: 2,
    criteria: [
      { name: "task", passed: 1, failed: 2 },
      { name: "honest", passed: 2, failed: 0, notApplicable: 1 },
    ],
  },
  { metric: "run-health", evaluatorVersion: "health-v1", passed: 2, failed: 1 },
]);

/** The fixture's report. */
export function qualityReport(): AgentQualityReport {
  return create(AgentQualityReportSchema, {
    fromDate: "2026-09-13",
    toDate: "2026-10-12",
    total: summary(12, [
      { metric: "feedback", evaluatorVersion: "", passed: 3, failed: 1 },
      {
        metric: "judge",
        evaluatorVersion: "judge-v2",
        passed: 3,
        failed: 3,
        criteria: [
          { name: "task", passed: 3, failed: 3 },
          { name: "honest", passed: 5, failed: 0, notApplicable: 1 },
        ],
      },
      { metric: "judge", evaluatorVersion: "judge-v1", passed: 2, failed: 0, criteria: [{ name: "task", passed: 2, failed: 0 }] },
      { metric: "run-health", evaluatorVersion: "health-v1", passed: 10, failed: 2 },
    ]),
    days: [
      { date: "2026-10-01", summary: OCT_01 },
      { date: "2026-10-05", summary: OCT_05 },
      { date: "2026-10-10", summary: OCT_10 },
    ],
    versions: [
      {
        agentVersionHash: VERSION_HASH,
        firstDate: "2026-10-05",
        lastDate: "2026-10-10",
        summary: summary(6, [
          { metric: "feedback", evaluatorVersion: "", passed: 3, failed: 1 },
          {
            metric: "judge",
            evaluatorVersion: "judge-v2",
            passed: 3,
            failed: 3,
            criteria: [
              { name: "task", passed: 3, failed: 3 },
              { name: "honest", passed: 5, failed: 0, notApplicable: 1 },
            ],
          },
          { metric: "run-health", evaluatorVersion: "health-v1", passed: 5, failed: 1 },
        ]),
      },
      { agentVersionHash: "", firstDate: "2026-10-01", lastDate: "2026-10-01", summary: OCT_01 },
    ],
  });
}

/** A report for an agent with no graded run in the window. */
export function emptyReport(): AgentQualityReport {
  return create(AgentQualityReportSchema, {
    fromDate: "2026-09-13",
    toDate: "2026-10-12",
    total: { runs: 0, metrics: [] },
  });
}

/**
 * A flagged score: `metric` failed on `runId`, with `failed` the names of
 * its failed criteria. Each criterion carries a reason and the score a
 * comment, which the view must never show.
 */
export function flaggedScore(
  id: string,
  metric: string,
  runId: string,
  failed: readonly string[] = [],
  versionHash: string = VERSION_HASH,
): Score {
  return create(ScoreSchema, {
    metadata: { id, org: "org_acme", name: id },
    spec: {
      runId,
      metric,
      value: { case: "passed", value: false },
      comment: "the conversation said something private",
      criteria: [
        ...failed.map((name) => ({
          name,
          result: CriterionResult.failed,
          reason: `private reason for ${name}`,
        })),
        { name: "steady", result: CriterionResult.passed, reason: "fine" },
      ],
    },
    status: {
      agentId: "agt_1",
      agentVersionHash: versionHash,
      audit: { specAudit: { createdAt: timestampFromMs(Date.UTC(2026, 9, 10, 12)) } },
    },
  });
}
