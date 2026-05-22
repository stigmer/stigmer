/**
 * Empty workspace source — the default when no WorkspaceSource is configured.
 *
 * The workspace directory already exists (created by initializeLocalWorkspace).
 * This handler simply records the fact and returns the existing root.
 */

import { SourceType, type ProvisionResult, type WorkspaceBackend } from "../types.js";

export function provisionEmpty(backend: WorkspaceBackend): ProvisionResult {
  return {
    rootDir: backend.rootDir,
    sourceType: SourceType.EMPTY,
    consumedKeys: [],
    workspaceDescription:
      "Your workspace is empty. " +
      "Create files and directories as needed for your task.",
    entryName: "",
  };
}
