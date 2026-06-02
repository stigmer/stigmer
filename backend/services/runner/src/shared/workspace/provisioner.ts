/**
 * Workspace provisioner — dispatches on WorkspaceSource proto type to
 * populate a workspace directory.
 *
 * Supports three source variants:
 * - git_repo: clone a repository
 * - local_path: use an existing host directory
 * - empty: create an empty workspace
 *
 * Multi-entry sessions provision each WorkspaceEntry into its own
 * subdirectory of the workspace root.
 *
 * Phase 2 scope: local backend only. The remote (Daytona sandbox)
 * backend will be added in Phase 3.
 */

import type { ProvisionResult, WorkspaceBackend } from "./types.js";
import { SourceType, WorkspaceProvisionError } from "./types.js";
import { provisionEmpty } from "./sources/empty.js";
import { provisionLocalPath } from "./sources/local-path.js";
import { provisionGit } from "./sources/git.js";

const PROVISION_KEY_PREFIX = "WORKSPACE_PROVISION_";

export interface WorkspaceEntry {
  name: string;
  source?: WorkspaceSource;
}

export interface WorkspaceSource {
  source: { case: "gitRepo"; value: GitRepoSource }
    | { case: "localPath"; value: LocalPathSource }
    | { case: undefined; value?: undefined };
}

export interface GitRepoSource {
  url: string;
  branch?: string;
}

export interface LocalPathSource {
  path: string;
}

export class WorkspaceProvisioner {
  async provision(
    workspaceSource: WorkspaceSource | undefined,
    backend: WorkspaceBackend,
    mergedEnv: Record<string, string>,
    isLocalMode: boolean,
    options?: {
      targetSubdir?: string;
      configureCredentials?: boolean;
    },
  ): Promise<ProvisionResult> {
    const result = await this.dispatch(
      workspaceSource, backend, mergedEnv, isLocalMode, options,
    );

    const prefixKeys = Object.keys(mergedEnv)
      .filter(k => k.startsWith(PROVISION_KEY_PREFIX));

    const allConsumed = mergeConsumedKeys(result.consumedKeys, prefixKeys);
    if (allConsumed.length !== result.consumedKeys.length) {
      return { ...result, consumedKeys: allConsumed };
    }
    return result;
  }

  async provisionAll(
    entries: WorkspaceEntry[],
    backend: WorkspaceBackend,
    mergedEnv: Record<string, string>,
    isLocalMode: boolean,
    configureCredentials = false,
  ): Promise<ProvisionResult[]> {
    if (entries.length === 0) return [];

    const useSubdirs = entries.length > 1;
    const results: ProvisionResult[] = [];

    for (const entry of entries) {
      const targetSubdir = useSubdirs ? entry.name : undefined;
      const result = await this.provision(
        entry.source,
        backend,
        mergedEnv,
        isLocalMode,
        { targetSubdir, configureCredentials },
      );
      results.push({ ...result, entryName: entry.name });
    }

    return results;
  }

  private async dispatch(
    workspaceSource: WorkspaceSource | undefined,
    backend: WorkspaceBackend,
    mergedEnv: Record<string, string>,
    isLocalMode: boolean,
    options?: {
      targetSubdir?: string;
      configureCredentials?: boolean;
    },
  ): Promise<ProvisionResult> {
    if (!workspaceSource || !workspaceSource.source?.case) {
      return provisionEmpty(backend);
    }

    switch (workspaceSource.source.case) {
      case "gitRepo": {
        const gitSource = workspaceSource.source.value;
        return provisionGit({
          url: gitSource.url,
          branch: gitSource.branch,
          backend,
          envVars: mergedEnv,
          isLocalMode,
          targetSubdir: options?.targetSubdir,
          configureCredentials: options?.configureCredentials,
        });
      }

      case "localPath": {
        const localSource = workspaceSource.source.value;
        return provisionLocalPath({
          path: localSource.path,
          isLocalMode,
          targetSubdir: options?.targetSubdir,
          backendRootDir: options?.targetSubdir ? backend.rootDir : undefined,
        });
      }

      default:
        return provisionEmpty(backend);
    }
  }
}

function mergeConsumedKeys(
  sourceKeys: readonly string[],
  prefixKeys: string[],
): string[] {
  if (prefixKeys.length === 0) return [...sourceKeys];
  const merged = new Map<string, true>();
  for (const k of sourceKeys) merged.set(k, true);
  for (const k of prefixKeys) merged.set(k, true);
  return [...merged.keys()];
}
