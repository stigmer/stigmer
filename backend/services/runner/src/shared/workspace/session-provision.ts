/**
 * Local workspace provisioning for a harness turn.
 *
 * Harness-agnostic: the Cursor activity is today's only caller, the turn
 * runtime takes it over in S2 M3, and S3 retires the native twin
 * (execute-deep-agent/setup.ts `provisionWorkspace`). Agents run LOCAL
 * (cloud is disabled — see execute-cursor/cursor-mode.ts), so the runner
 * must clone git-repo workspace entries itself and mount local-path entries
 * before the agent runs. Cloud agents previously cloned git repos
 * server-side; that path is no longer used.
 */

import type { Config } from "../../config.js";
import type { Session } from "@stigmer/protos/ai/stigmer/agentic/session/v1/api_pb";
import { WorkspaceProvisioner } from "./provisioner.js";
import type { ProvisionResult, WorkspaceBackend } from "./types.js";
import { LocalWorkspaceBackend } from "./local-backend.js";
import { ensurePlatformDir } from "./platform-dir.js";
import { resolveSessionWorkspaceRoot } from "./session-root.js";

/**
 * The two runner settings provisioning reads. A `Pick` over `Config` rather
 * than a fresh options type so a caller holding the whole `Config` (the turn
 * orchestrator, and the runtime that replaces it) passes it unchanged, while
 * the signature states exactly what is consumed: the root every workspace
 * resolves under, and the mode that decides whether git entries are cloned
 * or expected in place. A test constructs the two fields and nothing else.
 */
export type SessionProvisionConfig = Pick<Config, "workspaceRootDir" | "mode">;

/** What {@link provisionSessionWorkspace} hands back to the harness. */
export interface SessionWorkspaceProvision {
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
 * Provision the session's workspace entries for a LOCAL agent.
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
export async function provisionSessionWorkspace(
  config: SessionProvisionConfig,
  session: Session,
  envVars: Record<string, string>,
  sessionId: string,
): Promise<SessionWorkspaceProvision> {
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
