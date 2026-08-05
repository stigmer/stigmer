"use client";

import { useCallback, useMemo, useState } from "react";
import { clone } from "@bufbuild/protobuf";
import {
  ScheduleSchema,
  type Schedule,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import type { ScheduleSpec } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/spec_pb";
import { getUserMessage, manifestDocumentForResource } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toast } from "../feedback/toast.js";

/** Return value of {@link useUpdateScheduleSpec}. */
export interface UseUpdateScheduleSpecReturn {
  /**
   * Apply one spec mutation to the schedule. Takes the full fetched
   * schedule (not just an id) because the write re-applies the whole
   * resource. Resolves with the post-apply schedule; the caller
   * refetches or replaces its local copy from it.
   */
  readonly updateSpec: (
    schedule: Schedule,
    mutate: (spec: ScheduleSpec) => void,
  ) => Promise<Schedule>;
  /** `true` while the apply is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed apply, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook behind the schedule detail view's inline editing: apply
 * a single spec mutation losslessly.
 *
 * The write path is deliberate, and it is NOT the agent detail view's
 * input-based one: clone the fetched proto, let the caller mutate the
 * spec in place, and re-apply the WHOLE resource through the manifest
 * engine (`stigmer.manifest.apply`) — never down-convert to the curated
 * `ScheduleInput` shape. The server replaces spec and mutable metadata
 * wholesale on update, and `ScheduleInput` cannot express every
 * metadata field (tags, description), so the input route would silently
 * wipe them. The full-proto route is lossless by construction; the
 * server ignores client-provided status, and re-applying never clears a
 * platform pause (Resume is the one clearing path — see
 * `useResumeSchedule`). Same mechanics as {@link useSetScheduleEnabled},
 * generalized from one hardcoded field to any spec edit.
 *
 * Errors are NOT toasted here: inline editors surface the server's
 * message next to the field that was edited (DD-006), and a toast on
 * top would say the same thing twice.
 *
 * @example
 * ```tsx
 * const { updateSpec, isUpdating } = useUpdateScheduleSpec();
 *
 * await updateSpec(schedule, (spec) => {
 *   spec.cron = "0 9 * * 1-5";
 *   spec.timeZone = "Asia/Kolkata";
 * });
 * ```
 */
export function useUpdateScheduleSpec(): UseUpdateScheduleSpecReturn {
  const stigmer = useStigmer();
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const updateSpec = useCallback(
    async (
      schedule: Schedule,
      mutate: (spec: ScheduleSpec) => void,
    ): Promise<Schedule> => {
      if (!schedule.spec) {
        throw new Error(
          "Cannot edit this schedule: it has no spec. Pass a schedule " +
            "as returned by the server (get/getByReference).",
        );
      }

      setIsUpdating(true);
      setError(null);
      try {
        const updated = clone(ScheduleSchema, schedule);
        mutate(updated.spec!);

        const applied = await stigmer.manifest.apply(
          manifestDocumentForResource(updated),
        );
        toast.success("Schedule updated");
        return applied.message as Schedule;
      } catch (err) {
        // Rethrow with the user-facing message: the inline editors render
        // `message` verbatim next to the edited field.
        const wrapped = new Error(getUserMessage(err));
        setError(wrapped);
        throw wrapped;
      } finally {
        setIsUpdating(false);
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ updateSpec, isUpdating, error }),
    [updateSpec, isUpdating, error],
  );
}
