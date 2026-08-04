"use client";

import { useCallback, useState } from "react";
import type { ScheduleInput } from "@stigmer/sdk";
import type { Schedule } from "@stigmer/protos/ai/stigmer/agentic/schedule/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateSchedule}. */
export interface UseCreateScheduleReturn {
  /**
   * Submit a {@link ScheduleInput} to create (or upsert) a schedule.
   *
   * Uses `stigmer.schedule.apply()` — the idempotent upsert operation.
   * Resolves with the server-created `Schedule` proto including
   * populated metadata (id, slug, audit timestamps) and the
   * platform-computed `status.next_fire_at`.
   */
  readonly create: (input: ScheduleInput) => Promise<Schedule>;
  /** `true` while the apply request is in flight. */
  readonly isCreating: boolean;
  /** Error from the last failed create, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Behavior hook that wraps `schedule.apply()` with loading and error
 * state.
 *
 * Creates a schedule from a {@link ScheduleInput}. Uses `apply()`
 * (upsert) rather than `create()` so re-submissions are idempotent —
 * matching the CLI's `stigmer apply` semantics and the established SDK
 * mutation hook pattern (`isCreating` flag, `error` state, `clearError`
 * reset, result returned from the promise, not stored in hook state).
 *
 * NOTE: this hook is for CREATION. Editing an existing schedule must
 * NOT go through `ScheduleInput` — the input type cannot express every
 * metadata field (tags, description), and the server replaces spec and
 * mutable metadata wholesale on update, so a down-converting edit would
 * silently wipe them. Edit flows use the full-proto path instead (see
 * `useSetScheduleEnabled` for the pattern).
 *
 * @example
 * ```tsx
 * const { create, isCreating, error, clearError } = useCreateSchedule();
 *
 * const schedule = await create({
 *   name: "daily-fee-reminders",
 *   org: "acme",
 *   cron: "0 9 * * *",
 *   timeZone: "Asia/Kolkata",
 *   enabled: false,
 *   agent: {
 *     agentRef: { org: "acme", slug: "billing-assistant" },
 *     message: "Send today's fee reminders.",
 *   },
 * });
 * // schedule.metadata?.slug → "daily-fee-reminders"
 * ```
 */
export function useCreateSchedule(): UseCreateScheduleReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: ScheduleInput): Promise<Schedule> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.schedule.apply(input);
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsCreating(false);
      }
    },
    [stigmer],
  );

  return { create, isCreating, error, clearError };
}
