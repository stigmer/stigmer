// An agent eval as the server returns it, for the `agent eval` tests: the
// agent `support-desk` at a stamped version, run with no target named, so
// each case ran on the agent's own model; two plugins whose cases ran (one
// case each passed, the second plugin's second case listed and not run)
// and a third plugin not selected. Each test changes what it pins.

import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import { AgentEvalSchema, type AgentEval } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { PluginEvalPhase, PluginEvalTryState } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

/** The agent's own engine and model, as the server labels a case run on it. */
export const AGENT_MODEL = { harness: Harness.NATIVE, modelName: "claude-sonnet-4-6" };

export const VERSION_HASH = "0123456789abcdef".repeat(4);
export const REFUND_DIGEST = "c0ffee".padEnd(64, "1");
export const TRACKER_DIGEST = "beef00".padEnd(64, "2");
export const NOTES_DIGEST = "abcdef".padEnd(64, "3");

/** A finished agent eval: two plugins' cases passed, a case and a plugin not run. */
export function finishedAgentEval(phase: PluginEvalPhase = PluginEvalPhase.completed): AgentEval {
  return create(AgentEvalSchema, {
    metadata: { id: "aev_1", org: "org_acme" },
    spec: { agentId: "agt_1", agentVersion: "", maxCostUsd: 5 },
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
                    tries: [{ index: 1, state: PluginEvalTryState.graded, score: 1, runId: "run_r1", costUsd: 0.2 }],
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
                    tries: [{ index: 1, state: PluginEvalTryState.graded, score: 1, runId: "run_t1", costUsd: 0.3 }],
                  },
                  passed: true,
                  passK: true,
                },
              ],
            },
            { caseName: "needs-fixture", path: "evals/needs-fixture", notRunReason: "not run: plugins" },
          ],
        },
        { pluginId: "plg_notes", pluginSlug: "notes", pluginDigest: NOTES_DIGEST, notRunReason: "not selected" },
      ],
    },
  });
}
