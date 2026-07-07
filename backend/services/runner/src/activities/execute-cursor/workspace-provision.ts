/**
 * Local workspace provisioning for the Cursor harness.
 *
 * Cursor agents run LOCAL (cloud is disabled — see cursor-mode.ts), so the
 * runner must clone git-repo workspace entries itself and mount local-path
 * entries before the agent runs, mirroring the native harness. Cloud agents
 * previously cloned git repos server-side; that path is no longer used.
 */

import type { Config } from "../../config.js";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { WorkspaceProvisioner } from "../../shared/workspace/provisioner.js";
import type { ProvisionResult, WorkspaceBackend } from "../../shared/workspace/types.js";
import { LocalWorkspaceBackend } from "../../shared/workspace/local-backend.js";
import { ensurePlatformDir } from "../../shared/workspace/platform-dir.js";
import { resolveSessionWorkspaceRoot } from "../../shared/workspace/session-root.js";

/** What {@link provisionCursorWorkspace} hands back to the harness. */
export interface CursorWorkspaceProvision {
  /** The directories the agent should operate in (never empty). */
  readonly workspaceDirs: string[];
  /**
   * Per-entry provision outcomes — carries the git metadata (repo URL, base
   * branch, credential state) the write-back coordinator needs. Empty for a
   * session with no workspace entries.
   */
  readonly provisionResults: ProvisionResult[];
  /**
   * The backend the entries were provisioned through — the write-back
   * coordinator executes its git commands through it.
   */
  readonly workspaceBackend: WorkspaceBackend;
}

/**
 * Provision the session's workspace entries for a LOCAL Cursor agent.
 *
 * Clones git-repo entries (using the user's GITHUB_TOKEN from the resolved
 * execution environment) and mounts local-path entries, then returns the
 * directories the agent should operate in — along with the provision results
 * and backend the git write-back coordinator needs. A session with no
 * workspace entries gets its own empty per-session directory (see
 * session-root.ts) — never the shared root, which would leak other sessions'
 * files into it.
 *
 * provisionGit is idempotent (it reuses an existing clone), so this is safe
 * to call on every execution, including multi-turn and HITL reinvocations.
 */
export async function provisionCursorWorkspace(
  config: Config,
  session: Session,
  envVars: Record<string, string>,
  sessionId: string,
): Promise<CursorWorkspaceProvision> {
  const entries = session.spec?.workspaceEntries ?? [];
  const platformDir = await ensurePlatformDir(sessionId);

  if (entries.length === 0) {
    const sessionRoot = await resolveSessionWorkspaceRoot(
      config.workspaceRootDir, entries, sessionId,
    );
    return {
      workspaceDirs: [sessionRoot],
      provisionResults: [],
      workspaceBackend: new LocalWorkspaceBackend(sessionRoot, platformDir),
    };
  }

  const backend = new LocalWorkspaceBackend(config.workspaceRootDir, platformDir);

  const provisioner = new WorkspaceProvisioner();
  const results = await provisioner.provisionAll(
    entries.map((entry) => ({ name: entry.name, source: entry.source })),
    backend,
    envVars,
    config.mode === "local",
    config.mode !== "local",
  );

  const dirs = results
    .map((result) => result.rootDir)
    .filter((dir): dir is string => Boolean(dir));

  return {
    workspaceDirs: dirs.length > 0 ? dirs : [config.workspaceRootDir],
    provisionResults: results,
    workspaceBackend: backend,
  };
}
