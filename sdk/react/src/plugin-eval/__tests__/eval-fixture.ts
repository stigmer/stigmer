/**
 * A plugin eval built for the Evals tab's tests: one case per entry, each
 * on every target given, the with-arm's first try graded and its second
 * not graded ("platform busy"), the without-arm's one try running. It is
 * named by its id, as the server names an eval the client sent unnamed,
 * and started at {@link evalStartOf} its id, so two evals read apart.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
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

/** When the fixture's eval `id` started: 2026-10-10 05:40 UTC, plus the id's digits in seconds. */
export function evalStartOf(id: string): Date {
  return new Date(Date.UTC(2026, 9, 10, 5, 40, Number(id.replace(/\D/g, "") || "0")));
}

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
    metadata: { id, org: "acme", name: id },
    spec: { pluginId: "plg_1", targets, maxCostUsd: 5 },
    status: {
      phase: PluginEvalPhase.completed,
      audit: { specAudit: { createdAt: timestampFromMs(evalStartOf(id).getTime()) } },
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
