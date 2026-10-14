// Eval runs as the server returns them, for the `eval run` tests. One about
// a plugin: one case run with and without the plugin on Sonnet (one try
// graded, one not graded), and a case listed but not run. One about the
// agent `support-desk` at a stamped version, run with no target named, so
// each case ran on the agent's own model: two plugins whose cases ran (one
// case each passed, the second plugin's second case listed and not run)
// and a third plugin not selected. Each test changes what it pins.

import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { EvalRunSchema, type EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunAblation } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import { EvalRunPhase, EvalRunTryState, type EvalRunCase } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

export const SONNET = { harness: Harness.NATIVE, modelName: "claude-sonnet-4-6" };

export const THERMOS_DIGEST = "d1".padEnd(64, "0");

/** A finished eval run about a plugin: the first case passed with Δ +0.67, the second not run. */
export function finishedEval(phase: EvalRunPhase = EvalRunPhase.completed): EvalRun {
  return create(EvalRunSchema, {
    metadata: { id: "evr_1", org: "acme" },
    spec: {
      subject: { case: "pluginId", value: "plg_1" },
      targets: [SONNET],
      ablation: EvalRunAblation.with_without,
      maxCostUsd: 5,
    },
    status: {
      phase,
      costUsd: 0.41,
      triesTotal: 4,
      triesFinished: 3,
      startedAt: timestampFromMs(1_000_000),
      finishedAt: timestampFromMs(1_074_000),
      aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1, meanDelta: 0.67, casesNotRun: 1 },
      plugins: [
        {
          pluginId: "plg_1",
          pluginSlug: "thermos",
          pluginDigest: THERMOS_DIGEST,
          compared: true,
          aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1, meanDelta: 0.67, casesNotRun: 1 },
          cases: [
            {
              caseName: "first-case",
              path: "evals/first-case",
              notes: ["max_turns 4 raised to the run's minimum of 10 tool rounds"],
              targets: [
                {
                  target: SONNET,
                  withPlugin: {
                    score: 1,
                    gradedTries: 1,
                    perfectRuns: 1,
                    tries: [
                      { index: 1, state: EvalRunTryState.graded, score: 1, runId: "run_w1", costUsd: 0.2 },
                      {
                        index: 2,
                        state: EvalRunTryState.not_graded,
                        notGradedReason: "platform busy",
                        runId: "run_w2",
                      },
                    ],
                  },
                  withoutPlugin: {
                    score: 0.33,
                    gradedTries: 1,
                    tries: [
                      {
                        index: 1,
                        state: EvalRunTryState.graded,
                        score: 0.33,
                        runId: "run_o1",
                        error: "timed out after 300s",
                        costUsd: 0.21,
                      },
                      { index: 2, state: EvalRunTryState.running, runId: "run_o2" },
                    ],
                  },
                  delta: 0.67,
                  passed: true,
                  passK: true,
                },
              ],
            },
            { caseName: "needs-fixture", path: "evals/needs-fixture", notRunReason: "not run: plugins" },
          ],
        },
      ],
    },
  });
}

/** The cases of the plugin of an eval run about a plugin: what most tests change. */
export function casesOf(evalRun: EvalRun): EvalRunCase[] {
  return evalRun.status!.plugins[0]!.cases;
}

/** The agent's own engine and model, as the server labels a case run on it. */
export const AGENT_MODEL = { harness: Harness.NATIVE, modelName: "claude-sonnet-4-6" };

export const VERSION_HASH = "0123456789abcdef".repeat(4);
export const REFUND_DIGEST = "c0ffee".padEnd(64, "1");
export const TRACKER_DIGEST = "beef00".padEnd(64, "2");
export const NOTES_DIGEST = "abcdef".padEnd(64, "3");

/** A finished eval run about an agent: two plugins' cases passed, a case and a plugin not run. */
export function finishedAgentEvalRun(phase: EvalRunPhase = EvalRunPhase.completed): EvalRun {
  return create(EvalRunSchema, {
    metadata: { id: "evr_2", org: "org_acme" },
    spec: { subject: { case: "agentId", value: "agt_1" }, agentVersion: "", maxCostUsd: 5 },
    status: {
      phase,
      agentVersionHash: VERSION_HASH,
      costUsd: 0.5,
      triesTotal: 2,
      triesFinished: 2,
      startedAt: timestampFromMs(1_000_000),
      finishedAt: timestampFromMs(1_042_000),
      aggregates: { overallScore: 1, casesPassed: 2, casesTotal: 2, casesNotRun: 1 },
      plugins: [
        {
          pluginId: "plg_refund",
          pluginSlug: "refund-policy",
          pluginDigest: REFUND_DIGEST,
          attached: true,
          aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1 },
          cases: [
            {
              caseName: "refund-window",
              path: "evals/refund-window",
              targets: [
                {
                  target: AGENT_MODEL,
                  withPlugin: {
                    score: 1,
                    gradedTries: 1,
                    perfectRuns: 1,
                    tries: [{ index: 1, state: EvalRunTryState.graded, score: 1, runId: "run_r1", costUsd: 0.2 }],
                  },
                  passed: true,
                  passK: true,
                },
              ],
            },
          ],
        },
        {
          pluginId: "plg_tracker",
          pluginSlug: "tracker",
          pluginDigest: TRACKER_DIGEST,
          attached: true,
          aggregates: { overallScore: 1, casesPassed: 1, casesTotal: 1, casesNotRun: 1 },
          cases: [
            {
              caseName: "refund-window",
              path: "evals/refund-window",
              targets: [
                {
                  target: AGENT_MODEL,
                  withPlugin: {
                    score: 1,
                    gradedTries: 1,
                    perfectRuns: 1,
                    tries: [{ index: 1, state: EvalRunTryState.graded, score: 1, runId: "run_t1", costUsd: 0.3 }],
                  },
                  passed: true,
                  passK: true,
                },
              ],
            },
            { caseName: "needs-fixture", path: "evals/needs-fixture", notRunReason: "not run: plugins" },
          ],
        },
        { pluginId: "plg_notes", pluginSlug: "notes", pluginDigest: NOTES_DIGEST, attached: true, notRunReason: "not selected" },
      ],
    },
  });
}
