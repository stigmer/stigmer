"use client";

import { useMemo } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import type { FileChange } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/message_pb";
import type { WorkspaceEntry } from "../workspace/useWorkspaceEntries.js";
import type { SelectedWorkspaceFile } from "../internal/store/workspace-file-selection-store.js";
import { findChangeForSelection } from "../workspace/findChangeForSelection.js";
import { useSessionFileChanges } from "./useSessionFileChanges.js";

/**
 * Stable empty executions passed to {@link useSessionFileChanges} while no file
 * is open, so the (fetch-free) net-change fold stays trivial during streaming
 * and only folds once a file is actually being viewed.
 */
const EMPTY_EXECUTIONS: readonly AgentExecution[] = [];

/**
 * Correlate the open workspace file with the one session {@link FileChange} that
 * touched it, so a changed file can default to its authoritative
 * `baseline→candidate` diff (Slice 4 / DD-06).
 *
 * The net-change fold is skipped while no file is open (via `EMPTY_EXECUTIONS`),
 * and the join reuses the same DD-08 resolver + entries + sandbox root that
 * opened the file — so "the diff shown" can never disagree with "the file
 * opened". Both the inspector's Viewer tab and the workspace surface consume
 * this single hook rather than re-deriving the correlation.
 *
 * @returns the matching change, or `null` when the open file was not changed
 *   this session (or no file is open).
 */
export function useOpenFileChange(
  selectedFile: SelectedWorkspaceFile | null | undefined,
  allExecutions: readonly AgentExecution[],
  entries: readonly WorkspaceEntry[] | undefined,
  sandboxWorkspaceRoot: string | undefined,
): FileChange | null {
  const { fileChanges } = useSessionFileChanges(
    selectedFile ? allExecutions : EMPTY_EXECUTIONS,
  );
  return useMemo(
    () =>
      selectedFile && entries
        ? findChangeForSelection(
            selectedFile,
            fileChanges,
            entries,
            sandboxWorkspaceRoot,
          ) ?? null
        : null,
    [selectedFile, fileChanges, entries, sandboxWorkspaceRoot],
  );
}
