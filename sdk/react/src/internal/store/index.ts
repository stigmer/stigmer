"use client";

import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ConversationStore, type StreamState } from "./conversation-store.js";
import {
  WorkspaceFileSelectionStore,
  type SelectedWorkspaceFile,
} from "./workspace-file-selection-store.js";

export { ConversationStore, type StreamState } from "./conversation-store.js";
export { structuralShare } from "./structural-share.js";
export {
  WorkflowExecutionEventStore,
  type WorkflowEventStreamState,
  type DerivedTaskState,
  type DerivedCostSummary,
} from "./workflow-execution-event-store.js";

export { SelectionStore } from "./selection-store.js";
export type { SelectedThreadItem } from "./selection-store.js";

export { WorkspaceFileSelectionStore } from "./workspace-file-selection-store.js";
export type { SelectedWorkspaceFile } from "./workspace-file-selection-store.js";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/**
 * Internal context for the conversation store. Not exported from the
 * public SDK barrel — used only within SDK hooks and components.
 */
export const ConversationStoreContext =
  createContext<ConversationStore | null>(null);

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

/**
 * Access the conversation store from context.
 * Throws if called outside a `ConversationStoreContext.Provider`.
 */
export function useConversationStore(): ConversationStore {
  const store = useContext(ConversationStoreContext);
  if (!store) {
    throw new Error(
      "useConversationStore must be used within a ConversationStoreContext.Provider",
    );
  }
  return store;
}

/**
 * Create or reuse a `ConversationStore` instance. The store is
 * created once and preserved across re-renders via ref.
 */
export function useConversationStoreRef(): ConversationStore {
  const ref = useRef<ConversationStore | null>(null);
  if (!ref.current) {
    ref.current = new ConversationStore();
  }
  return ref.current;
}

/**
 * Subscribe to the execution snapshot from the conversation store.
 * Returns a stable reference when the execution is unchanged
 * (structural sharing ensures this).
 */
export function useStoreExecution(
  store: ConversationStore,
): AgentExecution | null {
  return useSyncExternalStore(store.subscribe, store.getExecution);
}

/**
 * Subscribe to the stream lifecycle state from the conversation store.
 * Returns a stable reference when the state is unchanged.
 */
export function useStoreStreamState(store: ConversationStore): StreamState {
  return useSyncExternalStore(store.subscribe, store.getStreamState);
}

// ---------------------------------------------------------------------------
// Workspace file selection — the DD-07 shared "which file is open" store
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
 * through {@link WorkspaceFileSelectionContext} (DD-07).
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
