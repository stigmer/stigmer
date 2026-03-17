"use client";

import { useCallback, useState } from "react";
import type { WorkspaceEntryInput, WorkspaceSourceInput } from "@stigmer/sdk";

export interface WorkspaceEntry {
  readonly id: string;
  readonly name: string;
  readonly type: "git" | "local";
  readonly gitUrl?: string;
  readonly gitBranch?: string;
  readonly localPath?: string;
}

export interface UseWorkspaceEntriesReturn {
  readonly entries: readonly WorkspaceEntry[];
  readonly addGitRepo: (url: string, branch?: string) => void;
  readonly addLocalPath: (path: string) => void;
  readonly remove: (id: string) => void;
  readonly clear: () => void;
  readonly toInput: () => WorkspaceEntryInput[];
  readonly hasEntries: boolean;
}

let nextId = 0;
function uid(): string {
  return `ws-${++nextId}-${Date.now()}`;
}

function deriveNameFromGitUrl(url: string): string {
  const segments = url.replace(/\/+$/, "").split("/");
  const last = segments[segments.length - 1] ?? url;
  return last.replace(/\.git$/, "");
}

function deriveNameFromPath(path: string): string {
  const segments = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return segments[segments.length - 1] ?? path;
}

/**
 * Behavior hook that manages a workspace entry array with add, remove,
 * validate, and name-derivation logic.
 *
 * Encapsulates the non-trivial logic that platform builders should
 * not reimplement: URL validation, name derivation from git URLs or
 * local paths, and conversion to the SDK input shape.
 */
export function useWorkspaceEntries(): UseWorkspaceEntriesReturn {
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);

  const addGitRepo = useCallback((url: string, branch?: string) => {
    const name = deriveNameFromGitUrl(url);
    setEntries((prev) => [
      ...prev,
      { id: uid(), name, type: "git", gitUrl: url, gitBranch: branch },
    ]);
  }, []);

  const addLocalPath = useCallback((path: string) => {
    const name = deriveNameFromPath(path);
    setEntries((prev) => [
      ...prev,
      { id: uid(), name, type: "local", localPath: path },
    ]);
  }, []);

  const remove = useCallback((id: string) => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clear = useCallback(() => {
    setEntries([]);
  }, []);

  const toInput = useCallback((): WorkspaceEntryInput[] => {
    return entries.map((entry): WorkspaceEntryInput => {
      const source: WorkspaceSourceInput =
        entry.type === "git"
          ? { gitRepo: { url: entry.gitUrl!, branch: entry.gitBranch } }
          : { localPath: { path: entry.localPath } };

      return { name: entry.name, source };
    });
  }, [entries]);

  return {
    entries,
    addGitRepo,
    addLocalPath,
    remove,
    clear,
    toInput,
    hasEntries: entries.length > 0,
  };
}
