/**
 * How often a routine may be started by hand: at most `firesPerHour` fires
 * (Run now and the API's `fire` alike) in any hour, counted from the fire
 * ledger. A routine can be fired by another system holding a service
 * account's key, and every fire is a run acting as its owner, so an
 * alerting loop or a retrying script would otherwise start runs without
 * end. Claude Code's routines cap their fires at the same 30 an hour.
 *
 * What counts: every hand fire the ledger holds for the routine, whatever
 * its run's outcome (started, refused by a launch gate, target missing),
 * because each was a press that reached the run pipeline. A schedule's own
 * fires are neither counted nor limited: the cron and the clock's SKIP
 * overlap bound them, and counting them would let a frequent schedule lock
 * its owner out of Run now.
 *
 * The step runs after authorization and the disabled refusal, so a caller
 * who may not fire, or a routine switched off, never spends the allowance,
 * and a refused fire writes no ledger row of its own. The bound guards
 * against a runaway caller; it is not an accounting invariant. The ledger
 * row is written after the run starts (fire.ts, FireDirectRun) and its
 * write is best-effort (temporal/routine/run-ledger.ts), so fires in
 * flight at the same instant may each pass at the boundary.
 *
 * The limit is the server's (ServerConfig.routineFiresPerHour,
 * STIGMER_ROUTINE_FIRES_PER_HOUR); a value below 1 means no limit.
 *
 * Proven by __tests__/fire-rate.test.ts and the store contract's ledger
 * count case.
 */
import type { DescMessage } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";

import type { Routine } from "@stigmer/apis/ai/stigmer/agentic/routine/v1/api_pb";

import type { PipelineStep } from "../../pipeline/pipeline.js";
import type { RequestContext } from "../../pipeline/request-context.js";
import { EXISTING_RESOURCE_KEY } from "../../pipeline/steps/load-existing.js";
import type { Store } from "../../store/interface.js";
import {
  RUN_LEDGER_ORIGIN_MANUAL,
  rfc3339Seconds,
} from "../../temporal/routine/run-ledger.js";

/** The default hourly limit on hand fires per routine. */
export const DEFAULT_ROUTINE_FIRES_PER_HOUR = 30;

const HOUR_MILLIS = 3_600_000;

/** The refusal a fire past the limit gets (RESOURCE_EXHAUSTED: it may be retried later). */
export function fireRateExceededMessage(firesPerHour: number): string {
  return (
    `This routine was started by hand ${String(firesPerHour)} times in the last hour, ` +
    "the most it allows; it can be started again later in the hour."
  );
}

export interface FireRateDeps {
  readonly store: Pick<Store, "countRoutineFiresSince">;
  /** Hand fires allowed per routine per hour; below 1, no limit. */
  readonly firesPerHour: number;
  /** The clock the hour is measured on; the system clock by default. */
  readonly now?: () => Date;
}

export function newValidateFireRateStep<Desc extends DescMessage>(
  deps: FireRateDeps,
): PipelineStep<Desc> {
  const now = deps.now ?? ((): Date => new Date());
  return {
    name: "ValidateFireRate",
    async execute(ctx: RequestContext<Desc>): Promise<void> {
      if (deps.firesPerHour < 1) {
        return;
      }
      const routine = ctx.get(EXISTING_RESOURCE_KEY) as Routine;
      const since = rfc3339Seconds(new Date(now().getTime() - HOUR_MILLIS));
      const fired = await deps.store.countRoutineFiresSince(
        routine.metadata?.id ?? "",
        RUN_LEDGER_ORIGIN_MANUAL,
        since,
      );
      if (fired >= deps.firesPerHour) {
        throw new ConnectError(
          fireRateExceededMessage(deps.firesPerHour),
          Code.ResourceExhausted,
        );
      }
    },
  };
}
