/**
 * The eval-run caller seam: WHO an eval run's tries and AI-graded checks
 * act as when the eval run's workflow creates their sessions and runs
 * through the in-process pipelines. The grading caller (grading-caller.ts)
 * met the same question first, and this seam answers it the same way.
 *
 * With no driver composed the eval run's work enters as the in-process
 * `internal` class: the trusted-local laptop's lane, where the one caller
 * is the server's operator. Under an authentication posture that lane is
 * wrong, so two drivers answer it: open source, under the built-in
 * authorization posture, makes the work act as the eval run's CREATOR
 * (authorization/eval-run-caller.ts), who then owns the tries; the hosted
 * edition mints a token for the organization's own eval system account,
 * carrying the eval run's id as a verified claim, from which it writes the
 * tries' read-only session link to the eval run.
 *
 * Single-instance point, minted per try and per vote. Two failure shapes,
 * told apart by type:
 *
 *   - any other thrown error is an INFRASTRUCTURE fault: the activity lets
 *     it propagate, so Temporal retries it;
 *   - `EvalRunCallerRefusedError` is a DETERMINISTIC refusal: the eval run
 *     can act as nobody (one created by a person who has since left the
 *     organization). The try is recorded as not graded with the refusal's
 *     own not-graded reason when it names one, else the fixed one, and no
 *     retry changes that.
 */
import type { CallerIdentity } from "./identity.js";

export interface EvalRunCallerMint {
  /**
   * Mints the caller identity the eval run `evalRunId` of the organization
   * `org` acts as for one try or one vote. `rawToken` must carry the edition's
   * verifiable credential when the edition reads it downstream.
   */
  mintEvalRunCaller(org: string, evalRunId: string): Promise<CallerIdentity>;
}

/**
 * The mint's deterministic refusal (the module header). The message is for
 * the log; the try shows `notGradedReason` when set (a short sentence with
 * no ids), else the fixed not-graded reason.
 */
export class EvalRunCallerRefusedError extends Error {
  readonly notGradedReason: string | undefined;

  constructor(reason: string, notGradedReason?: string) {
    super(reason);
    this.name = "EvalRunCallerRefusedError";
    this.notGradedReason = notGradedReason;
  }
}
