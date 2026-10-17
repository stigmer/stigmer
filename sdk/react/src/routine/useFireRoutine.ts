"use client";

import { useCallback, useMemo, useState } from "react";
import { create } from "@bufbuild/protobuf";
import {
  FireRoutineInputSchema,
  RoutineFireOutcome,
  type RoutineFireResult,
} from "@stigmer/protos/ai/stigmer/agentic/routine/v1/io_pb";
import { getUserMessage } from "@stigmer/sdk";
import { useStigmer } from "../hooks.js";
import { toast } from "../feedback/toast.js";
import { toError } from "../internal/toError.js";

/** Return value of {@link useFireRoutine}. */
export interface UseFireRoutineReturn {
  /**
   * Fire the routine once, now — a real run, acting as the routine's
   * owner, outside its schedule. `text`, when given, reaches the run
   * fenced as information from whoever started it. Resolves with the
   * {@link RoutineFireResult}: the run's REAL outcome (started with a run
   * id, or refused with the gate's copy), so a caller can navigate to the
   * run or surface the refusal. Refetch the routine afterwards to pick up
   * the freshly stamped `status.last_fire_at` / `status.last_run_id`.
   */
  readonly fireRoutine: (routineId: string, text?: string) => Promise<RoutineFireResult>;
  /** `true` while the fire request is in flight. */
  readonly isFiring: boolean;
  /** Error from the last failed or refused fire, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Behavior hook that fires a routine once, immediately, and reports the
 * run's real outcome.
 *
 * A fire is a two-level contract, and this hook honors both levels:
 *
 * - A **gRPC error** means the fire itself was refused — a disabled
 *   routine answers `FAILED_PRECONDITION` with copy that names the
 *   remedy ("enable it before firing"). The error toast relays that
 *   copy verbatim (byte-identical across editions) and the promise
 *   rejects.
 * - A **success** means the fire happened. The result's `outcome` then
 *   says what the RUN did: `STARTED` (a run was created — a
 *   success toast), or `REFUSED` / `TARGET_MISSING` (a launch gate said
 *   no — an error toast carrying the gate's `refusalReason` verbatim).
 *   The promise RESOLVES in every one of these cases: a refused run is a
 *   successful fire honestly reported, and the caller decides what to
 *   do with it (navigate to the run, show the reason).
 *
 * Firing starts a real, billable run — gate the call behind a
 * confirmation (the detail view uses `ConfirmDialog`).
 */
export function useFireRoutine(): UseFireRoutineReturn {
  const stigmer = useStigmer();
  const [isFiring, setIsFiring] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fireRoutine = useCallback(
    async (routineId: string, text = ""): Promise<RoutineFireResult> => {
      setIsFiring(true);
      setError(null);
      try {
        const result = await stigmer.routine.fire(create(FireRoutineInputSchema, { id: routineId, text }));
        if (result.outcome === RoutineFireOutcome.STARTED) {
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
        setIsFiring(false);
      }
    },
    [stigmer],
  );

  return useMemo(
    () => ({ fireRoutine, isFiring, error }),
    [fireRoutine, isFiring, error],
  );
}
