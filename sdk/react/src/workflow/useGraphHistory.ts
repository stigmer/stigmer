"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { RefObject } from "react";
import type { WorkflowGraphModel } from "./workflow-graph-model";
import type { GraphCommand } from "./graph-commands";
import { GraphHistory } from "./graph-commands";

/** Return value of {@link useGraphHistory}. */
export interface UseGraphHistoryReturn {
  readonly currentModel: WorkflowGraphModel;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly dispatch: (command: GraphCommand) => WorkflowGraphModel;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly reset: (model: WorkflowGraphModel) => void;
}

/**
 * React wrapper around {@link GraphHistory} providing undo/redo state
 * management and keyboard shortcut binding.
 *
 * Keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z) are only active
 * when the referenced container element contains the active focus target,
 * preventing conflicts with other editors on the page.
 *
 * @param initialModel - The starting graph model (from YAML parse).
 * @param containerRef - Ref to the DOM element that scopes keyboard shortcuts.
 *
 * @since T15 Batch 2 (Node Authoring)
 */
export function useGraphHistory(
  initialModel: WorkflowGraphModel | null,
  containerRef: RefObject<HTMLDivElement | null>,
): UseGraphHistoryReturn {
  const historyRef = useRef<GraphHistory | null>(null);
  const [model, setModel] = useState<WorkflowGraphModel | null>(null);
  const [, setVersion] = useState(0);

  if (initialModel && !historyRef.current) {
    historyRef.current = new GraphHistory(initialModel);
    if (!model) {
      setModel(initialModel);
    }
  }

  const forceUpdate = useCallback(() => {
    setVersion((v) => v + 1);
  }, []);

  const dispatch = useCallback(
    (command: GraphCommand): WorkflowGraphModel => {
      const history = historyRef.current;
      if (!history) throw new Error("GraphHistory not initialized.");
      const next = history.dispatch(command);
      setModel(next);
      forceUpdate();
      return next;
    },
    [forceUpdate],
  );

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (!history?.canUndo) return;
    const next = history.undo();
    setModel(next);
    forceUpdate();
  }, [forceUpdate]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (!history?.canRedo) return;
    const next = history.redo();
    setModel(next);
    forceUpdate();
  }, [forceUpdate]);

  const reset = useCallback(
    (newModel: WorkflowGraphModel) => {
      if (historyRef.current) {
        historyRef.current.reset(newModel);
      } else {
        historyRef.current = new GraphHistory(newModel);
      }
      setModel(newModel);
      forceUpdate();
    },
    [forceUpdate],
  );

  // Keyboard shortcuts: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Shift+Z (redo)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (!container?.contains(document.activeElement) && document.activeElement !== container) {
        return;
      }

      const isMod = e.metaKey || e.ctrlKey;
      if (!isMod || e.key.toLowerCase() !== "z") return;

      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) {
        redo();
      } else {
        undo();
      }
    }

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [containerRef, undo, redo]);

  const canUndo = historyRef.current?.canUndo ?? false;
  const canRedo = historyRef.current?.canRedo ?? false;

  const emptyModel: WorkflowGraphModel = {
    document: { dsl: "1.0.0", namespace: "", name: "", version: "0.0.1" },
    nodes: [],
    edges: [],
  };

  return {
    currentModel: model ?? emptyModel,
    canUndo,
    canRedo,
    dispatch,
    undo,
    redo,
    reset,
  };
}
