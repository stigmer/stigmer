/**
 * Local filesystem workspace backend.
 *
 * Executes commands via child_process and reads/writes files directly.
 * Used in local mode and as the default for Phase 2. The remote (Daytona
 * sandbox) backend will be added in Phase 3.
 *
 * When `platformDir` is provided, paths under `.stigmer/` are
 * transparently routed to the platform directory, keeping platform files
 * out of the workspace tree. This routing serves the RUNNER's own I/O
 * (skill/attachment materialization, `execute` command rewriting) — the
 * agent's file tools do not go through this backend. Agent-visible reads
 * of `.stigmer/…` reach the same physical files through the per-turn
 * workspace symlink instead (see shared/workspace/stigmer-link.ts).
 */

import { execFile } from "node:child_process";
import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { join, isAbsolute, resolve, relative } from "node:path";
import type { WorkspaceBackend } from "./types.js";
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

  async execute(command: string, options?: { cwd?: string }): Promise<string> {
    const cwd = options?.cwd
      ? (isAbsolute(options.cwd) ? options.cwd : join(this.rootDir, options.cwd))
      : this.rootDir;

    let resolvedCommand = command;
    const env: Record<string, string> | undefined = this.platformDir
      ? { ...process.env as Record<string, string>, [STIGMER_PLATFORM_DIR_ENV]: this.platformDir }
      : undefined;

    if (this.platformDir) {
      resolvedCommand = resolvePlatformCommand(command);
    }

    return new Promise((resolve, reject) => {
      execFile(
        "sh",
        ["-c", resolvedCommand],
        { cwd, maxBuffer: 10 * 1024 * 1024, ...(env ? { env } : {}) },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(`Command failed: ${command}\n${stderr || err.message}`));
          } else {
            resolve(stdout);
          }
        },
      );
    });
  }

  async readFile(path: string): Promise<string> {
    const full = this.resolvePath(path);
    return readFile(full, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const full = this.resolvePath(path);
    await this.ensureParentDir(path, full);
    await writeFile(full, content, "utf-8");
  }

  async writeFileBuffer(path: string, content: Buffer): Promise<void> {
    const full = this.resolvePath(path);
    await this.ensureParentDir(path, full);
    await writeFile(full, content);
  }

  private async ensureParentDir(relativePath: string, resolvedPath: string): Promise<void> {
    if (this.platformDir && !isAbsolute(relativePath)) {
      const { isPlatform } = classifyPlatformPath(relativePath);
      if (isPlatform) {
        const parentDir = join(resolvedPath, "..");
        await mkdir(parentDir, { recursive: true });
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    const full = this.resolvePath(path);
    try {
      await access(full);
      return true;
    } catch {
      return false;
    }
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
  await mkdir(rootDir, { recursive: true });
  return new LocalWorkspaceBackend(rootDir, platformDir);
}
