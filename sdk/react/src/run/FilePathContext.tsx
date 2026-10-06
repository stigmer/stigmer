import { createContext } from "react";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";
import type { ResolvedPathAction } from "./file-path-resolver.js";

/**
 * Context value that carries workspace entries and an optional click
 * handler to {@link FilePathLink} components deep in the tree.
 *
 * Provided by {@link MessageThread} (or a platform builder's custom
 * wrapper). When no provider is present, `FilePathLink` degrades to
 * copy-to-clipboard for all paths.
 */
export interface FilePathContextValue {
  /** Workspace entries from the session spec, used for path resolution. */
  readonly workspaceEntries: readonly WorkspaceEntry[];
  /**
   * Optional override for the default click behavior. When provided,
   * `FilePathLink` delegates to this callback instead of opening
   * a URL or copying to clipboard. Platform builders use this to
   * integrate their own file viewer or navigation.
   *
   * Return `false` to **decline** a specific path — `FilePathLink` then falls
   * back to its default action (open the GitHub link / copy the path), so a
   * handler that can only open *some* paths (e.g. resolvable workspace files)
   * leaves the rest behaving as before. Returning `true` or `void` means the
   * click was fully handled and the default is suppressed — preserving the
   * behavior of existing `void`-returning handlers.
   */
  readonly onFilePathClick?: (
    path: string,
    resolved: ResolvedPathAction,
  ) => boolean | void;
}

const DEFAULT_VALUE: FilePathContextValue = {
  workspaceEntries: [],
};

/** Context that supplies workspace file-path metadata for display-time path resolution. */
export const FilePathContext =
  createContext<FilePathContextValue>(DEFAULT_VALUE);
