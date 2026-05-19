/**
 * Local filesystem workspace backend.
 *
 * Executes commands via child_process and reads/writes files directly.
 * Used in local mode and as the default for Phase 2. The remote (Daytona
 * sandbox) backend will be added in Phase 3.
 */

import { execFile } from "node:child_process";
import { readFile, writeFile, access, mkdir } from "node:fs/promises";
import { join, isAbsolute } from "node:path";
import type { WorkspaceBackend } from "./types.js";

export class LocalWorkspaceBackend implements WorkspaceBackend {
  readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  async execute(command: string, options?: { cwd?: string }): Promise<string> {
    const cwd = options?.cwd
      ? (isAbsolute(options.cwd) ? options.cwd : join(this.rootDir, options.cwd))
      : this.rootDir;

    return new Promise((resolve, reject) => {
      execFile("sh", ["-c", command], { cwd, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`Command failed: ${command}\n${stderr || err.message}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  async readFile(path: string): Promise<string> {
    const full = isAbsolute(path) ? path : join(this.rootDir, path);
    return readFile(full, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const full = isAbsolute(path) ? path : join(this.rootDir, path);
    await writeFile(full, content, "utf-8");
  }

  async exists(path: string): Promise<boolean> {
    const full = isAbsolute(path) ? path : join(this.rootDir, path);
    try {
      await access(full);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create and initialize a local workspace backend. Ensures the root
 * directory exists before returning.
 */
export async function initializeLocalWorkspace(rootDir: string): Promise<LocalWorkspaceBackend> {
  await mkdir(rootDir, { recursive: true });
  return new LocalWorkspaceBackend(rootDir);
}
