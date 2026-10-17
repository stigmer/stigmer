"use client";

import { useCallback, useState } from "react";
import type { RoutineInput } from "@stigmer/sdk";
import type { Routine } from "@stigmer/protos/ai/stigmer/agentic/routine/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useCreateRoutine}. */
export interface UseCreateRoutineReturn {
  /**
   * Submit a {@link RoutineInput} to create (or upsert) a schedule.
   *
   * Uses `stigmer.routine.apply()` — the idempotent upsert operation.
   * Resolves with the server-created `Schedule` proto including
   * populated metadata (id, slug, audit timestamps) and the
   * platform-computed `status.next_fire_at`.
   */
  readonly create: (input: RoutineInput) => Promise<Routine>;
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
 * Creates a schedule from a {@link RoutineInput}. Uses `apply()`
 * (upsert) rather than `create()` so re-submissions are idempotent —
 * matching the CLI's `stigmer apply` semantics and the established SDK
 * mutation hook pattern (`isCreating` flag, `error` state, `clearError`
 * reset, result returned from the promise, not stored in hook state).
 *
 * NOTE: this hook is for CREATION. Editing an existing schedule must
 * NOT go through `RoutineInput` — the input type cannot express every
 * metadata field (tags, description), and the server replaces spec and
 * mutable metadata wholesale on update, so a down-converting edit would
 * silently wipe them. Edit flows use the full-proto path instead (see
 * `useSetRoutineEnabled` for the pattern).
 *
 * @example
 * ```tsx
 * const { create, isCreating, error, clearError } = useCreateRoutine();
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
export function useCreateRoutine(): UseCreateRoutineReturn {
  const stigmer = useStigmer();
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (input: RoutineInput): Promise<Routine> => {
      setIsCreating(true);
      setError(null);

      try {
        return await stigmer.routine.apply(input);
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
