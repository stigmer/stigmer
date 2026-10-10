// A plugin eval as the server returns it, for the `plugin eval` tests: one
// case run with and without the plugin on Sonnet (one try graded, one not
// graded), and a case listed but not run. Each test changes what it pins.

import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { PluginEvalSchema, type PluginEval } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import { PluginEvalAblation } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { PluginEvalPhase, PluginEvalTryState } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

export const SONNET = { harness: Harness.NATIVE, modelName: "claude-sonnet-4-6" };

/** A finished eval: the first case passed with Δ +0.67, the second not run. */
export function finishedEval(phase: PluginEvalPhase = PluginEvalPhase.completed): PluginEval {
  return create(PluginEvalSchema, {
    metadata: { id: "pev_1", org: "acme" },
    spec: { pluginId: "plg_1", targets: [SONNET], ablation: PluginEvalAblation.with_without, maxCostUsd: 5 },
    status: {
      phase,
      costUsd: 0.41,
      provisionalDelta: true,
      triesTotal: 4,
      triesFinished: 3,
      startedAt: timestampFromMs(1_000_000),
      finishedAt: timestampFromMs(1_074_000),
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
                  { index: 1, state: PluginEvalTryState.graded, score: 1, runId: "run_w1", costUsd: 0.2 },
                  {
                    index: 2,
                    state: PluginEvalTryState.not_graded,
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
                    state: PluginEvalTryState.graded,
                    score: 0.33,
                    runId: "run_o1",
                    error: "timed out after 300s",
                    costUsd: 0.21,
                  },
                  { index: 2, state: PluginEvalTryState.running, runId: "run_o2" },
                ],
              },
              delta: 0.67,
              passed: true,
              passK: true,
            },
          ],
        },
        { caseName: "needs-fixture", path: "evals/needs-fixture", notRunReason: "not run: context.scaffold_script" },
      ],
    },
  });
}
