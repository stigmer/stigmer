"use client";

import { useCallback, useRef, useState } from "react";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { TabItem } from "../../tabs/Tabs";
import { isTerminalPhase } from "../../execution/execution-phases";
import type { SelectedThreadItem } from "../../internal/store/selection-store";

export type SessionInspectorTabId =
  | "workspace"
  | "configure"
  | "plan"
  | "changes"
  | "artifacts"
  | "usage"
  | "inspect";

export interface UseSessionInspectorOptions {
  readonly phase: ExecutionPhase | null;
  readonly hasWriteBacks: boolean;
  readonly writeBackCount: number;
  readonly hasArtifacts: boolean;
  readonly artifactCount: number;
  readonly hasUsage: boolean;
  readonly selectedItem: SelectedThreadItem | null;
}

export interface UseSessionInspectorReturn {
  readonly tabs: readonly TabItem[];
  readonly activeTab: SessionInspectorTabId;
  readonly onTabChange: (tabId: string) => void;
}

/**
 * Compute the system-suggested tab from execution phase and selection.
 *
 * Priority:
 * 1. Thread item selected -> "inspect"
 * 2. No execution or terminal phase (idle / ready for follow-up) -> "workspace"
 * 3. Actively running -> "plan"
 */
function deriveAutoTab(
  phase: ExecutionPhase | null,
  selectedItem: SelectedThreadItem | null,
): SessionInspectorTabId {
  if (selectedItem) return "inspect";
  if (phase === null || isTerminalPhase(phase)) return "workspace";
  return "plan";
}

/**
 * Build the contextual tab list with badges.
 *
 * Tab order follows the user's mental model — context before output:
 * Workspace → Config → Plan → Usage. Changes and Artifacts appear
 * after Plan when data exists; Inspect appears last when a thread item
 * is selected.
 */
export function buildVisibleTabs(opts: {
  hasWriteBacks: boolean;
  writeBackCount: number;
  hasArtifacts: boolean;
  artifactCount: number;
  hasUsage: boolean;
  selectedItem: SelectedThreadItem | null;
}): TabItem[] {
  const tabs: TabItem[] = [
    { id: "workspace", label: "Workspace" },
    { id: "configure", label: "Config" },
    { id: "plan", label: "Plan" },
  ];

  if (opts.hasWriteBacks) {
    tabs.push({
      id: "changes",
      label: "Changes",
      badge: opts.writeBackCount,
    });
  }

  if (opts.hasArtifacts) {
    tabs.push({
      id: "artifacts",
      label: "Artifacts",
      badge: opts.artifactCount,
    });
  }

  tabs.push({ id: "usage", label: "Usage" });

  if (opts.selectedItem) {
    tabs.push({ id: "inspect", label: "Inspect" });
  }

  return tabs;
}

/**
 * Behavior hook for SessionInspector tab state management.
 *
 * Uses the "adjust state during render" pattern from the workflow
 * `ExecutionInspector`: shadow `prevPhase`/`prevSelected` state,
 * `userPickedTabRef` for sticky manual picks, and `deriveAutoTab`
 * for system suggestions. Keeps the user's tab pick sticky until
 * a meaningful state change resets it.
 */
export function useSessionInspector(
  opts: UseSessionInspectorOptions,
): UseSessionInspectorReturn {
  const { phase, hasWriteBacks, writeBackCount, hasArtifacts, artifactCount, hasUsage, selectedItem } = opts;

  const tabs = buildVisibleTabs({ hasWriteBacks, writeBackCount, hasArtifacts, artifactCount, hasUsage, selectedItem });

  const [activeTab, setActiveTab] = useState<SessionInspectorTabId>(
    () => deriveAutoTab(phase, selectedItem),
  );
  const [prevPhase, setPrevPhase] = useState(phase);
  const [prevSelected, setPrevSelected] = useState(selectedItem);
  const [prevHasWriteBacks, setPrevHasWriteBacks] = useState(hasWriteBacks);
  const userPickedTabRef = useRef(false);

  // Selection changed → auto-switch to inspect (unless user picked)
  if (selectedItem !== prevSelected) {
    setPrevSelected(selectedItem);
    if (selectedItem && !userPickedTabRef.current) {
      setActiveTab("inspect");
    }
    if (!selectedItem && activeTab === "inspect") {
      setActiveTab(deriveAutoTab(phase, null));
      userPickedTabRef.current = false;
    }
  }

  // Phase changed → reset user pick if transitioning from non-terminal to terminal or vice versa
  if (phase !== prevPhase) {
    const wasTerminal = prevPhase !== null && isTerminalPhase(prevPhase);
    const isNowTerminal = phase !== null && isTerminalPhase(phase);
    setPrevPhase(phase);
    if (wasTerminal !== isNowTerminal) {
      userPickedTabRef.current = false;
      setActiveTab(deriveAutoTab(phase, selectedItem));
    }
  }

  // First write-back arrived → auto-switch to changes
  if (hasWriteBacks && !prevHasWriteBacks) {
    setPrevHasWriteBacks(hasWriteBacks);
    if (!userPickedTabRef.current) {
      setActiveTab("changes");
    }
  }
  if (hasWriteBacks !== prevHasWriteBacks) {
    setPrevHasWriteBacks(hasWriteBacks);
  }

  // Ensure active tab is valid (the selected tab may have been removed)
  const effectiveTab = tabs.some((t) => t.id === activeTab)
    ? activeTab
    : deriveAutoTab(phase, selectedItem);

  const onTabChange = useCallback((tabId: string) => {
    userPickedTabRef.current = true;
    setActiveTab(tabId as SessionInspectorTabId);
  }, []);

  return {
    tabs,
    activeTab: effectiveTab,
    onTabChange,
  };
}
