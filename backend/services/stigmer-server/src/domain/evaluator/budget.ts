/**
 * An evaluator's monthly grading budget: a grade sets aside its cap before
 * the judge starts (`reserve`), and gives back the cap and adds what the
 * judge actually spent when the grade is recorded (`settle`). Both change
 * only the evaluator's status, through the store's atomic read-modify-write
 * (store/interface.ts, updateResource), the way a run's own status is
 * written, so concurrent grades are serialized on the row and none loses
 * another's increment.
 *
 * The limit is hard: a reservation is refused when this month's spend, the
 * spend set aside for grades still running and one more cap would pass it.
 * A judge run is capped at that same amount (its `max_cost_usd`), which the
 * runner stops at but can pass by one model call, so the limit can be
 * passed by at most that overshoot. The amounts are the runner's estimates
 * of model cost, not a billed amount.
 *
 * The month is the UTC calendar month. The first write in a new month
 * rolls the period over: spend, reservations and counts start again from
 * zero, so a grade reserved in one month and settled in the next lands its
 * spend in the new month and gives back nothing: its cap was the old
 * month's, and the new month's reservations belong to other grades, so a
 * settle gives a cap back only in the period it was reserved in. Resetting the reservations also bounds
 * the one way a cap can be left set aside: Temporal runs an activity at
 * least once, so a worker lost between a reservation's commit and the
 * activity's completion reserves a second cap for the same grade, which
 * then stays reserved, visible on the Quality tab, until the month ends.
 *
 * Proven by __tests__/budget.postgres.test.ts (rollover, the refusal at the limit,
 * twenty concurrent reservations that never pass it on both stores, a
 * settle across months).
 */
import { create } from "@bufbuild/protobuf";

import { EvaluatorSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/api_pb";
import { EvaluatorStatusSchema } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/status_pb";
import type { EvaluatorStatus } from "@stigmer/protos/ai/stigmer/agentic/evaluator/v1/status_pb";
import { ApiResourceKind } from "@stigmer/protos/ai/stigmer/commons/apiresource/apiresourcekind/api_resource_kind_pb";

import { bumpStatusAudit } from "../../pipeline/steps/defaults.js";
import { ResourceNotFoundError } from "../../store/interface.js";
import type { Store } from "../../store/interface.js";

/** The period a moment falls in: its UTC calendar month, `YYYY-MM`. */
export function periodOf(now: Date): string {
  return now.toISOString().slice(0, 7);
}

/** What a reservation found: the cap set aside, the limit reached, or grading off. */
export type Reservation = "reserved" | "limit-reached" | "off";

/**
 * How a grade ended, for the counts. "gone": the graded run was deleted
 * meanwhile, so the grade only gives its money back and counts nothing.
 */
export type GradeEnd =
  | { readonly kind: "graded" }
  | { readonly kind: "not-graded"; readonly reason: string }
  | { readonly kind: "gone" };

/**
 * Sets `capUsd` aside for one grade, unless the evaluator is gone or
 * disabled ("off", nothing written) or the cap would pass the monthly limit
 * ("limit-reached", counted as not graded with `limitReason`).
 */
export async function reserve(
  store: Store,
  evaluatorId: string,
  now: Date,
  capUsd: number,
  limitReason: string,
): Promise<Reservation> {
  let outcome: Reservation = "off";
  try {
    await store.updateResource(
      ApiResourceKind.evaluator,
      evaluatorId,
      EvaluatorSchema,
      (live) => {
        if (live.spec?.enabled !== true) {
          throw new GradingOff();
        }
        const status = rolledOver(live.status, now);
        live.status = status;
        const limit = live.spec.monthlyLimitUsd;
        if (status.spentUsd + status.reservedUsd + capUsd > limit + CENT_FRACTION) {
          status.notGraded += 1;
          status.lastNotGradedReason = limitReason;
          outcome = "limit-reached";
        } else {
          status.reservedUsd = dollars(status.reservedUsd + capUsd);
          outcome = "reserved";
        }
        bumpStatusAudit(status);
      },
    );
  } catch (error) {
    if (error instanceof GradingOff || error instanceof ResourceNotFoundError) {
      return "off";
    }
    throw error;
  }
  return outcome;
}

/**
 * Settles one grade: gives back `capUsd` when `reservedPeriod`, the period
 * it was reserved in, is still the live one, adds `spentUsd`, and counts
 * how the grade ended. An evaluator deleted meanwhile has nothing to settle.
 */
export async function settle(
  store: Store,
  evaluatorId: string,
  now: Date,
  capUsd: number,
  reservedPeriod: string,
  spentUsd: number,
  end: GradeEnd,
): Promise<void> {
  try {
    await store.updateResource(
      ApiResourceKind.evaluator,
      evaluatorId,
      EvaluatorSchema,
      (live) => {
        const status = rolledOver(live.status, now);
        live.status = status;
        if (status.period === reservedPeriod) {
          status.reservedUsd = dollars(Math.max(0, status.reservedUsd - capUsd));
        }
        status.spentUsd = dollars(status.spentUsd + Math.max(0, spentUsd));
        if (end.kind === "graded") {
          status.graded += 1;
          status.lastNotGradedReason = "";
        } else if (end.kind === "not-graded") {
          status.notGraded += 1;
          status.lastNotGradedReason = end.reason;
        }
        bumpStatusAudit(status);
      },
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundError) {
      return;
    }
    throw error;
  }
}

/** The status for `now`'s period: the live one, or a fresh month keeping the audit. */
function rolledOver(
  status: EvaluatorStatus | undefined,
  now: Date,
): EvaluatorStatus {
  const period = periodOf(now);
  if (status !== undefined && status.period === period) {
    return status;
  }
  return create(EvaluatorStatusSchema, {
    period,
    audit: status?.audit,
  });
}

/**
 * Tolerance on the limit comparison, a hundredth of a cent: amounts are
 * sums of floating-point dollars, and a limit of exactly forty grades must
 * admit the fortieth.
 */
const CENT_FRACTION = 0.0001;

/** Rounds to a millionth of a dollar, so repeated sums do not drift. */
function dollars(amount: number): number {
  return Math.round(amount * 1_000_000) / 1_000_000;
}

/** Thrown inside the atomic write to skip it when grading is off. */
class GradingOff extends Error {
  constructor() {
    super("grading is off for this evaluator");
    this.name = "GradingOff";
  }
}
