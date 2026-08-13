"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import { fetchAndUnpackArtifact } from "./internal/fetchAndUnpackArtifact.js";
import { computeMultiFileDiff } from "../version-history/computeMultiFileDiff.js";
import type { MultiFileDiffResult } from "../version-history/types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Return value of {@link useSkillDiff}. */
export interface UseSkillDiffReturn {
  /** Multi-file diff result, or `null` while loading / on error / when disabled. */
  readonly diff: MultiFileDiffResult | null;
  /** `true` while both artifacts are being fetched, unpacked, and diffed. */
  readonly isLoading: boolean;
  /** Error from the fetch/unpack/diff, or `null` when healthy. */
  readonly error: Error | null;
}

/**
 * Maximum COMBINED unpacked text of both artifacts (10 MB) — a browser
 * memory guard on holding and diffing two extracted file trees, NOT a
 * transport limit. The transfer lane (stigmer#675) removed the download
 * cap, so arbitrarily large valid skills can be *fetched*; what stays
 * bounded is what this hook is willing to diff in tab memory.
 */
const MAX_ARTIFACT_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * Data hook that fetches two skill version artifacts and computes a
 * multi-file diff between them.
 *
 * Takes two artifact storage keys (obtained from `useSkillVersions.getArtifactKey()`).
 * Fetches both ZIPs in parallel, unpacks them, and runs `computeMultiFileDiff`
 * on the extracted text file maps.
 *
 * Pass `null` for either key to disable fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { getArtifactKey } = useSkillVersions(org, slug);
 * const { diff, isLoading } = useSkillDiff(
 *   getArtifactKey(fromHash),
 *   getArtifactKey(toHash),
 * );
 * ```
 */
export function useSkillDiff(
  fromArtifactKey: string | null,
  toArtifactKey: string | null,
): UseSkillDiffReturn {
  const stigmer = useStigmer();
  const [diff, setDiff] = useState<MultiFileDiffResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const fetchIdRef = useRef(0);

  const doFetch = useCallback(async () => {
    if (!fromArtifactKey || !toArtifactKey) {
      setDiff(null);
      setError(null);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const [fromResult, toResult] = await Promise.all([
        fetchAndUnpackArtifact(stigmer, fromArtifactKey),
        fetchAndUnpackArtifact(stigmer, toArtifactKey),
      ]);

      if (fetchIdRef.current !== fetchId) return;

      const totalBytes = estimateMapSize(fromResult.contentMap) + estimateMapSize(toResult.contentMap);
      if (totalBytes > MAX_ARTIFACT_BYTES) {
        throw new Error(
          `Combined artifact size (${formatBytes(totalBytes)}) exceeds the ${formatBytes(MAX_ARTIFACT_BYTES)} limit. ` +
          "Try comparing smaller skill packages.",
        );
      }

      const result = computeMultiFileDiff(fromResult.contentMap, toResult.contentMap);

      if (fetchIdRef.current !== fetchId) return;
      setDiff(result);
    } catch (err) {
      if (fetchIdRef.current !== fetchId) return;
      setError(toError(err));
      setDiff(null);
    } finally {
      if (fetchIdRef.current === fetchId) {
        setIsLoading(false);
      }
    }
  }, [fromArtifactKey, toArtifactKey, stigmer]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  return useMemo(
    () => ({ diff, isLoading, error }),
    [diff, isLoading, error],
  );
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function estimateMapSize(map: ReadonlyMap<string, string>): number {
  let total = 0;
  for (const value of map.values()) {
    total += value.length * 2;
  }
  return total;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
