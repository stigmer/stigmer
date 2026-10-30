"use client";

import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import {
  WorkspaceFileSelectionStore,
  type SelectedWorkspaceFile,
} from "./workspace-file-selection-store.js";
import {
  WorkspaceEditorsStore,
  type WorkspaceEditorsSnapshot,
} from "./workspace-editors-store.js";

// The conversation store and its hook live beside each other, re-exported
// here: this barrel's own code is what the launcher reaches, so it holds no
// reference to the conversation store, which only a conversation needs.
export { ConversationStore, useConversationStoreRef } from "@stigmer/react-core/internal";
export { type StreamState } from "@stigmer/react-core";

export { WorkspaceFileSelectionStore } from "./workspace-file-selection-store.js";
export type { SelectedWorkspaceFile } from "./workspace-file-selection-store.js";

export {
  WorkspaceEditorsStore,
  editorKey,
  virtualEntryId,
  isVirtualEntryId,
} from "./workspace-editors-store.js";
export type {
  OpenEditor,
  OpenFileOptions,
  EditorReveal,
  WorkspaceEditorsSnapshot,
} from "./workspace-editors-store.js";

// ---------------------------------------------------------------------------
// Workspace file selection — the shared "which file is open" store
// ---------------------------------------------------------------------------

/**
 * Internal context carrying the {@link WorkspaceFileSelectionStore} instance
 * (stable ref) to both columns of the session viewer. Not exported from the
 * public SDK barrel — consumed only within SDK components and `SessionViewer`.
 */
export const WorkspaceFileSelectionContext =
  createContext<WorkspaceFileSelectionStore | null>(null);

/**
 * Access the workspace-file selection store from context.
 * Throws if called outside a `WorkspaceFileSelectionContext.Provider`.
 */
export function useWorkspaceFileSelectionStore(): WorkspaceFileSelectionStore {
  const store = useContext(WorkspaceFileSelectionContext);
  if (!store) {
    throw new Error(
      "useWorkspaceFileSelectionStore must be used within a WorkspaceFileSelectionContext.Provider",
    );
  }
  return store;
}

/**
 * Create or reuse a `WorkspaceFileSelectionStore` instance, preserved across
 * re-renders via ref. `SessionViewer` calls this and provides the result
 * through {@link WorkspaceFileSelectionContext}.
 */
export function useWorkspaceFileSelectionStoreRef(): WorkspaceFileSelectionStore {
  const ref = useRef<WorkspaceFileSelectionStore | null>(null);
  if (!ref.current) {
    ref.current = new WorkspaceFileSelectionStore();
  }
  return ref.current;
}

/** Subscribe to the currently-selected workspace file. */
export function useWorkspaceFileSelection(
  store: WorkspaceFileSelectionStore,
): SelectedWorkspaceFile | null {
  return useSyncExternalStore(store.subscribe, store.getSelection);
}

// ---------------------------------------------------------------------------
// Workspace editors — the surface's open-editor group
// ---------------------------------------------------------------------------

/**
 * Create or reuse a `WorkspaceEditorsStore` instance, preserved across
 * re-renders via ref. Owned by `SessionViewer` alongside the selection store;
 * the surface subscribes to it for its tab group.
 */
export function useWorkspaceEditorsStoreRef(): WorkspaceEditorsStore {
  const ref = useRef<WorkspaceEditorsStore | null>(null);
  if (!ref.current) {
    ref.current = new WorkspaceEditorsStore();
  }
  return ref.current;
}

/** Subscribe to the open-editor group snapshot. */
export function useWorkspaceEditors(
  store: WorkspaceEditorsStore,
): WorkspaceEditorsSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
