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
import { LocalWorkspaceBackend } from "../../shared/workspace/local-backend.js";
import { ensurePlatformDir } from "../../shared/workspace/platform-dir.js";

/**
 * Provision the session's workspace entries for a LOCAL Cursor agent.
 *
 * Clones git-repo entries (using the user's GITHUB_TOKEN from the resolved
 * execution environment) and mounts local-path entries, then returns the
 * directories the agent should operate in. Falls back to the configured
 * workspace root when the session declares no workspace entries.
 *
 * provisionGit is idempotent (it reuses an existing clone), so this is safe
 * to call on every execution, including multi-turn and HITL reinvocations.
 */
export async function provisionCursorWorkspace(
  config: Config,
  session: Session,
  envVars: Record<string, string>,
  sessionId: string,
): Promise<string[]> {
  const entries = session.spec?.workspaceEntries ?? [];
  if (entries.length === 0) {
    return [config.workspaceRootDir];
  }

  const platformDir = await ensurePlatformDir(sessionId);
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

  return dirs.length > 0 ? dirs : [config.workspaceRootDir];
}
