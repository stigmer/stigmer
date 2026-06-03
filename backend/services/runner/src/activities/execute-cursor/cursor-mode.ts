/**
 * Cursor mode determination for sessions using HARNESS_CURSOR.
 *
 * Cloud Cursor agents are DISABLED platform-wide right now, so every session
 * — including git-backed ones — runs as a LOCAL Cursor agent.
 *
 * Why cloud is disabled: Cursor cloud agents clone repositories via Cursor's
 * own GitHub App connection and accept no per-request git credential. Stigmer
 * collects the user's git credentials but has no way to hand them to Cursor's
 * cloud clone, so git-backed cloud sessions fail for user repos. Until that
 * credential story is resolved, Stigmer provisions the workspace itself
 * (including git clones, using the user's GITHUB_TOKEN) and runs a local
 * Cursor agent against it.
 */

import { CursorMode } from "@stigmer/protos/ai/stigmer/agentic/session/v1/enum_pb";
import type { WorkspaceEntry } from "@stigmer/protos/ai/stigmer/agentic/session/v1/workspace_pb";

/**
 * Determine the CursorMode for a session.
 *
 * Always returns LOCAL while cloud Cursor agents are disabled (see the
 * file-level note). The parameters are retained so the previous
 * workspace/flag-based mode-selection logic (preserved in git history) can be
 * restored when cloud is re-enabled.
 */
export function determineCursorMode(
  _workspaceEntries: WorkspaceEntry[],
  _cloudModeEnabled: boolean,
): CursorMode {
  return CursorMode.LOCAL;
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
