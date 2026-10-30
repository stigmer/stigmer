"use client";

import { useMemo } from "react";
import type { FileChangeSet } from "@stigmer/apis/ai/stigmer/agentic/run/v1/filereview_pb";
import { displayFileChangeSets } from "@stigmer/client";
import { useStigmer } from "@stigmer/react-core";
import { useFetch } from "@stigmer/react-core/internal";

/** Return value of {@link useChangeSetCapture}. */
export interface UseChangeSetCaptureReturn {
  /** The captured change set (its files' before/after bytes), or `null` while loading or when the run holds none. */
  readonly capture: FileChangeSet | null;
  /** `true` while the run is being read. */
  readonly isLoading: boolean;
  /** Error from the read, or `null`. */
  readonly error: Error | null;
}

/**
 * Data hook that loads the captured bytes of one change set on demand: the
 * diff bodies a review card renders. A turn's review (what changed, what was
 * decided) comes from the session's events; the bytes stay on the turn's run
 * as its file record, read here through `run.get` and the run's file-review
 * projection (`displayFileChangeSets`).
 *
 * Idle until `enabled`, so a card reads the run only when its diffs are
 * shown. The read is cached per run across mounts.
 *
 * @param runId - The run that changed the files (`FileReviewSet.runId`).
 * @param changeSetId - The change set to find in that run.
 * @param enabled - When `false`, nothing is read.
 */
export function useChangeSetCapture(
  runId: string,
  changeSetId: string,
  enabled: boolean,
): UseChangeSetCaptureReturn {
  const stigmer = useStigmer();
  const active = enabled && runId !== "";
  const { data: run, isLoading, error } = useFetch(
    active ? () => stigmer.run.get(runId) : null,
    [runId, stigmer, active],
    null,
    { cacheKey: active ? `agent-execution:${runId}` : undefined },
  );
  const capture = useMemo(
    () => displayFileChangeSets(run?.status).find((set) => set.id === changeSetId) ?? null,
    [run, changeSetId],
  );
  return useMemo(
    () => ({ capture, isLoading: active && isLoading, error }),
    [capture, active, isLoading, error],
  );
}
