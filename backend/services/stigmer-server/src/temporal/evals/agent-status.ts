/**
 * An agent eval's status book (status-book.ts): how the suite's activities
 * read and write an AgentEval's row. Create stamps every plugin the agent
 * attaches on the status; the skeleton fills each evaluated plugin's block
 * with its planned cases, in the matrix's order, so the n-th case of the
 * flat matrix is the n-th case across the plugins' blocks (a plugin whose
 * cases do not run has none). The totals are each plugin's own, then all
 * of them together; an agent eval has one arm, so no delta.
 *
 * A case that names a model, in an eval that runs the agent as it runs
 * (no targets named), carries a note that the agent's own model ran.
 *
 * Proven by __tests__/agent-status.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";

import { AgentEvalSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/api_pb";
import { AgentEvalStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/status_pb";
import type { AgentEvalStatus } from "@stigmer/protos/ai/stigmer/agentic/agenteval/v1/status_pb";
import { PluginEvalPhase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import type { PluginEvalCase } from "@stigmer/protos/ai/stigmer/agentic/plugineval/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { EvalCase } from "@stigmer/plugin-package";

import { DEFAULT_THRESHOLD, recomputeCases } from "../../domain/plugin-eval/scoring.js";
import { bumpStatusAudit } from "../../pipeline/steps/defaults.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";
import type { AgentEvalContext } from "./context.js";
import { SKIP_WRITE } from "./status-book.js";
import type { EvalStatusBook } from "./status-book.js";
import { skeletonCaseOf } from "./suite-activities.js";

/** The note on a case that names a model, run on the agent's own (the module header). */
export function agentModelNote(model: string): string {
  return `model '${model}' is the case's; the eval runs the agent's own model`;
}

export const agentStatusBook: EvalStatusBook = {
  async read(store, evalId) {
    let stored;
    try {
      stored = await store.getResource(ApiResourceKind.agent_eval, evalId, AgentEvalSchema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    }
    return {
      phase: stored.status?.phase ?? PluginEvalPhase.unspecified,
      threshold: stored.spec?.threshold ?? DEFAULT_THRESHOLD,
    };
  },
  async write(store, evalId, modify) {
    try {
      await store.updateResource(ApiResourceKind.agent_eval, evalId, AgentEvalSchema, (live) => {
        const status = (live.status ??= create(AgentEvalStatusSchema));
        const answer = modify({
          status,
          caseAt: (caseIndex) => casesOf(status)[caseIndex],
          planned: () => casesOf(status).length > 0,
          recompute: (threshold) => recomputeAgentStatus(status, threshold),
          skeleton: (context) => {
            if (context.kind === "agent") {
              writeAgentSkeleton(status, context);
            }
          },
        });
        if (answer === SKIP_WRITE) {
          throw new SkippedWrite();
        }
        bumpStatusAudit(status);
      });
    } catch (error) {
      if (error instanceof ResourceNotFoundError || error instanceof SkippedWrite) {
        return;
      }
      throw error;
    }
  },
};

/** Thrown inside the store's update to leave the row untouched. */
class SkippedWrite extends Error {}

/** Every case of the eval, plugin after plugin: the matrix's flat order. */
function casesOf(status: AgentEvalStatus): PluginEvalCase[] {
  return status.plugins.flatMap((plugin) => plugin.cases);
}

/** Each plugin's totals, then the eval's over every case. */
export function recomputeAgentStatus(status: AgentEvalStatus, threshold: number): void {
  for (const plugin of status.plugins) {
    plugin.aggregates = recomputeCases(plugin.cases, threshold).aggregates;
  }
  const totals = recomputeCases(casesOf(status), threshold);
  status.aggregates = totals.aggregates;
  status.costUsd = totals.costUsd;
  status.triesFinished = totals.triesFinished;
}

/** The status skeleton of a planned agent eval (the module header). */
export function writeAgentSkeleton(status: AgentEvalStatus, context: AgentEvalContext): void {
  const spec = context.agentEval.spec;
  const runsAgentModel = spec !== undefined && spec.targets.length === 0;
  for (const plugin of status.plugins) {
    plugin.cases = [];
  }
  context.matrix.cases.forEach((planned, caseIndex) => {
    const source = context.sources[context.caseSources[caseIndex] ?? -1];
    const block = source === undefined ? undefined : status.plugins[source.pluginIndex];
    if (source === undefined || block === undefined) {
      return;
    }
    block.cases.push(
      skeletonCaseOf(
        planned,
        spec,
        source.plugin.metadata?.name ?? "",
        source.suite.servers,
        false,
        runsAgentModel ? caseModelNotes(planned.evalCase) : [],
      ),
    );
  });
  status.triesTotal = context.matrix.cells.length;
  status.phase = PluginEvalPhase.running;
  status.startedAt = timestampNow();
  recomputeAgentStatus(status, spec?.threshold ?? DEFAULT_THRESHOLD);
}

function caseModelNotes(evalCase: EvalCase): string[] {
  const model = evalCase.model?.trim() ?? "";
  return model === "" ? [] : [agentModelNote(model)];
}
