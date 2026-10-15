/**
 * An eval run about an agent built for the Evals tab's tests: one plugin
 * block per entry, each case on every target given with one arm (with the
 * plugin): its first try graded with the case's score and a run, its
 * second not graded ("platform busy") with no run. A plugin given a
 * `notRun` reason has no cases. Named by its id, as the server names an
 * eval run the client sent unnamed, stamped with `version` and started at
 * eval-fixture.ts's {@link evalStartOf} its id, so two eval runs read
 * apart. `compared` names the slug of a plugin compared.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  EvalRunSchema,
  type EvalRun,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import {
  EvalRunAblation,
  type EvalRunTarget,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/spec_pb";
import {
  EvalRunPhase,
  EvalRunTryState,
} from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { evalStartOf } from "./eval-fixture";

export { evalStartOf };

/** A 64-character digest starting with `prefix`. */
export function digestOf(prefix: string): string {
  return prefix.padEnd(64, "0");
}

/** One plugin block of the fixture. */
export interface FixturePlugin {
  readonly slug: string;
  readonly digest?: string;
  readonly notRun?: string;
  readonly cases?: readonly { readonly name: string; readonly score?: number }[];
  /** Whether the agent attaches it. @default true */
  readonly attached?: boolean;
}

export function agentEvalRunWith(
  plugins: readonly FixturePlugin[],
  opts: {
    readonly id?: string;
    readonly version?: string;
    readonly targets?: readonly EvalRunTarget[];
    /** The target every case ran on when the spec names none: the agent as it runs. */
    readonly caseTargets?: readonly EvalRunTarget[];
    readonly phase?: EvalRunPhase;
    /** The slug of the plugin compared, with and without; none when omitted. */
    readonly compared?: string;
  } = {},
): EvalRun {
  const id = opts.id ?? "evr_1";
  const specTargets = opts.targets ?? [];
  const caseTargets =
    opts.caseTargets ?? (specTargets.length > 0 ? specTargets : [{ modelName: "claude-sonnet-4-6" }]);
  let casesPassed = 0;
  let casesTotal = 0;
  const blocks = plugins.map((plugin, index) => {
    const cases = plugin.notRun ? [] : (plugin.cases ?? []);
    const passed = cases.filter((entry) => (entry.score ?? 0) >= 1).length;
    casesPassed += passed;
    casesTotal += cases.length;
    return {
      pluginId: `plg_${index + 1}`,
      pluginSlug: plugin.slug,
      pluginDigest: plugin.digest ?? digestOf(`${index + 1}abc`),
      attached: plugin.attached ?? true,
      compared: plugin.slug === opts.compared,
      notRunReason: plugin.notRun ?? "",
      aggregates: { casesPassed: passed, casesTotal: cases.length, overallScore: 0.5 },
      cases: cases.map((entry) => ({
        caseName: entry.name,
        targets: caseTargets.map((target) => ({
          target,
          withPlugin: {
            score: entry.score,
            tries: [
              {
                index: 1,
                state: EvalRunTryState.graded,
                score: entry.score ?? 0,
                runId: `run_${plugin.slug}_${entry.name}_1`,
                costUsd: 0.25,
              },
              {
                index: 2,
                state: EvalRunTryState.not_graded,
                notGradedReason: "platform busy",
                runId: "",
              },
            ],
          },
          passed: (entry.score ?? 0) >= 1,
          passK: false,
        })),
      })),
    };
  });
  const comparedIndex = plugins.findIndex((plugin) => plugin.slug === opts.compared);
  return create(EvalRunSchema, {
    metadata: { id, org: "org_acme", name: id },
    spec: {
      subject: { case: "agentId", value: "agt_1" },
      targets: [...specTargets],
      maxCostUsd: 5,
      ...(comparedIndex >= 0 && {
        comparedPluginId: `plg_${comparedIndex + 1}`,
        ablation: EvalRunAblation.with_without,
      }),
    },
    status: {
      phase: opts.phase ?? EvalRunPhase.completed,
      agentVersionHash: opts.version ?? "1a2b3c4d5e6f7a8b",
      audit: { specAudit: { createdAt: timestampFromMs(evalStartOf(id).getTime()) } },
      plugins: blocks,
      aggregates: { casesPassed, casesTotal, overallScore: 0.75 },
      costUsd: 1.5,
      triesTotal: 4,
      triesFinished: 4,
    },
  });
}
