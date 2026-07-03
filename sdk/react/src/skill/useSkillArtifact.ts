"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStigmer } from "../hooks.js";
import { toError } from "../internal/toError.js";
import type { SkillFileEntry } from "./useSkillUpload.js";
import { fetchAndUnpackArtifact } from "./internal/fetchAndUnpackArtifact.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Return value of {@link useSkillArtifact}. */
export interface UseSkillArtifactReturn {
  /** File entries in the skill package, or `null` while loading/on error. */
  readonly files: SkillFileEntry[] | null;
  /** `true` while the artifact is being fetched and unpacked. */
  readonly isLoading: boolean;
  /** Error from the fetch/unpack, or `null` when healthy. */
  readonly error: Error | null;
  /** Get the text content of a file by path, or `null` if not available. */
  readonly getFileContent: (path: string) => string | null;
  /** Re-fetch the artifact from the server. */
  readonly refetch: () => void;
}

// ---------------------------------------------------------------------------
// Hook implementation
// ---------------------------------------------------------------------------

/**
 * Data hook that fetches and unpacks a skill's ZIP artifact for browsing.
 *
 * Uses `stigmer.skill.getArtifact()` with the skill's storage key,
 * then decompresses the ZIP using `fflate` to expose a file listing
 * and content retrieval.
 *
 * Pass `null` for `artifactStorageKey` to skip fetching (stable no-op).
 *
 * @example
 * ```tsx
 * const { skill } = useSkill(org, slug);
 * const { files, getFileContent, isLoading } = useSkillArtifact(
 *   skill?.status?.artifactStorageKey ?? null
 * );
 *
 * if (files) {
 *   const readme = getFileContent("SKILL.md");
 * }
 * ```
 */
export function useSkillArtifact(
  artifactStorageKey: string | null,
): UseSkillArtifactReturn {
  const stigmer = useStigmer();
  const [files, setFiles] = useState<SkillFileEntry[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const contentMapRef = useRef<Map<string, string>>(new Map());
  const fetchIdRef = useRef(0);

  const doFetch = useCallback(async () => {
    if (!artifactStorageKey) {
      setFiles(null);
      setError(null);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await fetchAndUnpackArtifact(stigmer, artifactStorageKey);

      if (fetchIdRef.current !== fetchId) return;

      contentMapRef.current = new Map(result.contentMap);
      setFiles(result.files);
    } catch (err) {
      if (fetchIdRef.current !== fetchId) return;
      setError(toError(err));
      setFiles(null);
    } finally {
      if (fetchIdRef.current === fetchId) {
        setIsLoading(false);
      }
    }
  }, [artifactStorageKey, stigmer]);

  useEffect(() => {
    doFetch();
  }, [doFetch]);

  const getFileContent = useCallback((path: string): string | null => {
    return contentMapRef.current.get(path) ?? null;
  }, []);

  const refetch = useCallback(() => {
    doFetch();
  }, [doFetch]);

  return useMemo(
    () => ({ files, isLoading, error, getFileContent, refetch }),
    [files, isLoading, error, getFileContent, refetch],
  );
}
