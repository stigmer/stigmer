"use client";

import { useCallback, useMemo, useState } from "react";
import {
  ScheduleRunOutcome,
  type ScheduleTriggerResult,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/io_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toast } from "../feedback/toast.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useTriggerSchedule}. */
export interface UseTriggerScheduleReturn {
  /**
   * Fire the schedule once, now — a real agent execution, outside the
   * cron cadence. Resolves with the {@link ScheduleTriggerResult}: the
   * run's REAL outcome (started with an execution id, or refused with the
   * gate's copy), so a caller can navigate to the execution or surface
   * the refusal. Refetch the schedule afterwards to pick up the freshly
   * stamped `status.last_fire_at` / `status.last_execution_id`.
   */
  readonly triggerSchedule: (scheduleId: string) => Promise<ScheduleTriggerResult>;
  /** `true` while the trigger request is in flight. */
  readonly isTriggering: boolean;
  /** Error from the last failed or refused trigger, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that fires a schedule once, immediately, and reports the
 * run's real outcome (project DD-017 D-5/D-6).
 *
 * The trigger is a two-level contract, and this hook honors both levels:
 *
 * - A **gRPC error** means the trigger itself was refused — a disabled
 *   schedule answers `FAILED_PRECONDITION` with copy that names the
 *   remedy ("enable it before triggering"). The error toast relays that
 *   copy verbatim (byte-identical across editions) and the promise
 *   rejects.
 * - A **success** means the fire happened. The result's `outcome` then
 *   says what the RUN did: `STARTED` (an execution was created — a
 *   success toast), or `REFUSED` / `TARGET_MISSING` (a launch gate said
 *   no — an error toast carrying the gate's `refusalReason` verbatim).
 *   The promise RESOLVES in every one of these cases: a refused run is a
 *   successful trigger honestly reported, and the caller decides what to
 *   do with it (navigate to the execution, show the reason).
 *
 * Triggering starts a real, billable execution — gate the call behind a
 * confirmation (the detail view uses `ConfirmDialog`).
 */
export function useTriggerSchedule(): UseTriggerScheduleReturn {
  const stigmer = useStigmer();
  const [isTriggering, setIsTriggering] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const triggerSchedule = useCallback(
    async (scheduleId: string): Promise<ScheduleTriggerResult> => {
      setIsTriggering(true);
      setError(null);
      try {
        const result = await stigmer.schedule.trigger(scheduleId);
        if (result.outcome === ScheduleRunOutcome.STARTED) {
          toast.success("Run started");
        } else {
          // The fire happened but the run was refused — surface the
          // gate's own copy, never a generic message. The promise still
          // resolves; the caller renders the reason inline too.
          toast.error(
            result.refusalReason || "The run was refused by a launch gate",
          );
        }
        return result;
      } catch (err) {
        const wrapped = toError(err);
        setError(wrapped);
        toast.error(getUserMessage(err));
        throw wrapped;
      } finally {
        setIsTriggering(false);
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ triggerSchedule, isTriggering, error }),
    [triggerSchedule, isTriggering, error],
  );
}
