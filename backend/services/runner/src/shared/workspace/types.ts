/**
 * Workspace provisioning domain types.
 *
 * These types represent the result of workspace provisioning — they are
 * harness-agnostic and used by both ExecuteCursor and ExecuteDeepAgent.
 */

export enum SourceType {
  GIT_REPO = "git_repo",
  LOCAL_PATH = "local_path",
  EMPTY = "empty",
}

export interface GitMetadata {
  readonly repoUrl: string;
  readonly branch: string;
  readonly baseCommit: string;
  readonly gitCredentialsConfigured: boolean;
}

export interface ProvisionResult {
  readonly rootDir: string;
  readonly sourceType: SourceType;
  readonly consumedKeys: readonly string[];
  readonly workspaceDescription: string;
  readonly fileTree?: string;
  readonly gitMetadata?: GitMetadata;
  readonly entryName: string;
}

export class WorkspaceProvisionError extends Error {
  readonly sourceType: SourceType;
  readonly cause?: Error;
  readonly transient: boolean;

  constructor(
    sourceType: SourceType,
    message: string,
    options?: { cause?: Error; transient?: boolean },
  ) {
    super(`[${sourceType}] ${message}`);
    this.name = "WorkspaceProvisionError";
    this.sourceType = sourceType;
    this.cause = options?.cause;
    this.transient = options?.transient ?? false;
  }
}

/**
 * Abstraction for executing commands inside a workspace.
 *
 * Commands run via child_process in both modes: in cloud mode the runner
 * itself lives inside the sandbox, so "local" execution is already
 * sandbox-scoped there.
 *
 * When `platformDir` is set, paths under `.stigmer/` are transparently
 * routed to the platform directory instead of the workspace root, keeping
 * platform files (skills, inputs) physically separate from the user's
 * workspace. The routing covers the RUNNER's own reads/writes through
 * this interface; the agent's file tools resolve against the workspace
 * root and see the same files through the per-turn `.stigmer` symlink
 * (see stigmer-link.ts).
 */
export interface WorkspaceBackend {
  readonly rootDir: string;
  readonly platformDir?: string;
  execute(command: string, options?: { cwd?: string }): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  writeFileBuffer(path: string, content: Buffer): Promise<void>;
  exists(path: string): Promise<boolean>;
}
