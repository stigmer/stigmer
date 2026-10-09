/**
 * The grading caller seam: WHO an AI judge run acts as when the grading
 * workflow creates it through the in-process run create pipeline. The
 * schedule-fire caller (schedule-fire-caller.ts) met the same question
 * first, and this seam answers it the same way.
 *
 * With no driver composed the judge run enters as the in-process
 * `internal` class: the trusted-local laptop's lane, where the one caller
 * is the server's operator. Under an authentication posture that lane is
 * wrong: the internal class carries no person, so the judge's session
 * would belong to nobody and, in the hosted edition, its sandbox would
 * launch with no runner credential. Two drivers answer it: open source,
 * under the built-in authorization posture, makes the judge act as the
 * evaluator's CREATOR (authorization/grading-caller.ts); the hosted
 * edition mints a token for the organization's own grading system
 * account. The grading workflow then propagates the identity through the
 * caller-propagation header, as the schedule's run starter does.
 *
 * Single-instance point, minted per judge run. Two failure shapes, told
 * apart by type as the schedule's are:
 *
 *   - any other thrown error is an INFRASTRUCTURE fault: the start
 *     activity lets it propagate, so Temporal retries it;
 *   - `GradingCallerRefusedError` is a DETERMINISTIC refusal: this grade
 *     can act as nobody and no retry changes that (an evaluator created by
 *     a person who has since left). The run is recorded as not graded,
 *     "grading cannot act for this agent", and the evaluator's status
 *     carries the reason, so the agent's maintainer sees it on the Quality
 *     tab.
 */
import type { CallerIdentity } from "./identity.js";

export interface GradingCallerMint {
  /**
   * Mints the caller identity one judge run acts as, for the evaluator
   * `evaluatorId` of the organization `org`. `rawToken` must carry the
   * edition's verifiable credential when the edition reads it downstream.
   */
  mintGradingCaller(org: string, evaluatorId: string): Promise<CallerIdentity>;
}

/**
 * The mint's deterministic refusal (the module header). The message is for
 * the log; the run and the Quality tab show the fixed not-graded reason.
 */
export class GradingCallerRefusedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "GradingCallerRefusedError";
  }
}
