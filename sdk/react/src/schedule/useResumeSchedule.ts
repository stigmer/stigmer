"use client";

import { useCallback, useMemo, useState } from "react";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toast } from "../feedback/toast.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useResumeSchedule}. */
export interface UseResumeScheduleReturn {
  /**
   * Clear the platform's failure-streak pause and let the schedule fire
   * again. Resolves with the post-resume schedule; the caller refetches
   * or replaces its local copy from it.
   */
  readonly resumeSchedule: (scheduleId: string) => Promise<Schedule>;
  /** `true` while the resume request is in flight. */
  readonly isResuming: boolean;
  /** Error from the last failed resume, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that resumes a platform-paused schedule.
 *
 * Resume is the ONE path that clears `status.paused_reason` (and the
 * failure streak with it) — re-applying the manifest deliberately does
 * not, so a routine GitOps apply can never silently un-pause a failing
 * schedule. Resuming a schedule that is not paused is a server-side
 * no-op; resuming a disabled schedule clears the pause but the schedule
 * stays disabled (the owner's lever is separate — see
 * {@link useSetScheduleEnabled}).
 *
 * Error toasts relay the server's message verbatim: the copy is
 * identical across editions and states the remedy.
 */
export function useResumeSchedule(): UseResumeScheduleReturn {
  const stigmer = useStigmer();
  const [isResuming, setIsResuming] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const resumeSchedule = useCallback(
    async (scheduleId: string): Promise<Schedule> => {
      setIsResuming(true);
      setError(null);
      try {
        const resumed = await stigmer.schedule.resume(scheduleId);
        toast.success("Schedule resumed");
        return resumed;
      } catch (err) {
        const wrapped = toError(err);
        setError(wrapped);
        toast.error(getUserMessage(err));
        throw wrapped;
      } finally {
        setIsResuming(false);
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ resumeSchedule, isResuming, error }),
    [resumeSchedule, isResuming, error],
  );
}
