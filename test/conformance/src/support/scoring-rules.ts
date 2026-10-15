// Canonical ScoringRule fixtures and the scoring rule lanes' contract copy for the
// conformance suites.
// Domain: conformance support.
//
// An ScoringRule switches AI grading on for one agent: whether it runs, the
// share of runs sampled, a monthly limit in estimated US dollars and the
// judge's model. The copy constants are cross-edition contract strings,
// byte-pinned in the server (domain/scoring-rule/constants.ts and the judge's
// not-graded reasons in domain/score/constants.ts) and asserted here over the
// wire.
import type { ScoringRuleSchema } from "@stigmer/protos/ai/stigmer/agentic/scoringrule/v1/api_pb";
import type { Score } from "@stigmer/protos/ai/stigmer/agentic/score/v1/api_pb";
import { ScoreState } from "@stigmer/protos/ai/stigmer/agentic/score/v1/enum_pb";
import type { ConformanceClients } from "../harness/clients";
import type { InitShape } from "./init-shape";

export const SCORING_RULE_API_VERSION = "agentic.stigmer.ai/v1";
export const SCORING_RULE_KIND = "ScoringRule";

export const JUDGE = "judge";

// The judge's rubric names, from the rule set the server grades with.
export { ACTED_ONLY_AS_ASKED, ASKED_WHEN_UNCLEAR, DID_THE_TASK, MADE_NOTHING_UP } from "@stigmer/eval-runtime/judge";

// ─── Contract copy (byte-pinned in the server) ─────────────────────────────

export const SCORING_RULE_EXISTS_REASON = "SCORING_RULE_EXISTS";

export const SCORING_RULE_CREATE_DENIED_MESSAGE = "unauthorized to configure grading for agent";

export const SCORING_RULE_AGENT_IMMUTABLE_MESSAGE =
  "spec.agent_id of a scoring rule cannot change; delete it and create one for the other agent";

export function scoringRuleOrgMismatchMessage(agentOrg: string): string {
  return `metadata.org must be the agent's organization (${agentOrg})`;
}

export const JUDGE_LIMIT_REACHED_REASON = "spending limit reached";
export const JUDGE_UNREADABLE_REASON = "the judge's answer could not be read";

export interface ScoringRuleOptions {
  org: string;
  agentId: string;
  enabled?: boolean;
  sampleRate?: number;
  monthlyLimitUsd?: number;
  modelName?: string;
}

// A complete, valid ScoringRule ready to hand to create or update: enabled,
// every run sampled, ten dollars a month, the platform's default model.
export function makeScoringRule(opts: ScoringRuleOptions): InitShape<typeof ScoringRuleSchema> {
  return {
    apiVersion: SCORING_RULE_API_VERSION,
    kind: SCORING_RULE_KIND,
    metadata: { org: opts.org },
    spec: {
      agentId: opts.agentId,
      enabled: opts.enabled ?? true,
      sampleRate: opts.sampleRate ?? 1,
      monthlyLimitUsd: opts.monthlyLimitUsd ?? 10,
      modelName: opts.modelName ?? "",
    },
  };
}

// The run's judge score once it carries a grade or a not-graded reason:
// polled through the run's list, past the pending state the judge writes
// first. A judge takes seconds on the scripted model.
export async function awaitJudgeVerdict(
  clients: ConformanceClients,
  runId: string,
  timeoutMs = 90_000,
): Promise<Score> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const list = await clients.scoreQuery.listByRun({ runId });
    const judge = list.entries.find((score) => score.spec?.metric === JUDGE);
    if (judge !== undefined && judge.status?.state !== ScoreState.pending) {
      return judge;
    }
    if (Date.now() > deadline) {
      throw new Error(`run ${runId} carries no judge verdict after ${timeoutMs} ms`);
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 500));
  }
}

// The judge runs that grade `runId` and are still stored in `org`: none once
// the grading workflow has recorded the grade and deleted the judge's
// session.
export async function judgeRunsOf(
  clients: ConformanceClients,
  org: string,
  runId: string,
): Promise<number> {
  const list = await clients.agentExecutionQuery.list({ org, pageSize: 200 });
  return list.entries.filter((run) => run.metadata?.labels[GRADES_RUN_LABEL] === runId).length;
}

export const GRADES_RUN_LABEL = "stigmer.ai/grades-run";
