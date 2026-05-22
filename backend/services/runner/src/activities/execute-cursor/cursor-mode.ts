/**
 * Cursor mode determination for sessions using HARNESS_CURSOR.
 *
 * CursorMode is immutable per session — determined once on the first
 * execution based on workspace entries and the feature flag, then
 * persisted in SessionSpec.cursor_mode for all subsequent executions.
 *
 * Mode selection rules (when feature flag is enabled):
 *   - All workspace entries are GitRepoSource -> CLOUD
 *   - Any workspace entry is LocalPathSource  -> LOCAL
 *   - No workspace entries                    -> LOCAL (fallback)
 *   - Feature flag disabled                   -> LOCAL (forced)
 */

import { CursorMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";

/**
 * Determine the CursorMode for a new session based on its workspace entries
 * and whether cloud mode is enabled.
 *
 * Only called on the first execution when cursor_mode is UNSPECIFIED.
 * The result is persisted on SessionSpec and never re-evaluated.
 */
export function determineCursorMode(
  workspaceEntries: WorkspaceEntry[],
  cloudModeEnabled: boolean,
): CursorMode {
  if (!cloudModeEnabled) {
    return CursorMode.LOCAL;
  }

  if (workspaceEntries.length === 0) {
    return CursorMode.LOCAL;
  }

  const allGitRepo = workspaceEntries.every(
    (entry) => entry.source?.source.case === "gitRepo",
  );

  return allGitRepo ? CursorMode.CLOUD : CursorMode.LOCAL;
}

/**
 * Type guard that returns true when the mode is CLOUD.
 *
 * Treats UNSPECIFIED as LOCAL for backward compatibility with sessions
 * created before the cursor_mode field existed.
 */
export function isCloudMode(mode: CursorMode): boolean {
  return mode === CursorMode.CLOUD;
}
