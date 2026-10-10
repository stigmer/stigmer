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
 * Scope: the local backend only; there is no remote (sandbox-hosted)
 * backend.
 */

import type { ProvisionResult, WorkspaceBackend } from "./types.js";
import { provisionEmpty } from "./sources/empty.js";
import { provisionLocalPath } from "./sources/local-path.js";
import { provisionGit } from "./sources/git.js";
import { repositoryTokenFor, type RepositoryToken } from "../run-values.js";

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
  /**
   * Provisions one entry. A git entry's token is its own repository value,
   * matched by the entry's name and URL together; no other run value
   * reaches provisioning.
   */
  async provision(
    entry: WorkspaceEntry,
    backend: WorkspaceBackend,
    repositories: readonly RepositoryToken[],
    isLocalMode: boolean,
    options?: {
      targetSubdir?: string;
      writeBack?: boolean;
    },
  ): Promise<ProvisionResult> {
    const workspaceSource = entry.source;
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
          token: repositoryTokenFor(repositories, entry.name, gitSource.url),
          isLocalMode,
          targetSubdir: options?.targetSubdir,
          writeBack: options?.writeBack,
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

  async provisionAll(
    entries: WorkspaceEntry[],
    backend: WorkspaceBackend,
    repositories: readonly RepositoryToken[],
    isLocalMode: boolean,
    writeBack = false,
  ): Promise<ProvisionResult[]> {
    if (entries.length === 0) return [];

    const useSubdirs = entries.length > 1;
    const results: ProvisionResult[] = [];

    for (const entry of entries) {
      const targetSubdir = useSubdirs ? entry.name : undefined;
      const result = await this.provision(
        entry,
        backend,
        repositories,
        isLocalMode,
        { targetSubdir, writeBack },
      );
      results.push({ ...result, entryName: entry.name });
    }

    return results;
  }
}
