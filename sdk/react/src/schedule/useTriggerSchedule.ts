"use client";

import { useCallback, useMemo, useState } from "react";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toast } from "../feedback/toast.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useTriggerSchedule}. */
export interface UseTriggerScheduleReturn {
  /**
   * Fire the schedule once, now — a real agent execution, outside the
   * cron cadence. Resolves with the post-trigger schedule; refetch to
   * pick up the new `status.last_execution_id`.
   */
  readonly triggerSchedule: (scheduleId: string) => Promise<Schedule>;
  /** `true` while the trigger request is in flight. */
  readonly isTriggering: boolean;
  /** Error from the last failed or refused trigger, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that fires a schedule once, immediately.
 *
 * The server enforces a refusal matrix — a disabled schedule refuses
 * first, then a paused one — both as `FAILED_PRECONDITION` with copy
 * that names the remedy ("enable it before triggering" / "resume it
 * before triggering"). Error toasts relay that copy verbatim; the copy
 * is byte-identical across editions.
 *
 * Triggering starts a real, billable execution — gate the call behind a
 * confirmation (the detail view uses `ConfirmDialog`).
 */
export function useTriggerSchedule(): UseTriggerScheduleReturn {
  const stigmer = useStigmer();
  const [isTriggering, setIsTriggering] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const triggerSchedule = useCallback(
    async (scheduleId: string): Promise<Schedule> => {
      setIsTriggering(true);
      setError(null);
      try {
        const triggered = await stigmer.schedule.trigger(scheduleId);
        toast.success("Run started");
        return triggered;
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
