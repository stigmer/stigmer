"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Rendering mode for the unified workflow graph component.
 *
 * - `design`: Interactive editing — draggable nodes, connectable edges,
 *   plus buttons, inspector config, undo/redo.
 * - `overview`: Read-only structural view — pannable/zoomable, task
 *   summary popovers, recent health badges.
 * - `execution`: Read-only with live status — execution overlays, branch
 *   highlighting, runtime inspector.
 * - `diff`: Read-only visual diff — added/removed/modified node badges,
 *   change-highlighting edges, summary bar.
 */
export type WorkflowGraphMode = "design" | "overview" | "execution" | "diff";

const Context = createContext<WorkflowGraphMode>("design");

export interface WorkflowGraphModeProviderProps {
  readonly mode: WorkflowGraphMode;
  readonly children: ReactNode;
}

/**
 * Provides the current graph rendering mode to all descendant workflow
 * components. Nodes, edges, and interaction components read from this
 * context to decide which affordances to render.
 *
 * The default mode is `"design"` to maintain backward compatibility
 * with the existing canvas editor (which does not wrap in a provider).
 */
export function WorkflowGraphModeProvider({ mode, children }: WorkflowGraphModeProviderProps) {
  return <Context.Provider value={mode}>{children}</Context.Provider>;
}

/**
 * Returns the current workflow graph rendering mode.
 *
 * Defaults to `"design"` when used outside a provider, ensuring existing
 * editor code continues to work without modification.
 */
export function useWorkflowGraphMode(): WorkflowGraphMode {
  return useContext(Context);
}
