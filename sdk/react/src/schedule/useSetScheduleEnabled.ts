"use client";

import { useCallback, useMemo, useState } from "react";
import { clone } from "@bufbuild/protobuf";
import {
  ScheduleSchema,
  type Schedule,
} from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { getUserMessage, manifestDocumentForResource } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toast } from "../feedback/toast.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useSetScheduleEnabled}. */
export interface UseSetScheduleEnabledReturn {
  /**
   * Flip the owner's `spec.enabled` switch. Takes the full fetched
   * schedule (not just an id) because the write re-applies the whole
   * resource. Resolves with the post-apply schedule; the caller
   * refetches or replaces its local copy from it.
   */
  readonly setEnabled: (schedule: Schedule, enabled: boolean) => Promise<Schedule>;
  /** `true` while the apply is in flight. */
  readonly isPending: boolean;
  /** Error from the last failed apply, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that flips a schedule's owner-controlled `enabled` flag.
 *
 * The write path is deliberate: clone the fetched proto, flip one
 * field, and re-apply the WHOLE resource through the manifest engine
 * (`stigmer.manifest.apply`) — never down-convert to the curated
 * `ScheduleInput` shape. The server replaces spec and mutable metadata
 * wholesale on update, and `ScheduleInput` cannot express every
 * metadata field (tags, description), so the input route would silently
 * wipe them. The full-proto route is lossless by construction; the
 * server ignores client-provided status, and re-applying never clears a
 * platform pause (Resume is the one clearing path — see
 * {@link useResumeSchedule}).
 */
export function useSetScheduleEnabled(): UseSetScheduleEnabledReturn {
  const stigmer = useStigmer();
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const setEnabled = useCallback(
    async (schedule: Schedule, enabled: boolean): Promise<Schedule> => {
      if (!schedule.spec) {
        throw new Error(
          "Cannot toggle this schedule: it has no spec. Pass a schedule " +
            "as returned by the server (get/getByReference).",
        );
      }

      setIsPending(true);
      setError(null);
      try {
        const updated = clone(ScheduleSchema, schedule);
        updated.spec!.enabled = enabled;

        const applied = await stigmer.manifest.apply(
          manifestDocumentForResource(updated),
        );
        toast.success(enabled ? "Schedule enabled" : "Schedule disabled");
        return applied.message as Schedule;
      } catch (err) {
        const wrapped = toError(err);
        setError(wrapped);
        toast.error(getUserMessage(err));
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
