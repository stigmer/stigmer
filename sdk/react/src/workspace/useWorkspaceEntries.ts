"use client";

import { useCallback, useMemo, useState } from "react";
import type { WorkspaceEntryInput, WorkspaceSourceInput } from "@stigmer/sdk";

/**
 * A single workspace entry managed by {@link useWorkspaceEntries}.
 *
 * Each entry represents a code source (git repository or local directory)
 * added by the user before starting an agent session.
 *
 * @example
 * ```tsx
 * const workspace = useWorkspaceEntries();
 *
 * workspace.entries.map((entry) => (
 *   <div key={entry.id}>
 *     <span>{entry.type === "git" ? "GitHub" : "Local"}</span>
 *     <span>{entry.name}</span>
 *     <button onClick={() => workspace.remove(entry.id)}>Remove</button>
 *   </div>
 * ));
 * ```
 */
export interface WorkspaceEntry {
  /** Stable client-side identifier used as a React key and for removal. */
  readonly id: string;
  /** Display name derived from the git URL or local path. */
  readonly name: string;
  /** Source type: `"git"` for remote repositories, `"local"` for filesystem paths. */
  readonly type: "git" | "local";
  /** Repository URL. Set when `type` is `"git"`. */
  readonly gitUrl?: string;
  /** Branch to clone. Set when `type` is `"git"`. */
  readonly gitBranch?: string;
  /** Absolute filesystem path. Set when `type` is `"local"`. */
  readonly localPath?: string;
}

/** Return value of {@link useWorkspaceEntries}. */
export interface UseWorkspaceEntriesReturn {
  /** Current workspace entries. */
  readonly entries: readonly WorkspaceEntry[];
  /** Add a git repository by URL with an optional branch. */
  readonly addGitRepo: (url: string, branch?: string) => void;
  /** Add a local filesystem directory by absolute path. */
  readonly addLocalPath: (path: string) => void;
  /** Remove an entry by its stable ID. */
  readonly remove: (id: string) => void;
  /** Remove all entries. */
  readonly clear: () => void;
  /** Remove all local folder entries, keeping git entries intact. */
  readonly clearLocal: () => void;
  /** Convert entries to the `WorkspaceEntryInput[]` shape required by the SDK. */
  readonly toInput: () => WorkspaceEntryInput[];
  /** `true` when at least one entry exists. */
  readonly hasEntries: boolean;
}

let nextId = 0;
function uid(): string {
  return `ws-${++nextId}-${Date.now()}`;
}

function deriveNameFromGitUrl(url: string): string {
  const cleaned = url.replace(/\/+$/, "").replace(/\.git$/, "");
  const segments = cleaned.split("/");
  if (segments.length >= 2) {
    return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
  }
  return segments[segments.length - 1] ?? url;
}

function deriveNameFromPath(path: string): string {
  const cleaned = path.replace(/[/\\]+$/, "");
  if (!cleaned) return path;

  const segments = cleaned.split(/[/\\]/);
  const last = segments[segments.length - 1];

  if (segments.length >= 2) {
    const parent = segments[segments.length - 2];
    return `${parent}/${last}`;
  }

  return last || path;
}

/**
 * Behavior hook that manages a workspace entry array with add, remove,
 * validate, and name-derivation logic.
 *
 * Encapsulates the non-trivial logic that platform builders should
 * not reimplement: URL validation, name derivation from git URLs or
 * local paths, and conversion to the SDK input shape.
 *
 * @example
 * ```tsx
 * function SessionSetup() {
 *   const workspace = useWorkspaceEntries();
 *
 *   return (
 *     <div>
 *       <WorkspaceEditor workspace={workspace} />
 *       <SessionComposer
 *         onSubmit={(msg) => createSession(msg, workspace.toInput())}
 *         workspace={workspace}
 *       />
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Programmatic entry management
 * const workspace = useWorkspaceEntries();
 * workspace.addGitRepo("https://github.com/acme/api.git", "main");
 * workspace.addLocalPath("/Users/dev/projects/frontend");
 * ```
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

  const clearLocal = useCallback(() => {
    setEntries((prev) => prev.filter((e) => e.type !== "local"));
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

  const hasEntries = entries.length > 0;

  return useMemo(
    () => ({
      entries,
      addGitRepo,
      addLocalPath,
      remove,
      clear,
      clearLocal,
      toInput,
      hasEntries,
    }),
    [entries, addGitRepo, addLocalPath, remove, clear, clearLocal, toInput, hasEntries],
  );
}
