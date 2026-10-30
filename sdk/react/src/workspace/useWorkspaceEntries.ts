"use client";

import { useCallback, useMemo, useState } from "react";
import type { SessionResourceInput } from "@stigmer/client";
import type { GitWriteBackMode } from "@stigmer/apis/ai/stigmer/agentic/session/v1/enum_pb";

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
  /**
   * The commit the repository is pinned to. Kept from the stored
   * repository when a saved workspace is loaded; never set by the editor,
   * so a repository removed and added again starts unpinned.
   */
  readonly gitCommit?: string;
  /**
   * The repository's git write-back mode. Kept from the stored repository
   * when a saved workspace is loaded; never set by the editor.
   */
  readonly gitWriteBackMode?: GitWriteBackMode;
  /**
   * The git ref (branch or commit SHA) at which read-side operations —
   * file content, tree listing, name search — resolve. Defaults to
   * `gitBranch` when absent.
   *
   * Never user-configured: a session derives it from the latest workspace
   * write-back so viewers read the agent's pushed commit instead of the
   * stale base branch (see `useWorkspaceReadRefs`). A read-side projection
   * only — never persisted, never part of the session input.
   */
  readonly readRef?: string;
  /** Absolute filesystem path. Set when `type` is `"local"`. */
  readonly localPath?: string;
}

/** Return value of {@link useWorkspaceEntries}. */
export interface UseWorkspaceEntriesReturn {
  /** Current workspace entries. */
  readonly entries: readonly WorkspaceEntry[];
  /**
   * Add a git repository by URL with an optional branch. The entry is named
   * after the URL unless `name` is given: pass the stored name when loading
   * a saved workspace, so a later write keeps the entry (and its stored
   * token) under the name it was saved with. Pass the stored commit and
   * write-back mode as `stored` too, so a later write keeps them.
   *
   * Names stay unique, because the server refuses a workspace that repeats
   * one: a name already taken gains the branch (`acme/api@dev`), then a
   * number (`acme/api-2`), so one repository can be added at two branches.
   */
  readonly addGitRepo: (
    url: string,
    branch?: string,
    name?: string,
    stored?: { readonly commit?: string; readonly writeBackMode?: GitWriteBackMode },
  ) => void;
  /**
   * Add a local filesystem directory by absolute path, named after its last
   * two path segments unless `name` is given: pass the stored name when
   * loading a saved workspace, because a folder's name is the directory it
   * is given in the workspace. A name already taken gains a number
   * (`dev/api-2`).
   */
  readonly addLocalPath: (path: string, name?: string) => void;
  /** Remove an entry by its stable ID. */
  readonly remove: (id: string) => void;
  /** Remove all entries. */
  readonly clear: () => void;
  /** Remove all local folder entries, keeping git entries intact. */
  readonly clearLocal: () => void;
  /**
   * The entries as a conversation's resources (`SessionInput.resources`):
   * each a named git repository or local folder. A conversation's Files are
   * resources too, but never workspace entries.
   */
  readonly toInput: () => SessionResourceInput[];
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

/**
 * The first of `base`, `base@qualifier` (when a qualifier is given) and
 * `base-2`, `base-3`, ... that no entry in `entries` carries.
 */
function uniqueName(
  entries: readonly WorkspaceEntry[],
  base: string,
  qualifier?: string,
): string {
  const taken = new Set(entries.map((e) => e.name));
  if (!taken.has(base)) return base;
  if (qualifier && !taken.has(`${base}@${qualifier}`)) return `${base}@${qualifier}`;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
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

  const addGitRepo = useCallback<UseWorkspaceEntriesReturn["addGitRepo"]>((url, branch, name, stored) => {
    const id = uid();
    const base = name || deriveNameFromGitUrl(url);
    setEntries((prev) => [
      ...prev,
      {
        id,
        name: uniqueName(prev, base, branch),
        type: "git",
        gitUrl: url,
        gitBranch: branch,
        ...(stored?.commit && { gitCommit: stored.commit }),
        ...(stored?.writeBackMode && { gitWriteBackMode: stored.writeBackMode }),
      },
    ]);
  }, []);

  const addLocalPath = useCallback((path: string, name?: string) => {
    const id = uid();
    const base = name || deriveNameFromPath(path);
    setEntries((prev) => [
      ...prev,
      { id, name: uniqueName(prev, base), type: "local", localPath: path },
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

  const toInput = useCallback((): SessionResourceInput[] => {
    return entries.map((entry): SessionResourceInput =>
      entry.type === "git"
        ? {
            name: entry.name,
            gitRepository: {
              url: entry.gitUrl!,
              branch: entry.gitBranch,
              ...(entry.gitCommit && { commit: entry.gitCommit }),
              ...(entry.gitWriteBackMode && { writeBackMode: entry.gitWriteBackMode }),
            },
          }
        : { name: entry.name, localPath: { path: entry.localPath } },
    );
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
