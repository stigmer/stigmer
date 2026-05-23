"use client";

import { createContext } from "react";
import type { WorkflowGraphModel } from "./workflow-graph-model";

export interface CanvasActions {
  insertTaskOnEdge: (edgeId: string, kindString: string) => void;
  deleteNode: (nodeId: string) => void;
  addSuccessorTask: (sourceNodeId: string, kindString: string) => void;
  duplicateNode: (nodeId: string) => void;
  addSwitchCase: (switchNodeId: string, caseName: string, condition: string) => void;
  addForkBranch: (forkNodeId: string, branchName: string) => void;
  addCatchHandler: (tryCatchNodeId: string, errorType: string) => void;
  getGraphModel: () => WorkflowGraphModel;
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null);
