"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkflowGraphModel, WorkflowGraphNode } from "../workflow-graph-model";
import type { LayoutEngine, LayoutInput, LayoutResult, LayoutScope, NodeDimensions } from "./types";
import { createDagreLayoutEngine } from "./dagre-layout-engine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseWorkflowLayoutOptions {
  /**
   * Primary layout engine. Defaults to dagre if not provided.
   * Pass the result of `createElkLayoutEngine()` for ELK-powered layout.
   */
  engine?: LayoutEngine;
  /**
   * Fallback engine used when the primary engine fails.
   * Defaults to a dagre engine instance.
   */
  fallbackEngine?: LayoutEngine;
  /**
   * Per-node dimension provider. Used by the engine to size nodes correctly.
   * Defaults to fixed CANVAS_NODE_WIDTH/HEIGHT constants when omitted.
   * Pass `registryNodeDimensions` for shape-aware sizing from the visual registry.
   */
  getNodeDimensions?: (node: WorkflowGraphNode) => NodeDimensions;
}

export interface UseWorkflowLayoutReturn {
  /**
   * Trigger a layout computation for the given graph and scope.
   * Returns the layout result, or `null` if the request was superseded
   * by a newer one or if all engines failed.
   */
  readonly layoutGraph: (
    graph: WorkflowGraphModel,
    scope: LayoutScope,
  ) => Promise<LayoutResult | null>;
  /** Whether a layout computation is currently in progress. */
  readonly isLayouting: boolean;
  /** The most recent successful layout result. */
  readonly lastResult: LayoutResult | null;
  /** Error message from the last failed attempt (cleared on next success). */
  readonly error: string | null;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Behavior hook (DD-003 layer 2) that orchestrates async layout computation.
 *
 * Manages:
 * - **Generation counter**: overlapping requests are deduplicated; only the
 *   latest result is returned. Stale results from prior requests are discarded.
 * - **Error fallback**: if the primary engine fails, the fallback (dagre) is
 *   tried automatically. Both failures result in a null return + error state.
 * - **Loading state**: `isLayouting` tracks whether computation is in flight.
 * - **Cleanup**: terminates the engine's Web Worker on unmount.
 */
export function useWorkflowLayout(
  options: UseWorkflowLayoutOptions = {},
): UseWorkflowLayoutReturn {
  const { engine, fallbackEngine, getNodeDimensions } = options;

  const [isLayouting, setIsLayouting] = useState(false);
  const [lastResult, setLastResult] = useState<LayoutResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const generationRef = useRef(0);
  const dagreFallbackRef = useRef<LayoutEngine | null>(null);

  function getFallback(): LayoutEngine {
    if (fallbackEngine) return fallbackEngine;
    if (!dagreFallbackRef.current) {
      dagreFallbackRef.current = createDagreLayoutEngine();
    }
    return dagreFallbackRef.current;
  }

  useEffect(() => {
    return () => {
      engine?.terminate?.();
    };
  }, [engine]);

  const layoutGraph = useCallback(
    async (
      graph: WorkflowGraphModel,
      scope: LayoutScope,
    ): Promise<LayoutResult | null> => {
      const generation = ++generationRef.current;
      setIsLayouting(true);
      setError(null);

      const input: LayoutInput = { graph, scope, getNodeDimensions };
      const activeEngine = engine ?? getFallback();

      try {
        const result = await activeEngine.layout(input);

        if (generation !== generationRef.current) {
          return null;
        }

        setLastResult(result);
        setIsLayouting(false);
        return result;
      } catch (primaryError) {
        if (generation !== generationRef.current) {
          return null;
        }

        if (activeEngine !== getFallback()) {
          const message = primaryError instanceof Error
            ? primaryError.message
            : "Layout engine failed";

          if (process.env.NODE_ENV !== "production") {
            console.warn(
              `[useWorkflowLayout] Primary engine "${activeEngine.name}" failed: ${message}. Falling back to dagre.`,
            );
          }

          try {
            const fallbackResult = await getFallback().layout(input);

            if (generation !== generationRef.current) {
              return null;
            }

            setLastResult(fallbackResult);
            setError(`Layout optimized with fallback engine (${message})`);
            setIsLayouting(false);
            return fallbackResult;
          } catch (fallbackError) {
            if (generation !== generationRef.current) return null;

            const msg = fallbackError instanceof Error
              ? fallbackError.message
              : "Fallback layout also failed";
            setError(msg);
            setIsLayouting(false);
            return null;
          }
        }

        const msg = primaryError instanceof Error
          ? primaryError.message
          : "Layout failed";
        setError(msg);
        setIsLayouting(false);
        return null;
      }
    },
    [engine, fallbackEngine, getNodeDimensions],
  );

  return { layoutGraph, isLayouting, lastResult, error };
}
