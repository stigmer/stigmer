import { RunnerPhase } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/enum_pb";

/**
 * Sort order for runner phases — active phases first, then by severity.
 *
 * Used by both {@link RunnerPicker} and {@link RunnerListPanel} to present
 * runners in a consistent, predictable order across all UI surfaces.
 */
export const PHASE_SORT_ORDER: Record<RunnerPhase, number> = {
  [RunnerPhase.READY]: 0,
  [RunnerPhase.BUSY]: 1,
  [RunnerPhase.PENDING]: 2,
  [RunnerPhase.STOPPED]: 3,
  [RunnerPhase.FAILED]: 4,
  [RunnerPhase.UNSPECIFIED]: 5,
};

const LABELS: Record<RunnerPhase, string> = {
  [RunnerPhase.READY]: "Ready",
  [RunnerPhase.BUSY]: "Busy",
  [RunnerPhase.PENDING]: "Pending",
  [RunnerPhase.STOPPED]: "Stopped",
  [RunnerPhase.FAILED]: "Failed",
  [RunnerPhase.UNSPECIFIED]: "Unknown",
};

/**
 * Human-readable label for a runner phase.
 *
 * Returns title-case labels suitable for both compact indicators
 * ("Ready") and full-row display ("Stopped").
 */
export function phaseLabel(phase: RunnerPhase): string {
  return LABELS[phase] ?? "Unknown";
}

/**
 * Tailwind `bg-*` class for the small colored dot indicator.
 *
 * - Ready  → `bg-success`  (green)
 * - Busy   → `bg-warning`  (amber)
 * - Others → `bg-muted-foreground` (neutral)
 */
export function phaseDotColor(phase: RunnerPhase): string {
  switch (phase) {
    case RunnerPhase.READY:
      return "bg-success";
    case RunnerPhase.BUSY:
      return "bg-warning";
    default:
      return "bg-muted-foreground";
  }
}

/**
 * Whether the runner is in an active (workload-accepting) phase.
 *
 * Active = `READY` or `BUSY`. Inactive = everything else.
 */
export function isActivePhase(phase: RunnerPhase): boolean {
  return phase === RunnerPhase.READY || phase === RunnerPhase.BUSY;
}

/**
 * Whether the runner is in a transitional phase whose status is
 * expected to change soon without user action.
 *
 * Currently only `PENDING` — the runner has registered but hasn't
 * completed its startup handshake yet. This is distinct from
 * {@link isActivePhase} (READY | BUSY) where the runner is stable
 * and accepting work.
 *
 * Useful for driving conditional polling: poll while transitional
 * runners exist, stop when all runners reach a stable state.
 */
export function isTransitionalPhase(phase: RunnerPhase): boolean {
  return phase === RunnerPhase.PENDING;
}
