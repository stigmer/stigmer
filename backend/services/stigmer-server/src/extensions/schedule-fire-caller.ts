/**
 * The schedule-fire caller seam (stigmer-cloud#572) — WHO a schedule fire
 * acts as when the RunStarter re-enters the execution create pipeline.
 *
 * OSS deliberately has no caller identity on this lane (DD-015 D-G: the
 * single-user edition has no tokens to carry one), so with no driver
 * composed every fire enters as the in-process `internal` class — today's
 * behavior, byte-identical. The cloud edition's Java baseline instead
 * mints a schedule JWT per fire (sub = the org's system-schedule account,
 * claim = the firing Schedule id) so the created session and execution
 * carry real attribution and the schedule's viewer set reaches the run
 * (the FGA model's session#schedule link — "without it a scheduled run is
 * invisible to every human, including the schedule's owner"). This seam
 * lets a composition supply that identity; the fire then propagates it
 * through the R5 caller-propagation header exactly like the other
 * request-origin in-process creates.
 *
 * Single-instance point. The mint is per fire — the schedule id is a
 * claim of the minted credential, never a cached field — and a mint
 * failure is an infrastructure fault: the RunStarter lets it propagate,
 * so the tick activity retries (the deterministic execution name absorbs
 * the retry) and a manual trigger surfaces the failure to its caller.
 */
import type { CallerIdentity } from "./identity.js";

export interface ScheduleFireCallerMint {
  /**
   * Mints the caller identity one fire acts as. `rawToken` must carry the
   * edition's verifiable credential for the identity (compositions read
   * fire-scoped claims — e.g. the schedule id — from it downstream).
   */
  mintFireCaller(org: string, scheduleId: string): Promise<CallerIdentity>;
}
