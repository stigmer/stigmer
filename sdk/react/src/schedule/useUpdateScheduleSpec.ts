"use client";

import { useCallback, useMemo, useState } from "react";
import { clone, create, equals } from "@bufbuild/protobuf";
import { reflect } from "@bufbuild/protobuf/reflect";
import type { Schedule } from "@stigmer/apis/ai/stigmer/agentic/schedule/v1/api_pb";
import {
  ScheduleSpecSchema,
  type ScheduleSpec,
} from "@stigmer/apis/ai/stigmer/agentic/schedule/v1/spec_pb";
import { useStigmer } from "../hooks.js";
import { toast } from "../feedback/toast.js";
import { saveErrorMessage } from "../internal/maskedEdit.js";

/** Return value of {@link useUpdateScheduleSpec}. */
export interface UseUpdateScheduleSpecReturn {
  /**
   * Apply one spec mutation to the schedule as loaded. Resolves with the
   * updated schedule (the loaded one when the mutation changed nothing);
   * the caller refetches or replaces its local copy from it.
   */
  readonly updateSpec: (
    schedule: Schedule,
    mutate: (spec: ScheduleSpec) => void,
  ) => Promise<Schedule>;
  /** `true` while the update is in flight. */
  readonly isUpdating: boolean;
  /** Error from the last failed update, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook behind the schedule detail view's inline editing: one
 * spec mutation, saved as an update that names exactly the spec fields it
 * changed ({@link changedSpecPaths}), on the schedule as loaded (its id
 * and the etag it was read at). Every field the mutation leaves alone
 * keeps its stored value, so a teammate's change to another field
 * survives, and a schedule changed since it was loaded refuses the save.
 * An edit never clears a platform pause (Resume is the one clearing
 * path — see `useResumeSchedule`).
 *
 * Errors are NOT toasted here: inline editors surface the server's
 * message next to the field that was edited, and a toast on
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

      const edited = clone(ScheduleSpecSchema, schedule.spec);
      mutate(edited);
      const paths = changedSpecPaths(schedule.spec, edited);
      if (paths.length === 0) {
        return schedule;
      }

      setIsUpdating(true);
      setError(null);
      try {
        const updated = await stigmer.schedule.update(
          {
            metadata: { id: schedule.metadata?.id ?? "", etag: schedule.metadata?.etag ?? "" },
            spec: edited,
          },
          paths,
        );
        toast.success("Schedule updated");
        return updated;
      } catch (err) {
        // Rethrow with the user-facing message: the inline editors render
        // `message` verbatim next to the edited field.
        const wrapped = new Error(saveErrorMessage(err, "schedule"));
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

/**
 * The mask paths of a spec edit: `spec.<field>` for each top-level spec
 * field whose value the edit changed (a oneof member by its own name).
 */
export function changedSpecPaths(before: ScheduleSpec, after: ScheduleSpec): string[] {
  const from = reflect(ScheduleSpecSchema, before);
  const to = reflect(ScheduleSpecSchema, after);
  return ScheduleSpecSchema.fields
    .filter((field) => {
      const one = reflect(ScheduleSpecSchema, create(ScheduleSpecSchema));
      const other = reflect(ScheduleSpecSchema, create(ScheduleSpecSchema));
      if (from.isSet(field)) one.set(field, from.get(field));
      if (to.isSet(field)) other.set(field, to.get(field));
      return !equals(ScheduleSpecSchema, one.message as ScheduleSpec, other.message as ScheduleSpec);
    })
    .map((field) => `spec.${field.name}`);
}
