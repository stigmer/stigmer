"use client";

import { useMemo } from "react";
import { useExecutionTarget } from "../execution-target-context.js";
import { useDeploymentMode } from "../deployment-mode.js";

/** Options for {@link useWorkspaceSources}. */
export interface UseWorkspaceSourcesOptions {
  /**
   * Whether the host environment can open a native folder picker.
   *
   * Desktop apps set this to `true` (they supply `onBrowseLocalFolder`
   * via Tauri's dialog plugin). Web apps omit it or pass `false`.
   *
   * When the effective execution target is `"local"` and no local
   * picker is available, the hook keeps GitHub enabled as a fallback
   * so the user always has at least one way to add a workspace.
   *
   * @default false
   */
  readonly hasLocalPicker?: boolean;
}

/** Return value of {@link useWorkspaceSources}. */
export interface UseWorkspaceSourcesReturn {
  /** Whether to show the "Connect GitHub" action in the workspace editor. */
  readonly enableGitHub: boolean;
  /** Whether to show the "Browse Folder" action in the workspace editor. */
  readonly enableLocal: boolean;
}

/**
 * Derives which workspace source options to present based on the
 * app-level execution target.
 *
 * Reads `executionTarget` from `StigmerProvider` context and falls
 * back to `deploymentMode` when no explicit target is set:
 *
 * - **Cloud execution** -> GitHub only (`enableGitHub: true`, `enableLocal: false`).
 * - **Local execution with native picker** -> local folder only
 *   (`enableGitHub: false`, `enableLocal: true`).
 * - **Local execution without native picker** -> GitHub fallback
 *   (`enableGitHub: true`, `enableLocal: true`) so the user is
 *   never left with zero workspace sources.
 *
 * This hook centralises the policy so all consumer sites (launcher
 * and session page, across desktop and web) stay in lockstep without
 * duplicating conditional logic (DD-016).
 *
 * @example
 * ```tsx
 * // Desktop app (has native folder picker via Tauri)
 * const sources = useWorkspaceSources({ hasLocalPicker: true });
 * // -> { enableGitHub: false, enableLocal: true }
 *
 * // Web app (cloud deployment, no native picker)
 * const sources = useWorkspaceSources();
 * // -> { enableGitHub: true, enableLocal: false }
 * ```
 */
export function useWorkspaceSources(
  options?: UseWorkspaceSourcesOptions,
): UseWorkspaceSourcesReturn {
  const executionTarget = useExecutionTarget();
  const deploymentMode = useDeploymentMode();
  const hasLocalPicker = options?.hasLocalPicker ?? false;

  return useMemo(() => {
    const effectiveTarget =
      executionTarget ?? (deploymentMode === "local" ? "local" : "cloud");

    if (effectiveTarget === "cloud") {
      return { enableGitHub: true, enableLocal: false };
    }

    // Local execution: prefer the native picker when available.
    // Fall back to GitHub when no picker exists (e.g. web-local OSS).
    return {
      enableGitHub: !hasLocalPicker,
      enableLocal: true,
    };
  }, [executionTarget, deploymentMode, hasLocalPicker]);
}
