"use client";

import { useCallback, useMemo, useState } from "react";

export interface UseFileReferencesReturn {
  /** Current workspace-relative file paths. */
  readonly refs: readonly string[];
  /** Whether any file references are present. */
  readonly hasRefs: boolean;
  /** Add a workspace-relative path. No-op if already present. */
  add(path: string): void;
  /** Remove a specific path. */
  remove(path: string): void;
  /** Remove all file references. */
  clear(): void;
}

/**
 * Behavior hook managing workspace file references for the composer.
 *
 * File references are lightweight "attention" signals — workspace-relative
 * paths the user wants the agent to focus on. Unlike attachments, they
 * require no upload; the agent reads them directly from the workspace
 * filesystem post-provisioning.
 *
 * This hook is independently importable by platform builders who want
 * to manage file references with their own UI (headless-first, DD-003).
 */
export function useFileReferences(): UseFileReferencesReturn {
  const [refs, setRefs] = useState<string[]>([]);

  const add = useCallback((path: string) => {
    setRefs((prev) => {
      if (prev.includes(path)) return prev;
      return [...prev, path];
    });
  }, []);

  const remove = useCallback((path: string) => {
    setRefs((prev) => {
      const next = prev.filter((p) => p !== path);
      if (next.length === prev.length) return prev;
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setRefs((prev) => (prev.length === 0 ? prev : []));
  }, []);

  return useMemo(
    () => ({ refs, hasRefs: refs.length > 0, add, remove, clear }),
    [refs, add, remove, clear],
  );
}
