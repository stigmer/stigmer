import { createContext, useCallback, useContext } from "react";
import { normalizeSandboxPaths } from "./sandbox-path-normalizer.js";

/**
 * Context value that carries the sandbox workspace root for display-time
 * path normalization.
 *
 * Provided by {@link MessageThread} (or a platform builder's custom
 * wrapper).  When no provider is present, path normalization is a no-op.
 */
export interface SandboxContextValue {
  /**
   * Absolute sandbox workspace root (e.g. `/home/daytona/workspace`).
   * Empty string disables normalization (local mode, backward compat).
   */
  readonly sandboxWorkspaceRoot: string;
}

const DEFAULT_VALUE: SandboxContextValue = {
  sandboxWorkspaceRoot: "",
};

export const SandboxContext =
  createContext<SandboxContextValue>(DEFAULT_VALUE);

/**
 * Returns a stable normalizer function that replaces absolute sandbox
 * paths in the given text with workspace-relative display paths.
 *
 * When `sandboxWorkspaceRoot` is empty (no provider or local mode),
 * returns the identity function — zero overhead.
 *
 * @example
 * ```tsx
 * function ShellCommand({ command }: { command: string }) {
 *   const normalize = useSandboxNormalize();
 *   return <code>{normalize(command)}</code>;
 * }
 * ```
 */
export function useSandboxNormalize(): (text: string) => string {
  const { sandboxWorkspaceRoot } = useContext(SandboxContext);
  return useCallback(
    (text: string) => normalizeSandboxPaths(text, sandboxWorkspaceRoot),
    [sandboxWorkspaceRoot],
  );
}
