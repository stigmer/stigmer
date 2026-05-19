/**
 * Local-path workspace source — uses an existing host directory as-is.
 *
 * The user's project directory becomes the workspace root directly. No
 * copy or clone is made; the agent operates on the original files.
 *
 * LocalPathSource is only valid in local mode. Cloud runners reject it
 * with a clear error — use git_repo for cloud deployments.
 */

import { existsSync, statSync, symlinkSync, readlinkSync, unlinkSync, mkdirSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { realpathSync } from "node:fs";
import {
  SourceType,
  WorkspaceProvisionError,
  type ProvisionResult,
} from "../types.js";

export interface LocalPathProvisionOptions {
  path: string;
  isLocalMode: boolean;
  targetSubdir?: string;
  backendRootDir?: string;
}

export function provisionLocalPath(options: LocalPathProvisionOptions): ProvisionResult {
  const { path, isLocalMode, targetSubdir, backendRootDir } = options;

  if (!isLocalMode) {
    throw new WorkspaceProvisionError(
      SourceType.LOCAL_PATH,
      "LocalPathSource is only supported in local mode. " +
      "Use git_repo for cloud deployments.",
    );
  }

  if (!isAbsolute(path)) {
    throw new WorkspaceProvisionError(
      SourceType.LOCAL_PATH,
      `Path must be absolute, got relative path: '${path}'`,
    );
  }

  if (!existsSync(path)) {
    throw new WorkspaceProvisionError(
      SourceType.LOCAL_PATH,
      `Path does not exist: '${path}'`,
    );
  }

  if (!statSync(path).isDirectory()) {
    throw new WorkspaceProvisionError(
      SourceType.LOCAL_PATH,
      `Path is not a directory: '${path}'`,
    );
  }

  if (targetSubdir && backendRootDir) {
    createEntrySymlink(backendRootDir, targetSubdir, path);
  }

  return {
    rootDir: path,
    sourceType: SourceType.LOCAL_PATH,
    consumedKeys: [],
    workspaceDescription:
      `Your workspace is the user's project directory: ${path}\n` +
      "IMPORTANT: You are operating directly on the user's files. " +
      "Changes are immediate and persistent.\n" +
      "Use git to track and verify your changes before finalizing.",
    entryName: "",
  };
}

function createEntrySymlink(backendRootDir: string, targetSubdir: string, path: string): void {
  const linkPath = join(backendRootDir, targetSubdir);

  try {
    const existing = readlinkSync(linkPath);
    if (realpathSync(existing) === realpathSync(path)) return;
    unlinkSync(linkPath);
  } catch {
    // link doesn't exist — will create below
  }

  mkdirSync(backendRootDir, { recursive: true });
  symlinkSync(path, linkPath);
}
