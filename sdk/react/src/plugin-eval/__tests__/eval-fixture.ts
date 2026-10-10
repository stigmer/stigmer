/**
 * A plugin eval built for the Evals tab's tests: one case per entry, each
 * on every target given, the with-arm's first try graded and its second
 * not graded ("platform busy"), the without-arm's one try running.
 */
import { create } from "@bufbuild/protobuf";
import {
  PluginEvalSchema,
  type PluginEval,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/api_pb";
import {
  PluginEvalPhase,
  PluginEvalTryState,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { Harness } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";

export const SONNET = {
  harness: Harness.NATIVE,
  modelName: "claude-sonnet-4-6",
};
export const GPT = { harness: Harness.CURSOR, modelName: "gpt-5" };

export function evalWith(
  scores: {
    readonly name: string;
    readonly score?: number;
    readonly delta?: number;
  }[],
  targets = [SONNET],
  id = "pev_1",
): PluginEval {
  return create(PluginEvalSchema, {
    metadata: { id, org: "acme", name: `thermos evals ${id}` },
    spec: { pluginId: "plg_1", targets, maxCostUsd: 5 },
    status: {
      phase: PluginEvalPhase.completed,
      cases: scores.map((entry) => ({
        caseName: entry.name,
        targets: targets.map((target) => ({
          target,
          withPlugin: {
            score: entry.score,
            tries: [
              {
                index: 1,
                state: PluginEvalTryState.graded,
                score: entry.score ?? 0,
                runId: `run_${entry.name}_1`,
              },
              {
                index: 2,
                state: PluginEvalTryState.not_graded,
                notGradedReason: "platform busy",
                runId: "",
              },
            ],
          },
          withoutPlugin: {
            score: 0.33,
            tries: [
              { index: 1, state: PluginEvalTryState.running, runId: "run_o" },
            ],
          },
          delta: entry.delta,
          passed: (entry.score ?? 0) >= 1,
          passK: false,
        })),
      })),
    },
  });
}
