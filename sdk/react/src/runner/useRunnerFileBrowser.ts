"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { create } from "@bufbuild/protobuf";
import {
  RunnerSendCommandInputSchema,
  ListDirectoryRequestSchema,
  type DirectoryEntry,
} from "@stigmer/protos/ai/stigmer/agentic/runner/v1/io_pb";
import { useStigmer } from "../hooks";
import { toError } from "../internal/toError";

/** A single segment of the breadcrumb path bar. */
export interface PathSegment {
  /** Display name (directory name, or "/" for root). */
  readonly name: string;
  /** Absolute path up to and including this segment. */
  readonly path: string;
}

/** Return value of {@link useRunnerFileBrowser}. */
export interface UseRunnerFileBrowserReturn {
  /** Current resolved absolute path. */
  readonly currentPath: string;
  /** Directory entries for the current path. */
  readonly entries: readonly DirectoryEntry[];
  /** Breadcrumb segments for the current path. */
  readonly segments: readonly PathSegment[];
  /** Runner's home directory (enables Home shortcut). */
  readonly homeDirectory: string;
  /** Runner process's current working directory (enables CWD shortcut). */
  readonly currentDirectory: string;
  /** Whether hidden files are shown. */
  readonly showHidden: boolean;
  /** Toggle hidden file visibility. */
  readonly toggleHidden: () => void;
  /** True while a directory listing is in flight. */
  readonly isLoading: boolean;
  /** Error from the last navigation attempt. */
  readonly error: Error | null;
  /** Navigate into a child directory by name. */
  readonly navigateTo: (name: string) => void;
  /** Navigate to an absolute path. */
  readonly navigateToPath: (path: string) => void;
  /** Navigate to the parent directory. */
  readonly navigateUp: () => void;
  /** Navigate to the runner's home directory. */
  readonly navigateHome: () => void;
  /** Navigate to the runner's current working directory. */
  readonly navigateCwd: () => void;
  /** Retry the last failed navigation. */
  readonly retry: () => void;
  /** True when at the filesystem root (no parent). */
  readonly isAtRoot: boolean;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

interface State {
  currentPath: string;
  entries: readonly DirectoryEntry[];
  homeDirectory: string;
  currentDirectory: string;
  showHidden: boolean;
  isLoading: boolean;
  error: Error | null;
  /** The path we last requested — used for retry. */
  requestedPath: string;
}

type Action =
  | { type: "NAVIGATE"; path: string }
  | { type: "SUCCESS"; resolvedPath: string; entries: DirectoryEntry[]; homeDirectory: string; currentDirectory: string }
  | { type: "FAILURE"; error: Error }
  | { type: "TOGGLE_HIDDEN" };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "NAVIGATE":
      return {
        ...state,
        requestedPath: action.path,
        isLoading: true,
        error: null,
      };
    case "SUCCESS":
      return {
        ...state,
        currentPath: action.resolvedPath,
        entries: action.entries,
        homeDirectory: action.homeDirectory || state.homeDirectory,
        currentDirectory: action.currentDirectory || state.currentDirectory,
        isLoading: false,
        error: null,
      };
    case "FAILURE":
      return { ...state, isLoading: false, error: action.error };
    case "TOGGLE_HIDDEN":
      return { ...state, showHidden: !state.showHidden };
  }
}

const INITIAL_STATE: State = {
  currentPath: "",
  entries: [],
  homeDirectory: "",
  currentDirectory: "",
  showHidden: false,
  isLoading: false,
  error: null,
  requestedPath: "",
};

// ---------------------------------------------------------------------------
// Path utilities
// ---------------------------------------------------------------------------

function buildSegments(path: string): PathSegment[] {
  if (!path) return [];

  const segments: PathSegment[] = [{ name: "/", path: "/" }];
  const parts = path.split("/").filter(Boolean);
  let accumulated = "";

  for (const part of parts) {
    accumulated += `/${part}`;
    segments.push({ name: part, path: accumulated });
  }

  return segments;
}

function parentPath(path: string): string {
  if (!path || path === "/") return "/";
  const idx = path.lastIndexOf("/");
  return idx <= 0 ? "/" : path.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Behavior hook that drives a filesystem browser against a connected runner.
 *
 * Sends `ListDirectory` commands via the runner's bidi stream (through the
 * `sendCommand` unary RPC) and manages navigation state, breadcrumbs,
 * loading/error handling, and hidden file filtering.
 *
 * Designed for composition with {@link RunnerFileBrowser} but usable
 * standalone by platform builders who want custom rendering.
 *
 * @param runnerId - ID of the runner to browse. When `null`, the hook
 *   is inert (no requests are made, entries are empty).
 *
 * @example
 * ```tsx
 * function MyFilePicker({ runnerId }: { runnerId: string }) {
 *   const browser = useRunnerFileBrowser(runnerId);
 *
 *   return (
 *     <div>
 *       <p>Path: {browser.currentPath}</p>
 *       {browser.entries
 *         .filter(e => e.isDirectory)
 *         .map(e => (
 *           <button key={e.name} onClick={() => browser.navigateTo(e.name)}>
 *             {e.name}
 *           </button>
 *         ))}
 *     </div>
 *   );
 * }
 * ```
 */
export function useRunnerFileBrowser(
  runnerId: string | null,
): UseRunnerFileBrowserReturn {
  const stigmer = useStigmer();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const requestIdRef = useRef(0);

  const fetchDirectory = useCallback(
    async (path: string) => {
      if (!runnerId) return;

      const id = ++requestIdRef.current;
      dispatch({ type: "NAVIGATE", path });

      try {
        const response = await stigmer.runner.sendCommand(
          create(RunnerSendCommandInputSchema, {
            runnerId,
            command: {
              case: "listDirectory",
              value: create(ListDirectoryRequestSchema, { path }),
            },
          }),
        );

        // Stale response guard — a newer navigation has started.
        if (id !== requestIdRef.current) return;

        if (response.result.case === "error") {
          dispatch({
            type: "FAILURE",
            error: new Error(response.result.value.message),
          });
          return;
        }

        if (response.result.case === "listDirectory") {
          const listing = response.result.value;
          dispatch({
            type: "SUCCESS",
            resolvedPath: listing.resolvedPath,
            entries: listing.entries,
            homeDirectory: listing.homeDirectory,
            currentDirectory: listing.currentDirectory,
          });
        }
      } catch (err) {
        if (id !== requestIdRef.current) return;
        dispatch({ type: "FAILURE", error: toError(err) });
      }
    },
    [runnerId, stigmer],
  );

  // Initial load: fetch home directory when runnerId becomes available.
  const initializedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!runnerId) {
      initializedForRef.current = null;
      return;
    }

    if (initializedForRef.current !== runnerId) {
      initializedForRef.current = runnerId;
      fetchDirectory("");
    }
  }, [runnerId, fetchDirectory]);

  const navigateTo = useCallback(
    (name: string) => {
      const next =
        state.currentPath === "/"
          ? `/${name}`
          : `${state.currentPath}/${name}`;
      fetchDirectory(next);
    },
    [state.currentPath, fetchDirectory],
  );

  const navigateToPath = useCallback(
    (path: string) => fetchDirectory(path),
    [fetchDirectory],
  );

  const navigateUp = useCallback(
    () => fetchDirectory(parentPath(state.currentPath)),
    [state.currentPath, fetchDirectory],
  );

  const navigateHome = useCallback(
    () => fetchDirectory(state.homeDirectory || "~"),
    [state.homeDirectory, fetchDirectory],
  );

  const navigateCwd = useCallback(
    () => {
      if (state.currentDirectory) fetchDirectory(state.currentDirectory);
    },
    [state.currentDirectory, fetchDirectory],
  );

  const retry = useCallback(
    () => fetchDirectory(state.requestedPath),
    [state.requestedPath, fetchDirectory],
  );

  const toggleHidden = useCallback(() => dispatch({ type: "TOGGLE_HIDDEN" }), []);

  const segments = buildSegments(state.currentPath);
  const isAtRoot = state.currentPath === "/";

  return {
    currentPath: state.currentPath,
    entries: state.entries,
    segments,
    homeDirectory: state.homeDirectory,
    currentDirectory: state.currentDirectory,
    showHidden: state.showHidden,
    toggleHidden,
    isLoading: state.isLoading,
    error: state.error,
    navigateTo,
    navigateToPath,
    navigateUp,
    navigateHome,
    navigateCwd,
    retry,
    isAtRoot,
  };
}
