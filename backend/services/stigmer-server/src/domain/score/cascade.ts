/**
 * The removal of a run's scores when the run goes: the run's own delete
 * chain (domain/run/controller.ts) and its session's cascade
 * (domain/session/steps.ts, which deletes runs without their chain) both
 * call `deleteScoresOfRun` before the run's row is deleted, so each
 * score's access is cleaned while the run still holds the link the score
 * reaches its organization through (the order stigmer#1603 set for runs
 * under their session).
 *
 * The find is a store read through the score list index; each delete is
 * the score's own delete chain, reached through the in-process edge
 * (`ScoreDeleter`, served by boot/inprocess.ts) as the server, so
 * `CleanupIamPolicies` and any step the chain gains later run by
 * construction (stigmer#1647's lesson: a bare store delete leaves the
 * access rows behind).
 *
 * A score already gone answers NOT_FOUND and is skipped; any other
 * failure fails the run's delete, which is retried whole, rather than
 * leave a score whose run no longer exists.
 *
 * The list is read once, so a score whose create chain loaded the run
 * before this list and persists after it outlives the run. The grading
 * activity, the one writer that runs unattended, reads the run again after
 * it records and removes its score when the run has gone
 * (temporal/grading/activities.ts). A person rating a run in the same
 * instant it is deleted can still leave one: such a score is seen by
 * nobody, since its visibility is its run's, and goes with its
 * organization's purge.
 */
import { Code, ConnectError } from "@connectrpc/connect";
import type { DescMessage } from "@bufbuild/protobuf";

import type { Logger } from "../../boot/logger.js";
import { internalError } from "../../pipeline/errors.js";
import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { RESOURCE_ID_KEY } from "../../pipeline/steps/delete.js";
import type { Store } from "../../store/interface.js";
import type { ScoreDeleter } from "./ports.js";
import { listRunScores } from "./queries.js";

/** Removes every score of a run. */
export interface RunScoreCascade {
  deleteScoresOfRun(runId: string): Promise<void>;
}

export interface RunScoreCascadeDeps {
  readonly store: Store;
  readonly logger: Logger;
  /** Resolved at call time: the in-process clients are wired after the routes. */
  readonly deleter: () => ScoreDeleter;
}

export function newRunScoreCascade(deps: RunScoreCascadeDeps): RunScoreCascade {
  return {
    async deleteScoresOfRun(runId: string): Promise<void> {
      let ids: string[];
      try {
        // A stored score always carries its id: BuildNewState mints it.
        ids = (await listRunScores(deps.store, deps.logger, runId)).map(
          (score) => score.metadata?.id ?? "",
        );
      } catch (error) {
        throw internalError(error, `failed to list the scores of run ${runId}`);
      }
      for (const id of ids) {
        try {
          await deps.deleter().delete(id);
        } catch (error) {
          if (error instanceof ConnectError && error.code === Code.NotFound) {
            continue;
          }
          deps.logger.warn("failed to delete a score of a deleted run", {
            runId,
            scoreId: id,
            error: error instanceof Error ? error.message : String(error),
          });
          throw internalError(
            error,
            `failed to delete score ${id} of run ${runId}`,
          );
        }
      }
    },
  };
}

/**
 * CascadeDeleteScores: the run delete chain's step, after
 * LoadExistingForDelete and before DeleteResource; reads the run's id
 * from ExtractResourceId.
 */
export function newCascadeDeleteScoresStep<Desc extends DescMessage>(
  cascade: RunScoreCascade,
): PipelineStep<Desc> {
  return {
    name: "CascadeDeleteScores",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      const runId = ctx.get(RESOURCE_ID_KEY);
      if (typeof runId !== "string" || runId === "") {
        throw internalError(
          new Error("run id not found in context"),
          "run id not found in context",
        );
      }
      await cascade.deleteScoresOfRun(runId);
    },
  };
}
