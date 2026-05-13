"use client";

import { createContext, useContext, useRef, useSyncExternalStore } from "react";
import type { AgentExecution } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/api_pb";
import { ConversationStore, type StreamState } from "./conversation-store";

export { ConversationStore, type StreamState } from "./conversation-store";
export { structuralShare } from "./structural-share";
export {
  WorkflowExecutionEventStore,
  type WorkflowEventStreamState,
  type DerivedTaskState,
  type DerivedCostSummary,
} from "./workflow-execution-event-store";

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
