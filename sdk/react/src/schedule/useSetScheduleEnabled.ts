"use client";

import { useCallback, useMemo, useState } from "react";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toast } from "../feedback/toast.js";
import { saveErrorMessage } from "../internal/maskedEdit.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useSetScheduleEnabled}. */
export interface UseSetScheduleEnabledReturn {
  /**
   * Flip the owner's `spec.enabled` switch on the schedule as loaded.
   * Resolves with the updated schedule; the caller refetches or replaces
   * its local copy from it.
   */
  readonly setEnabled: (schedule: Schedule, enabled: boolean) => Promise<Schedule>;
  /** `true` while the update is in flight. */
  readonly isPending: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that flips a schedule's owner-controlled `enabled` flag.
 *
 * The update names `spec.enabled` alone, on the schedule as loaded (its
 * id, and the etag it was read at): every other field keeps its stored
 * value, so a teammate's edit to the cron or the target survives the
 * flip, and a schedule changed since it was loaded refuses it (the toast
 * says to reload). Flipping never clears a platform pause (Resume is the
 * one clearing path — see {@link useResumeSchedule}).
 */
export function useSetScheduleEnabled(): UseSetScheduleEnabledReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const setEnabled = useCallback(
    async (schedule: Schedule, enabled: boolean): Promise<Schedule> => {
      setIsPending(true);
      setError(null);
      try {
        const updated = await stigmer.schedule.update(
          {
            metadata: { id: schedule.metadata?.id ?? "", etag: schedule.metadata?.etag ?? "" },
            spec: { enabled },
          },
          ["spec.enabled"],
        );
        toast.success(enabled ? "Schedule enabled" : "Schedule disabled");
        return updated;
      } catch (err) {
        const wrapped = toError(err);
        setError(wrapped);
        toast.error(saveErrorMessage(err, "schedule"));
        throw wrapped;
      } finally {
        setIsPending(false);
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ setEnabled, isPending, error }),
    [setEnabled, isPending, error],
  );
}
