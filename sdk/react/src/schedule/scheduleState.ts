// Pure schedule-state derivation — the disabled-vs-paused vocabulary,
// computed on read.
//
// A schedule that is not firing is stopped by one of two levers with two
// different writers and two different remedies (the backend pins this
// vocabulary in its controller docs):
//
//   - "disabled" — the OWNER's switch (`spec.enabled = false`), cleared
//     by re-applying the manifest or the console's Enable action.
//   - "paused" — the PLATFORM's failure-streak latch
//     (`status.paused_reason` non-empty), cleared only by Resume.
//
// The console must never collapse these into one badge (stigmer/stigmer#352):
// each state names its own remedy. When both levers are set, "disabled"
// wins for display — the owner's intent dominates — but callers should
// keep the paused reason visible alongside (the banner does).

import type { ScheduleSpec } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/spec_pb";
import type { ScheduleStatus } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/status_pb";
import type { StatusPhase } from "../resource-workbench/types.js";

/** The three mutually-exclusive display states of a schedule. */
export type ScheduleState = "active" | "disabled" | "paused";

/** Derived display state: the tri-state plus its shared-badge rendering. */
export interface ScheduleStateInfo {
  /** The display state ("disabled" wins when both levers are set). */
  readonly state: ScheduleState;
  /** `StatusPhase` for the shared `StatusBadge` (`--stgm-status-*` tokens). */
  readonly phase: StatusPhase;
  /** Human-readable badge label. */
  readonly label: string;
  /**
   * `true` when the platform pause latch is set — independent of the
   * display state, so a disabled-AND-paused schedule can still surface
   * its `status.pausedReason`.
   */
  readonly isPaused: boolean;
}

/**
 * Derive a schedule's display state from its spec and status.
 *
 * A missing spec derives as "disabled" — the same fail-closed reading the
 * server applies to a manifest that omits `enabled`.
 */
export function deriveScheduleState(
  spec: ScheduleSpec | undefined,
  status: ScheduleStatus | undefined,
): ScheduleStateInfo {
  const isPaused = (status?.pausedReason ?? "") !== "";

  if (!spec?.enabled) {
    return { state: "disabled", phase: "disabled", label: "Disabled", isPaused };
  }
  if (isPaused) {
    return { state: "paused", phase: "degraded", label: "Paused", isPaused };
  }
  return { state: "active", phase: "ready", label: "Active", isPaused };
}

/**
 * Compact future-instant formatter for a schedule's next fire time:
 * `now`, `in 5m`, `in 3h`, `in 6d`, then a short date once "days from
 * now" stops being how people think about it.
 *
 * The schedule-local sibling of the activity module's past-only
 * `formatRelativeTime` (same compact units, same date tail) — kept
 * separate because that util's contract is deliberately past-only.
 * A fire time slightly in the past (a tick mid-flight, clock skew)
 * renders as `now` rather than a nonsense negative countdown.
 *
 * `now` is injected, never read from the live clock — required for
 * deterministic tests and Scenar fixtures.
 */
export function formatNextFire(date: Date, now: Date): string {
  const deltaMs = date.getTime() - now.getTime();

  if (deltaMs < 60_000) return "now";

  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `in ${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `in ${days}d`;

  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
