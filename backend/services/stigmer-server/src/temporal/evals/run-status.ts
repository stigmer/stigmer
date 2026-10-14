/**
 * The eval run's status book (status-book.ts): how the suite's activities
 * read and write an EvalRun's row. Create stamps every plugin a try lists
 * on the status; the skeleton fills each evaluated plugin's block with its
 * planned cases, in the matrix's order, so the n-th case of the flat
 * matrix is the n-th case across the plugins' blocks (a plugin whose cases
 * do not run has none). The totals are each plugin's own, then all of them
 * together (domain/eval-run/scoring.ts recomputeStatus).
 *
 * A case that names a model, on an agent run as it runs (no targets
 * named), carries a note that the agent's own model ran.
 *
 * Proven by __tests__/run-status.test.ts.
 */
import { create } from "@bufbuild/protobuf";
import { timestampNow } from "@bufbuild/protobuf/wkt";

import { EvalRunSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { EvalRunPhase, EvalRunStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import type { EvalRunStatus } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import type { EvalCase } from "@stigmer/plugin-package";

import { DEFAULT_THRESHOLD, casesOf, recomputeStatus } from "../../domain/eval-run/scoring.js";
import { bumpStatusAudit } from "../../pipeline/steps/defaults.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { EvalContext } from "./context.js";
import { SKIP_WRITE } from "./status-book.js";
import type { EvalStatusBook } from "./status-book.js";
import { skeletonCaseOf } from "./suite-activities.js";

/** The note on a case that names a model, run on the agent's own (the module header). */
export function agentModelNote(model: string): string {
  return `model '${model}' is the case's; the eval run runs the agent's own model`;
}

export const evalRunStatusBook: EvalStatusBook = {
  async read(store, evalRunId) {
    let stored;
    try {
      stored = await store.getResource(ApiResourceKind.eval_run, evalRunId, EvalRunSchema);
    } catch (error) {
      if (error instanceof ResourceNotFoundError) {
        return undefined;
      }
      throw error;
    }
    return {
      phase: stored.status?.phase ?? EvalRunPhase.unspecified,
      threshold: stored.spec?.threshold ?? DEFAULT_THRESHOLD,
    };
  },
  async write(store, evalRunId, modify) {
    try {
      await store.updateResource(ApiResourceKind.eval_run, evalRunId, EvalRunSchema, (live) => {
        const status = (live.status ??= create(EvalRunStatusSchema));
        const answer = modify({
          status,
          caseAt: (caseIndex) => casesOf(status)[caseIndex],
          planned: () => casesOf(status).length > 0,
          recompute: (threshold) => recomputeStatus(status, threshold),
          skeleton: (context) => writeSkeleton(status, context),
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

/** Thrown inside the store's update to leave the row untouched (the store skips a write its modify throws from). */
class SkippedWrite extends Error {}

/** The status skeleton of a planned eval run (the module header). */
export function writeSkeleton(status: EvalRunStatus, context: EvalContext): void {
  const spec = context.evalRun.spec;
  const runsAgentModel = context.agent !== undefined && spec !== undefined && spec.targets.length === 0;
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
        context.twoArms,
        runsAgentModel ? caseModelNotes(planned.evalCase) : [],
      ),
    );
  });
  status.triesTotal = context.matrix.cells.length;
  status.phase = EvalRunPhase.running;
  status.startedAt = timestampNow();
  recomputeStatus(status, spec?.threshold ?? DEFAULT_THRESHOLD);
}

function caseModelNotes(evalCase: EvalCase): string[] {
  const model = evalCase.model?.trim() ?? "";
  return model === "" ? [] : [agentModelNote(model)];
}
