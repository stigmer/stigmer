/**
 * An agent eval built for the Evals tab's tests: one plugin block per
 * entry, each case on every target given with one arm (with the plugin):
 * its first try graded with the case's score and a run, its second not
 * graded ("platform busy") with no run. A plugin given a `notRun` reason
 * has no cases. Named by its id, as the server names an eval the client
 * sent unnamed, stamped with `version` and started at the plugin eval
 * fixture's {@link evalStartOf} its id, so two evals read apart.
 */
import { create } from "@bufbuild/protobuf";
import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import {
  AgentEvalSchema,
  type AgentEval,
} from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import {
  PluginEvalPhase,
  PluginEvalTryState,
} from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import type { PluginEvalTarget } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/spec_pb";
import { evalStartOf } from "../../plugin-eval/__tests__/eval-fixture";

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
}

export function agentEvalWith(
  plugins: readonly FixturePlugin[],
  opts: {
    readonly id?: string;
    readonly version?: string;
    readonly targets?: readonly PluginEvalTarget[];
    /** The target every case ran on when the spec names none: the agent as it runs. */
    readonly caseTargets?: readonly PluginEvalTarget[];
    readonly phase?: PluginEvalPhase;
  } = {},
): AgentEval {
  const id = opts.id ?? "aev_1";
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
                state: PluginEvalTryState.graded,
                score: entry.score ?? 0,
                runId: `run_${plugin.slug}_${entry.name}_1`,
                costUsd: 0.25,
              },
              {
                index: 2,
                state: PluginEvalTryState.not_graded,
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
  return create(AgentEvalSchema, {
    metadata: { id, org: "org_acme", name: id },
    spec: { agentId: "agt_1", targets: [...specTargets], maxCostUsd: 5 },
    status: {
      phase: opts.phase ?? PluginEvalPhase.completed,
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
