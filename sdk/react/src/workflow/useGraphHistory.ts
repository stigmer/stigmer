"use client";

import { useState, useCallback, useRef } from "react";
import type { WorkflowGraphModel } from "./workflow-graph-model.js";
import type { GraphCommand } from "./graph-commands.js";
import { GraphHistory } from "./graph-commands.js";

/** Return value of {@link useGraphHistory}. */
export interface UseGraphHistoryReturn {
  readonly currentModel: WorkflowGraphModel;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly dispatch: (command: GraphCommand) => WorkflowGraphModel;
  readonly undo: () => WorkflowGraphModel | null;
  readonly redo: () => WorkflowGraphModel | null;
  readonly reset: (model: WorkflowGraphModel) => void;
}

/**
 * React wrapper around {@link GraphHistory} providing undo/redo state
 * management.
 *
 * Every mutation (`dispatch`, `undo`, `redo`) returns the resulting model
 * SYNCHRONOUSLY so callers can derive dependent state (React Flow
 * elements) in the same event handler. `currentModel` is a render-time
 * snapshot — inside a callback it may be stale, so consumers reacting to
 * a mutation must use the returned model, never `currentModel`
 * (oss#588 was exactly that stale read).
 *
 * This hook deliberately owns NO DOM listeners: it cannot sync the canvas,
 * so letting it mutate the model from a keyboard shortcut would desync
 * model and canvas. Keyboard undo/redo binding lives with the other
 * canvas shortcuts in `useCanvasKeyboardShortcuts`, wired to the
 * orchestrator's syncing wrappers (`useWorkflowCanvas.undo`/`redo`).
 *
 * @param initialModel - The starting graph model (from YAML parse).
 *
 * @since T15 Batch 2 (Node Authoring)
 */
export function useGraphHistory(
  initialModel: WorkflowGraphModel | null,
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

  const undo = useCallback((): WorkflowGraphModel | null => {
    const history = historyRef.current;
    if (!history?.canUndo) return null;
    const next = history.undo();
    setModel(next);
    forceUpdate();
    return next;
  }, [forceUpdate]);

  const redo = useCallback((): WorkflowGraphModel | null => {
    const history = historyRef.current;
    if (!history?.canRedo) return null;
    const next = history.redo();
    setModel(next);
    forceUpdate();
    return next;
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
