"use client";

/**
 * Data hook for one eval run, read again while it runs so its tries fill in
 * as they finish.
 *
 * Polling, not a stream: an eval lasts minutes and changes a try at a time,
 * so a read every {@link EVAL_RUN_POLL_MS} is cheap and needs no server
 * push. The hook stops asking once the eval run is completed, partial or
 * failed, or once a read answers that it is gone or not the
 * caller's to read (NotFound, PermissionDenied), which asking again would
 * not change; a transient failure keeps the polling. An empty id asks
 * nothing. Pinned by `__tests__/hooks.test.tsx`.
 */

import { useEffect, useMemo, useState } from "react";
import { isNotFound, isPermissionDenied } from "@stigmer/sdk";
import type { EvalRun } from "@stigmer/protos/ai/stigmer/agentic/evalrun/v1/api_pb";
import { useStigmer } from "../hooks.js";
import { useFetch } from "../internal/useFetch.js";
import { isEvalActive } from "./eval-view.js";

/** How often a pending or running eval run is read again, in milliseconds. */
export const EVAL_RUN_POLL_MS = 3_000;

/** Return value of {@link useEvalRun}. */
export interface UseEvalRunReturn {
  /** The eval run, or `null` while loading. */
  readonly evalRun: EvalRun | null;
  /** `true` while the initial fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Re-fetch the eval run (after a cancel). */
  readonly refetch: () => void;
}

/**
 * Data hook that loads one {@link EvalRun} through `evalrun.get()` and,
 * while it is pending or running, reads it again every
 * {@link EVAL_RUN_POLL_MS} so its tries fill in as they finish. Polling
 * stops once the eval run is completed, partial or failed, or a read
 * answers NotFound or PermissionDenied.
 *
 * Pass an empty `id` to skip fetching.
 *
 * @example
 * ```tsx
 * const { evalRun } = useEvalRun("evr_01j5q3k7m8r2s4tnz2hfp0q0c3");
 * ```
 */
export function useEvalRun(id: string): UseEvalRunReturn {
  const stigmer = useStigmer();
  // Asks again until the first answer says the eval run has finished.
  const [polling, setPolling] = useState(true);

  const { data, isLoading, error, refetch } = useFetch(
    id
      ? async (): Promise<EvalRun | null> => stigmer.evalrun.get(id)
      : null,
    [id, stigmer],
    null,
    { refetchInterval: polling ? EVAL_RUN_POLL_MS : false },
  );

  useEffect(() => {
    if (data !== null) setPolling(isEvalActive(data));
  }, [data]);

  // A deleted eval run, or one the caller may no longer read, answers the same
  // every time: polling it would only repeat the failure.
  useEffect(() => {
    if (error !== null && (isNotFound(error) || isPermissionDenied(error))) {
      setPolling(false);
    }
  }, [error]);

  return useMemo(
    () => ({ evalRun: data, isLoading, error, refetch }),
    [data, isLoading, error, refetch],
  );
}
