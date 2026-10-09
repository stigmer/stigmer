/**
 * Which completed runs an evaluator grades. Deterministic: the first eight
 * bytes of the SHA-256 of the run's id, read as a fraction of 2^64, below
 * the sample rate. A retried activity or a replayed workflow decides the
 * same way for the same run, and runs are picked evenly whatever their
 * ids look like. A run that is not picked carries no judge score at all:
 * "not sampled" is not "not graded".
 *
 * Proven by __tests__/sampling.test.ts (determinism, and the rate over ten
 * thousand ids).
 */
import { createHash } from "node:crypto";

const TWO_TO_THE_64 = 2n ** 64n;

/** Whether the run is in the sample at `rate` (0, 1]. */
export function isSampled(runId: string, rate: number): boolean {
  if (!(rate > 0)) {
    return false;
  }
  if (rate >= 1) {
    return true;
  }
  const digest = createHash("sha256").update(runId).digest();
  const fraction = Number(digest.readBigUInt64BE(0)) / Number(TWO_TO_THE_64);
  return fraction < rate;
}
