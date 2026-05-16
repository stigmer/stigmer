"use client";

import { createContext } from "react";

export interface CanvasActions {
  insertTaskOnEdge: (edgeId: string, kindString: string) => void;
  deleteNode: (nodeId: string) => void;
}

export const CanvasActionsContext = createContext<CanvasActions | null>(null);
