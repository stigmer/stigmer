"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { create } from "@bufbuild/protobuf";
import { GetArtifactRequestSchema } from "@stigmer/protos/ai/stigmer/agentic/skill/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";
import type { SkillFileEntry } from "./useSkillUpload";

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

  const fetchAndUnpack = useCallback(async () => {
    if (!artifactStorageKey) {
      setFiles(null);
      setError(null);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);
    setError(null);

    try {
      const request = create(GetArtifactRequestSchema, { artifactStorageKey });
      const response = await stigmer.skill.getArtifact(request);

      if (fetchIdRef.current !== fetchId) return;

      const { unzipSync, strFromU8 } = await import("fflate");
      const unzipped = unzipSync(response.artifact);

      if (fetchIdRef.current !== fetchId) return;

      const entries = Object.entries(unzipped);
      const fileEntries: SkillFileEntry[] = entries.map(([path, data]) => ({
        path,
        size: data.length,
        isDirectory: data.length === 0 && path.endsWith("/"),
      }));

      const contentMap = new Map<string, string>();
      for (const [path, data] of entries) {
        if (!path.endsWith("/") && data.length > 0) {
          try {
            contentMap.set(path, strFromU8(data));
          } catch {
            contentMap.set(path, "[Binary content]");
          }
        }
      }

      contentMapRef.current = contentMap;
      setFiles(fileEntries);
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
    fetchAndUnpack();
  }, [fetchAndUnpack]);

  const getFileContent = useCallback((path: string): string | null => {
    return contentMapRef.current.get(path) ?? null;
  }, []);

  const refetch = useCallback(() => {
    fetchAndUnpack();
  }, [fetchAndUnpack]);

  return useMemo(
    () => ({ files, isLoading, error, getFileContent, refetch }),
    [files, isLoading, error, getFileContent, refetch],
  );
}
