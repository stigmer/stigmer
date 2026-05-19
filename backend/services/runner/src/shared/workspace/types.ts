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
 * In local mode, commands run via child_process. In cloud mode (Phase 3),
 * commands route through the Daytona sandbox proxy.
 */
export interface WorkspaceBackend {
  readonly rootDir: string;
  execute(command: string, options?: { cwd?: string }): Promise<string>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}
