"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { StigmerError } from "@stigmer/sdk";
import { GetWorkflowVersionInputSchema } from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";
import { computeUnifiedDiff, type DiffLine } from "./workflow-yaml-diff";

const CODE_UNIMPLEMENTED = 12;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Return value of {@link useWorkflowVersionDiff}. */
export interface UseWorkflowVersionDiffReturn {
  /** Array of diff lines, or `null` while loading / on error / when disabled. */
  readonly diff: readonly DiffLine[] | null;
  /** `true` while both versions are being fetched and diffed. */
  readonly isLoading: boolean;
  /** Error from the fetch or diff computation, or `null` when healthy. */
  readonly error: Error | null;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * Data hook that computes a unified YAML diff between two workflow versions.
 *
 * Fetches both version entries via `stigmer.workflow.getVersion()` in
 * parallel, extracts their `validatedYaml` fields, and runs
 * {@link computeUnifiedDiff} to produce a line-by-line diff result.
 *
 * **Graceful degradation**: If the backend returns UNIMPLEMENTED for
 * either fetch, the hook resolves to `null` without raising an error.
 *
 * Pass `null` for any parameter to disable fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { diff, isLoading } = useWorkflowVersionDiff(workflowId, hashA, hashB);
 *
 * if (diff) {
 *   return <DiffViewer lines={diff} />;
 * }
 * ```
 */
export function useWorkflowVersionDiff(
  workflowId: string | null,
  hashA: string | null,
  hashB: string | null,
): UseWorkflowVersionDiffReturn {
  const stigmer = useStigmer();
  const [diff, setDiff] = useState<readonly DiffLine[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fetchIdRef = useRef(0);

  const doFetch = useCallback(async () => {
    if (!workflowId || !hashA || !hashB) {
      setDiff(null);
      setError(null);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const [resultA, resultB] = await Promise.all([
        stigmer.workflow.getVersion(create(GetWorkflowVersionInputSchema, { workflowId, versionHash: hashA })),
        stigmer.workflow.getVersion(create(GetWorkflowVersionInputSchema, { workflowId, versionHash: hashB })),
      ]);

      if (fetchIdRef.current !== fetchId) return;

      const yamlA = resultA.validatedYaml ?? "";
      const yamlB = resultB.validatedYaml ?? "";

      const diffResult = computeUnifiedDiff(yamlA, yamlB);

      if (fetchIdRef.current !== fetchId) return;
      setDiff(diffResult);
    } catch (err) {
      if (fetchIdRef.current !== fetchId) return;
      if (isUnimplemented(err)) {
        setDiff(null);
      } else {
        setError(toError(err));
        setDiff(null);
      }
    } finally {
      if (fetchIdRef.current === fetchId) {
        setIsLoading(false);
      }
    }
  }, [workflowId, hashA, hashB, stigmer]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  return useMemo(
    () => ({ diff, isLoading, error }),
    [diff, isLoading, error],
  );
}

// ---------------------------------------------------------------------------
// Error detection
// ---------------------------------------------------------------------------

function isUnimplemented(err: unknown): boolean {
  return err instanceof StigmerError && err.connectCode === CODE_UNIMPLEMENTED;
}
