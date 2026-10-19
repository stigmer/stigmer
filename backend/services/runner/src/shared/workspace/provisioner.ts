/**
 * Workspace provisioner — dispatches on a session resource's type to
 * populate a workspace directory.
 *
 * Supports three resource variants:
 * - git_repository: clone a repository
 * - local_path: use an existing host directory
 * - none set: create an empty workspace
 *
 * A file resource is not part of the workspace: the File mount places it
 * under `.stigmer/uploads/` (`../file-mount.ts`), so
 * {@link workspaceResourcesOf} leaves it out before anything here counts
 * or provisions the resources.
 *
 * Multi-resource sessions provision each repository or folder into its own
 * subdirectory of the workspace root, named by the resource's `name`.
 *
 * Scope: the local backend only; there is no remote (sandbox-hosted)
 * backend.
 */

import type { ProvisionResult, WorkspaceBackend } from "./types.js";
import { provisionEmpty } from "./sources/empty.js";
import { provisionLocalPath } from "./sources/local-path.js";
import { provisionGit } from "./sources/git.js";
import { repositoryTokenFor, type RepositoryToken } from "../run-values.js";

/**
 * A session resource as provisioning reads it: structurally the contract's
 * `SessionResource`, narrowed to the fields read here so a caller (or a
 * test) passes the message or a plain object alike.
 */
export interface WorkspaceResource {
  readonly name: string;
  readonly resource:
    | { readonly case: "gitRepository"; readonly value: GitRepositorySource }
    | { readonly case: "localPath"; readonly value: LocalPathSource }
    | { readonly case: "file"; readonly value: unknown }
    | { readonly case: undefined; readonly value?: undefined };
}

export interface GitRepositorySource {
  readonly url: string;
  readonly branch?: string;
  readonly commit?: string;
}

export interface LocalPathSource {
  readonly path: string;
}

/** The resources that make up the workspace: every one but a File. */
export function workspaceResourcesOf<R extends WorkspaceResource>(resources: readonly R[]): R[] {
  return resources.filter((resource) => resource.resource.case !== "file");
}

export class WorkspaceProvisioner {
  /**
   * Provisions one repository or folder. A repository's token is its own
   * repository value, matched by the resource's name and URL together; no
   * other run value reaches provisioning. A resource with no type set
   * gets an empty workspace.
   */
  async provision(
    entry: WorkspaceResource,
    backend: WorkspaceBackend,
    repositories: readonly RepositoryToken[],
    isLocalMode: boolean,
    options?: {
      targetSubdir?: string;
      writeBack?: boolean;
    },
  ): Promise<ProvisionResult> {
    switch (entry.resource.case) {
      case "gitRepository": {
        const gitSource = entry.resource.value;
        return provisionGit({
          url: gitSource.url,
          branch: gitSource.branch,
          commit: gitSource.commit,
          backend,
          token: repositoryTokenFor(repositories, entry.name, gitSource.url),
          isLocalMode,
          targetSubdir: options?.targetSubdir,
          writeBack: options?.writeBack,
        });
      }

      case "localPath": {
        const localSource = entry.resource.value;
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
    resources: readonly WorkspaceResource[],
    backend: WorkspaceBackend,
    repositories: readonly RepositoryToken[],
    isLocalMode: boolean,
    writeBack = false,
  ): Promise<ProvisionResult[]> {
    const entries = workspaceResourcesOf(resources);
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
