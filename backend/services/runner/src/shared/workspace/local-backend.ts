/**
 * Local filesystem workspace backend.
 *
 * Executes commands and reads/writes files through the agent's operations
 * (`shared/agent-fs.ts`): in the runner each is performed by the agent host,
 * with the agent's rights; in the host, by the host itself. Used in local
 * mode and as the default; there is no remote (sandbox-hosted) backend.
 *
 * When `platformDir` is provided, paths under `.stigmer/` are
 * transparently routed to the platform directory, keeping platform files
 * out of the workspace tree. This routing serves the RUNNER's own I/O
 * (skill/attachment materialization, `execute` command rewriting) — the
 * agent's file tools do not go through this backend. Agent-visible reads
 * of `.stigmer/…` reach the same physical files through the per-turn
 * workspace symlink instead (see shared/workspace/stigmer-link.ts).
 */

import { AgentExecError, agentFs, agentPathExists } from "../agent-fs.js";
import { join, isAbsolute, resolve, relative } from "node:path";
import type { ExecuteOptions, WorkspaceBackend } from "./types.js";
import {
  classifyPlatformPath,
  resolvePlatformCommand,
  STIGMER_PLATFORM_DIR_ENV,
} from "./platform-mount.js";

export class LocalWorkspaceBackend implements WorkspaceBackend {
  readonly rootDir: string;
  readonly platformDir?: string;

  constructor(rootDir: string, platformDir?: string) {
    this.rootDir = rootDir;
    this.platformDir = platformDir;
  }

  async execute(command: string, options?: ExecuteOptions): Promise<string> {
    const cwd = options?.cwd
      ? (isAbsolute(options.cwd) ? options.cwd : join(this.rootDir, options.cwd))
      : this.rootDir;

    const resolvedCommand = this.platformDir ? resolvePlatformCommand(command) : command;
    // Extra variables only: the process gets the environment of whoever
    // performs it (the agent host, in the runner), plus these.
    const env: Record<string, string> | undefined = this.platformDir || options?.env
      ? {
          ...(this.platformDir ? { [STIGMER_PLATFORM_DIR_ENV]: this.platformDir } : {}),
          ...options?.env,
        }
      : undefined;

    try {
      const { stdout } = await agentFs().execFile("sh", ["-c", resolvedCommand], { cwd, maxBuffer: 10 * 1024 * 1024, ...(env ? { env } : {}) });
      return stdout.toString("utf8");
    } catch (err) {
      const stderr = err instanceof AgentExecError ? err.stderr.toString("utf8") : "";
      throw new Error(`Command failed: ${command}\n${stderr || (err instanceof Error ? err.message : String(err))}`);
    }
  }

  async readFile(path: string): Promise<string> {
    const full = this.resolvePath(path);
    return (await agentFs().readFile(full)).toString("utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const full = this.resolvePath(path);
    await this.ensureParentDir(path, full);
    await agentFs().writeFile(full, content);
  }

  async writeFileBuffer(path: string, content: Buffer): Promise<void> {
    const full = this.resolvePath(path);
    await this.ensureParentDir(path, full);
    await agentFs().writeFile(full, content);
  }

  private async ensureParentDir(relativePath: string, resolvedPath: string): Promise<void> {
    if (this.platformDir && !isAbsolute(relativePath)) {
      const { isPlatform } = classifyPlatformPath(relativePath);
      if (isPlatform) {
        const parentDir = join(resolvedPath, "..");
        await agentFs().mkdir(parentDir, { recursive: true });
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    return agentPathExists(this.resolvePath(path));
  }

  /**
   * Resolve a relative path to an absolute filesystem path, routing
   * `.stigmer/` paths to `platformDir` when configured.
   *
   * Absolute paths are returned as-is (backward compat with existing
   * callers that pass absolute paths).
   *
   * Platform-routed paths are checked for path traversal — a remainder
   * that escapes `platformDir` via `..` components is rejected.
   */
  private resolvePath(path: string): string {
    if (isAbsolute(path)) return path;

    if (this.platformDir) {
      const { isPlatform, remainder } = classifyPlatformPath(path);
      if (isPlatform) {
        const resolved = resolve(this.platformDir, remainder);
        const normalizedPlatform = resolve(this.platformDir);
        if (!resolved.startsWith(normalizedPlatform + "/") && resolved !== normalizedPlatform) {
          throw new Error(
            `Path traversal detected: '${path}' resolves outside platform directory`,
          );
        }
        return resolved;
      }
    }

    return join(this.rootDir, path);
  }
}

/**
 * Create and initialize a local workspace backend. Ensures the root
 * directory exists before returning.
 */
export async function initializeLocalWorkspace(
  rootDir: string,
  platformDir?: string,
): Promise<LocalWorkspaceBackend> {
  await agentFs().mkdir(rootDir, { recursive: true });
  return new LocalWorkspaceBackend(rootDir, platformDir);
}
