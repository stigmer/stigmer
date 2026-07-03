"use client";

import { useCallback, useMemo, useState } from "react";
import {
  useWorkspaceEditorsStoreRef,
  type WorkspaceEditorsStore,
} from "../internal/store/index.js";

/**
 * State + actions for the workspace-surface layout flip, shared by every viewer
 * that hosts the surface (session + launcher) so they behave identically
 * (DD-016).
 *
 * Owns the {@link WorkspaceEditorsStore} (the open-editor group) and a plain
 * `workspaceMode` flag. Both are decoupled from any store subscription at the
 * owner level: callbacks mutate imperatively so a file open/switch re-renders
 * only the subscribing panel, never the streaming conversation column
 * (DD-009/DD-010, invariant 2).
 */
export interface WorkspaceModeController {
  /** The open-editor group store; subscribe with `useWorkspaceEditors`. */
  readonly editorsStore: WorkspaceEditorsStore;
  /** Whether the layout is flipped into the workspace-dominant surface. */
  readonly workspaceMode: boolean;
  /** Open a file as a preview tab and enter workspace mode. */
  readonly openFileInWorkspace: (entryId: string, path: string) => void;
  /** Enter workspace mode without opening a file (browse / search). */
  readonly enterWorkspace: () => void;
  /** Focus an already-open editor tab. */
  readonly activateEditor: (entryId: string, path: string) => void;
  /** Pin an editor tab (clear its preview state). */
  readonly pinEditor: (entryId: string, path: string) => void;
  /** Close an editor tab; collapses to chat when it was the last one. */
  readonly closeEditor: (entryId: string, path: string) => void;
  /** Collapse to the chat-dominant layout, preserving the editor group. */
  readonly collapseWorkspace: () => void;
  /** Exit workspace mode (keeping editors) so the Inspect facet can surface. */
  readonly exitWorkspaceForInspect: () => void;
}

/** Create a {@link WorkspaceModeController} for a viewer instance. */
export function useWorkspaceMode(): WorkspaceModeController {
  const editorsStore = useWorkspaceEditorsStoreRef();
  const [workspaceMode, setWorkspaceMode] = useState(false);

  const openFileInWorkspace = useCallback(
    (entryId: string, path: string) => {
      editorsStore.openPreview(entryId, path);
      setWorkspaceMode(true);
    },
    [editorsStore],
  );

  const enterWorkspace = useCallback(() => setWorkspaceMode(true), []);

  const activateEditor = useCallback(
    (entryId: string, path: string) => editorsStore.activate(entryId, path),
    [editorsStore],
  );

  const pinEditor = useCallback(
    (entryId: string, path: string) => editorsStore.pin(entryId, path),
    [editorsStore],
  );

  const closeEditor = useCallback(
    (entryId: string, path: string) => {
      editorsStore.close(entryId, path);
      if (editorsStore.getSnapshot().editors.length === 0) {
        setWorkspaceMode(false);
      }
    },
    [editorsStore],
  );

  const collapseWorkspace = useCallback(() => setWorkspaceMode(false), []);
  const exitWorkspaceForInspect = useCallback(() => setWorkspaceMode(false), []);

  return useMemo(
    () => ({
      editorsStore,
      workspaceMode,
      openFileInWorkspace,
      enterWorkspace,
      activateEditor,
      pinEditor,
      closeEditor,
      collapseWorkspace,
      exitWorkspaceForInspect,
    }),
    [
      editorsStore,
      workspaceMode,
      openFileInWorkspace,
      enterWorkspace,
      activateEditor,
      pinEditor,
      closeEditor,
      collapseWorkspace,
      exitWorkspaceForInspect,
    ],
  );
}
