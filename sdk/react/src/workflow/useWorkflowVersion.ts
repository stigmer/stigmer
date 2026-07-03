"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { StigmerError } from "@stigmer/sdk";
import {
  GetWorkflowVersionInputSchema,
  type WorkflowVersionEntry,
} from "@stigmer/protos/ai/stigmer/agentic/workflow/v1/version_pb";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";

const CODE_UNIMPLEMENTED = 12;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Return value of {@link useWorkflowVersion}. */
export interface UseWorkflowVersionReturn {
  /** The resolved version entry, or `null` while loading / on error / when disabled. */
  readonly version: WorkflowVersionEntry | null;
  /** `true` while the fetch is in flight. */
  readonly isLoading: boolean;
  /** Error from the last failed request, or `null` when healthy. */
  readonly error: Error | null;
  /** Discard cached data and re-fetch from the server. */
  readonly refetch: () => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * Data hook that fetches a single workflow version entry by ID and hash.
 *
 * Calls `stigmer.workflow.getVersion()` to retrieve the full version
 * details for a specific content hash. Useful for inspecting a
 * particular historical version outside the timeline listing.
 *
 * **Graceful degradation**: If the backend returns UNIMPLEMENTED, the
 * hook resolves to `null` without raising an error.
 *
 * Pass `null` for either `workflowId` or `versionHash` to skip
 * fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { version, isLoading } = useWorkflowVersion(workflowId, selectedHash);
 *
 * if (version) {
 *   return <pre>{version.validatedYaml}</pre>;
 * }
 * ```
 */
export function useWorkflowVersion(
  workflowId: string | null,
  versionHash: string | null,
): UseWorkflowVersionReturn {
  const stigmer = useStigmer();
  const [version, setVersion] = useState<WorkflowVersionEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fetchIdRef = useRef(0);

  const doFetch = useCallback(async () => {
    if (!workflowId || !versionHash) {
      setVersion(null);
      setError(null);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await stigmer.workflow.getVersion(
        create(GetWorkflowVersionInputSchema, { workflowId, versionHash }),
      );

      if (fetchIdRef.current !== fetchId) return;
      setVersion(result);
    } catch (err) {
      if (fetchIdRef.current !== fetchId) return;
      if (isUnimplemented(err)) {
        setVersion(null);
      } else {
        setError(toError(err));
        setVersion(null);
      }
    } finally {
      if (fetchIdRef.current === fetchId) {
        setIsLoading(false);
      }
    }
  }, [workflowId, versionHash, stigmer]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  const refetch = useCallback(() => {
    doFetch();
  }, [doFetch]);

  return useMemo(
    () => ({ version, isLoading, error, refetch }),
    [version, isLoading, error, refetch],
  );
}

// ---------------------------------------------------------------------------
// Error detection
// ---------------------------------------------------------------------------

function isUnimplemented(err: unknown): boolean {
  return err instanceof StigmerError && err.connectCode === CODE_UNIMPLEMENTED;
}
