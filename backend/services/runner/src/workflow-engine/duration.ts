/**
 * CNCF duration utilities — converts DurationDef objects to
 * milliseconds. Used by wait tasks and retry delay calculations.
 *
 * Sandbox-safe: zero dependencies, no Node.js or Temporal imports.
 */

import type { DurationDef } from "./types.js";

/**
 * Converts a CNCF DurationDef to total milliseconds. Sums all
 * provided fields additively (matching Go's `utils.ToDuration`).
 */
export function durationToMs(duration: DurationDef): number {
  let ms = 0;
  if (duration.milliseconds) ms += duration.milliseconds;
  if (duration.seconds) ms += duration.seconds * 1_000;
  if (duration.minutes) ms += duration.minutes * 60_000;
  if (duration.hours) ms += duration.hours * 3_600_000;
  if (duration.days) ms += duration.days * 86_400_000;
  return ms;
}
