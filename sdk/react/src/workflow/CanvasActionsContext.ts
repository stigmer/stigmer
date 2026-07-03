"use client";

import { createContext } from "react";
import type { WorkflowGraphModel } from "./workflow-graph-model.js";

export interface CanvasActions {
  insertTaskOnEdge: (edgeId: string, kindString: string) => void;
  deleteNode: (nodeId: string) => void;
  addSuccessorTask: (sourceNodeId: string, kindString: string) => void;
  duplicateNode: (nodeId: string) => void;
  addSwitchCase: (switchNodeId: string, caseName: string, condition: string) => void;
  addForkBranch: (forkNodeId: string, branchName: string) => void;
  addCatchHandler: (tryCatchNodeId: string, errorType: string) => void;
  removeSwitchCase: (switchNodeId: string, caseName: string) => void;
  reorderSwitchCases: (switchNodeId: string, newOrder: readonly string[]) => void;
  removeForkBranch: (forkNodeId: string, branchName: string) => void;
  reorderForkBranches: (forkNodeId: string, newOrder: readonly string[]) => void;
  renameForkBranch: (forkNodeId: string, oldName: string, newName: string) => void;
  setForkCompete: (forkNodeId: string, compete: boolean) => void;
  updateCatchConfig: (tryCatchNodeId: string, updates: { as?: string; compensate?: boolean }) => void;
  removeCatchBlock: (tryCatchNodeId: string) => void;
  updateForEachConfig: (forEachNodeId: string, updates: Partial<{ each: string; in: string; max_parallelism: number; batch_size: number; on_error: string }>) => void;
  getGraphModel: () => WorkflowGraphModel;
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null);
