/**
 * Session workspace-root resolution — shared by both executors (Cursor and
 * deep-agent) so their placement rules can never drift.
 *
 * SessionSpec.workspace_entries promises: "When empty, the session uses an
 * empty workspace directory." Handing every no-entry session the shared
 * `config.workspaceRootDir` broke that contract twice over: a "new" session
 * started amid every prior session's leftovers, and — under the per-workspace
 * turn lock (workspace-lock.ts) — unrelated no-entry sessions would falsely
 * serialize against each other. A per-session directory honors the contract,
 * isolates the default quickstart case, and removes the false contention.
 *
 * Sessions WITH entries keep the shared root: their content identity is the
 * entry source (a git URL clones idempotently, a localPath IS the user's
 * directory), and cross-session sharing of that content is intentional —
 * that sharing is exactly what the turn lock serializes.
 */

import { join } from "node:path";
import { mkdir } from "node:fs/promises";

/**
 * Resolve (and create) the working-tree root for a session.
 *
 * - No workspace entries → `{workspaceRootDir}/sessions/{sessionId}`, created
 *   on demand. Deterministic from sessionId alone, so it is stable across
 *   turns, HITL reinvocations, and Temporal retries with no persisted state.
 * - One or more entries → the shared `workspaceRootDir`, where the
 *   provisioner materializes each entry (in place, or per-entry subdirs).
 *
 * The `sessions/` namespace lives under the configured workspace root (the
 * volume operators size and mount for workspace content), not under $HOME.
 * It can coexist with a single-entry clone at the root: cloneInPlace
 * (sources/git.ts) tolerates non-empty targets, colliding only if the repo
 * itself ships a root-level `sessions` path — a strictly smaller surface
 * than the old behavior, where any file a no-entry session dropped at the
 * root could break the checkout.
 */
export async function resolveSessionWorkspaceRoot(
  workspaceRootDir: string,
  workspaceEntries: readonly unknown[],
  sessionId: string,
): Promise<string> {
  if (workspaceEntries.length > 0) {
    return workspaceRootDir;
  }
  if (!sessionId) {
    // Same invariant as resolvePlatformOptions: an empty sessionId would
    // collapse every no-entry session onto one directory — the exact leakage
    // this function exists to prevent.
    throw new Error(
      "resolveSessionWorkspaceRoot: sessionId is required for a session with " +
      "no workspace entries; an empty value would collapse every such session " +
      "onto one shared directory.",
    );
  }
  const sessionRoot = join(workspaceRootDir, "sessions", sessionId);
  await mkdir(sessionRoot, { recursive: true });
  return sessionRoot;
}
