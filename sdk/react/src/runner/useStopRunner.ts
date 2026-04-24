"use client";

import { useCallback, useState } from "react";
import { create } from "@bufbuild/protobuf";
import type { Runner } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/api_pb";
import { RunnerStopInputSchema } from "@stigmer/protos/ai/stigmer/agentic/runner/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** Input for {@link UseStopRunnerReturn.stop}. */
export interface StopRunnerInput {
  /** ID of the runner to stop. */
  readonly runnerId: string;
  /**
   * Optional reason for the stop, logged on the runner and in audit.
   *
   * @example "user requested via web console"
   */
  readonly reason?: string;
}

/** Return value of {@link useStopRunner}. */
export interface UseStopRunnerReturn {
  /**
   * Stop a runner gracefully.
   *
   * If the runner is connected, sends a stop command via the bidi stream
   * and waits for acknowledgment. If offline, directly transitions to
   * STOPPED. Idempotent — stopping an already-stopped or failed runner
   * returns the resource as-is.
   *
   * Resolves with the updated {@link Runner} resource.
   */
  readonly stop: (input: StopRunnerInput) => Promise<Runner>;
  /** `true` while the stop RPC is in flight. */
  readonly isStopping: boolean;
  /** Error from the last failed stop attempt, or `null` when healthy. */
  readonly error: Error | null;
  /** Reset `error` to `null`. */
  readonly clearError: () => void;
}

/**
 * Mutation hook that wraps `runner.stop()` with loading and error state.
 *
 * Stops a runner gracefully. Connected runners receive a stop command
 * via the bidi stream; offline runners transition directly to STOPPED.
 * The operation is idempotent — stopping an already-stopped or failed
 * runner succeeds without error.
 *
 * Returns the updated {@link Runner} resource on success so callers
 * can reflect the new phase in the UI without a separate refetch.
 *
 * @example
 * ```tsx
 * const { stop, isStopping, error } = useStopRunner();
 *
 * await stop({ runnerId: "rnr_abc123", reason: "user requested" });
 * refetch(); // refresh the runner list
 * ```
 */
export function useStopRunner(): UseStopRunnerReturn {
  const stigmer = useStigmer();
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const clearError = useCallback(() => setError(null), []);

  const stop = useCallback(
    async (input: StopRunnerInput): Promise<Runner> => {
      setIsStopping(true);
      setError(null);

      try {
        return await stigmer.runner.stop(
          create(RunnerStopInputSchema, {
            runnerId: input.runnerId,
            reason: input.reason ?? "",
          }),
        );
      } catch (err) {
        setError(toError(err));
        throw err;
      } finally {
        setIsStopping(false);
      }
    },
    [stigmer],
  );

  return { stop, isStopping, error, clearError };
}
