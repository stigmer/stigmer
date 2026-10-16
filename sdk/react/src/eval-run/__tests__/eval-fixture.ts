/**
 * An eval run about a plugin built for the Evals tab's tests: the plugin
 * `thermos` with one case per entry, each on every target given, the
 * with-arm's first try graded and its second not graded ("platform
 * busy"), the without-arm's one try running. It is named by its id, as the
 * server names an eval run the client sent unnamed, and started at
 * {@link evalStartOf} its id, so two eval runs read apart.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  EvalRunSchema,
  type EvalRun,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunAblation } from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/spec_pb";
import {
  EvalRunPhase,
  EvalRunTryState,
} from "@stigmer/apis/ai/stigmer/agentic/evalrun/v1/status_pb";
import { Harness } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

export const SONNET = {
  harness: Harness.NATIVE,
  modelName: "claude-sonnet-4-6",
};
export const GPT = { harness: Harness.CURSOR, modelName: "gpt-5" };

/** When the fixture's eval run `id` started: 2026-10-10 05:40 UTC, plus the id's digits in seconds. */
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
  id = "evr_1",
): EvalRun {
  return create(EvalRunSchema, {
    metadata: { id, org: "acme", name: id },
    spec: {
      subject: { case: "pluginId", value: "plg_1" },
      targets,
      ablation: EvalRunAblation.with_without,
      maxCostUsd: 5,
    },
    status: {
      phase: EvalRunPhase.completed,
      audit: { specAudit: { createdAt: timestampFromMs(evalStartOf(id).getTime()) } },
      plugins: [
        {
          pluginId: "plg_1",
          pluginSlug: "thermos",
          pluginDigest: "d1".padEnd(64, "0"),
          compared: true,
          cases: casesOf(scores, targets),
        },
      ],
    },
  });
}

/** The fixture's cases: one per entry, each on every target given. */
function casesOf(
  scores: readonly {
    readonly name: string;
    readonly score?: number;
    readonly delta?: number;
  }[],
  targets: readonly (typeof SONNET)[],
) {
  return scores.map((entry) => ({
        caseName: entry.name,
        targets: targets.map((target) => ({
          target,
          withPlugin: {
            score: entry.score,
            tries: [
              {
                index: 1,
                state: EvalRunTryState.graded,
                score: entry.score ?? 0,
                runId: `run_${entry.name}_1`,
              },
              {
                index: 2,
                state: EvalRunTryState.not_graded,
                notGradedReason: "platform busy",
                runId: "",
              },
            ],
          },
          withoutPlugin: {
            score: 0.33,
            tries: [
              { index: 1, state: EvalRunTryState.running, runId: "run_o" },
            ],
          },
          delta: entry.delta,
          passed: (entry.score ?? 0) >= 1,
          passK: false,
        })),
      }));
}
