"use client";

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import type { TaskKindDescriptor } from "../types";
import type {
  DesignTabId,
  InspectorTabDefinition,
  InspectorMode,
} from "./types";

/** Arguments for {@link useInspectorTabs}. */
export interface UseInspectorTabsInput {
  /** Task kind string (e.g. "agent_call"). Null when no node is selected. */
  readonly kindString: string | null;
  /** Descriptor for the selected task kind. */
  readonly descriptor: TaskKindDescriptor | undefined;
  /** Inspector operating mode. */
  readonly mode: InspectorMode;
  /** Stable node ID — tab resets when this changes. */
  readonly nodeId: string | null;
}

/** Return value of {@link useInspectorTabs}. */
export interface UseInspectorTabsReturn {
  /** Visible tabs for the current selection. */
  readonly tabs: readonly InspectorTabDefinition[];
  /** Currently active tab ID. */
  readonly activeTab: DesignTabId;
  /** Set the active tab. */
  readonly setActiveTab: (tabId: DesignTabId) => void;
}

const AI_KINDS = new Set(["agent_call", "llm_call", "eval"]);
const INVOCATION_KINDS = new Set(["http_call", "grpc_call", "activity_call", "run_workflow"]);
const CONTAINER_KINDS = new Set(["for_each", "fork", "try_catch"]);
const BRANCH_TAB_KINDS = new Set(["switch_case", "fork"]);
const CATCH_TAB_KINDS = new Set(["try_catch"]);
const ITERATION_TAB_KINDS = new Set(["for_each"]);

/**
 * Behavior hook that computes visible inspector tabs and manages active tab state.
 *
 * Tab visibility is determined by the task kind and its category:
 * - **Configure** — always visible (default tab)
 * - **Data** — visible for all kinds (export/input mapping)
 * - **Runtime** — visible for AI, invocation, and container kinds
 * - **Advanced** — always visible (flow control, raw YAML)
 * - **Docs** — visible when the descriptor has examples or documentation URL
 *
 * Resets to "Configure" when the selected node changes.
 *
 * @since T10 (Inspector Panel Refactor)
 */
export function useInspectorTabs({
  kindString,
  descriptor,
  mode,
  nodeId,
}: UseInspectorTabsInput): UseInspectorTabsReturn {
  const [activeTab, setActiveTabRaw] = useState<DesignTabId>("configure");
  const prevNodeIdRef = useRef(nodeId);

  useEffect(() => {
    if (nodeId !== prevNodeIdRef.current) {
      prevNodeIdRef.current = nodeId;
      setActiveTabRaw("configure");
    }
  }, [nodeId]);

  const setActiveTab = useCallback((tabId: DesignTabId) => {
    setActiveTabRaw(tabId);
  }, []);

  const tabs = useMemo((): readonly InspectorTabDefinition[] => {
    if (mode !== "design" || !kindString) return [];

    const result: InspectorTabDefinition[] = [
      { id: "configure", label: "Configure" },
    ];

    if (BRANCH_TAB_KINDS.has(kindString)) {
      result.push({ id: "branches", label: "Branches" });
    }

    if (CATCH_TAB_KINDS.has(kindString)) {
      result.push({ id: "catch", label: "Catch" });
    }

    if (ITERATION_TAB_KINDS.has(kindString)) {
      result.push({ id: "iteration", label: "Iteration" });
    }

    result.push({ id: "data", label: "Data" });

    const showRuntime =
      AI_KINDS.has(kindString) ||
      INVOCATION_KINDS.has(kindString) ||
      CONTAINER_KINDS.has(kindString);

    if (showRuntime) {
      result.push({ id: "runtime", label: "Runtime" });
    }

    result.push({ id: "advanced", label: "Advanced" });

    const hasDocs =
      descriptor &&
      (descriptor.documentationUrl ||
        (descriptor.yamlExamples && descriptor.yamlExamples.length > 0));

    if (hasDocs) {
      result.push({ id: "docs", label: "Docs" });
    }

    return result;
  }, [kindString, descriptor, mode]);

  return { tabs, activeTab, setActiveTab };
}
