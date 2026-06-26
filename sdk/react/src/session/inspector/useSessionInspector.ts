"use client";

import { useCallback, useRef, useState } from "react";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { TabItem } from "../../tabs/Tabs";
import { isTerminalPhase } from "../../execution/execution-phases";
import type { SelectedThreadItem } from "../../internal/store/selection-store";

export type SessionInspectorTabId =
  | "workspace"
  | "configure"
  | "changes"
  | "artifacts"
  | "usage"
  | "inspect";

export interface UseSessionInspectorOptions {
  readonly phase: ExecutionPhase | null;
  readonly hasWriteBacks: boolean;
  readonly writeBackCount: number;
  /** `true` when local-workspace file changes exist (Changes tab, local mode). */
  readonly hasFileChanges: boolean;
  /** Number of changed files; the Changes badge in local mode. */
  readonly fileChangeCount: number;
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
 * Compute the system-suggested tab from selection.
 *
 * Priority:
 * 1. Thread item selected -> "inspect"
 * 2. Otherwise -> "workspace"
 *
 * Live execution progress (the agent's plan and todos) now renders inline in
 * the message thread as a {@link TodoCard}, not in a sidebar tab — so a running
 * execution no longer steers the inspector to a dedicated facet.
 */
function deriveAutoTab(
  selectedItem: SelectedThreadItem | null,
): SessionInspectorTabId {
  if (selectedItem) return "inspect";
  return "workspace";
}

/**
 * Build the contextual tab list with badges.
 *
 * Tab order follows the user's mental model — context before output:
 * Workspace → Config → Usage. Changes and Artifacts appear after Config
 * when data exists; Inspect appears last when a thread item is selected.
 *
 * The Changes tab surfaces for either change source: git write-backs (PRs)
 * or local-workspace file edits. Its badge prefers the write-back count
 * (git mode wins the tab) and falls back to the changed-file count.
 */
export function buildVisibleTabs(opts: {
  hasWriteBacks: boolean;
  writeBackCount: number;
  hasFileChanges: boolean;
  fileChangeCount: number;
  hasArtifacts: boolean;
  artifactCount: number;
  hasUsage: boolean;
  selectedItem: SelectedThreadItem | null;
}): TabItem[] {
  const tabs: TabItem[] = [
    { id: "workspace", label: "Workspace" },
    { id: "configure", label: "Config" },
  ];

  if (opts.hasWriteBacks || opts.hasFileChanges) {
    tabs.push({
      id: "changes",
      label: "Changes",
      badge: opts.hasWriteBacks ? opts.writeBackCount : opts.fileChangeCount,
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
  const { phase, hasWriteBacks, writeBackCount, hasFileChanges, fileChangeCount, hasArtifacts, artifactCount, hasUsage, selectedItem } = opts;

  const tabs = buildVisibleTabs({ hasWriteBacks, writeBackCount, hasFileChanges, fileChangeCount, hasArtifacts, artifactCount, hasUsage, selectedItem });

  // Either change source (git write-back or local file edit) surfaces and
  // auto-selects the Changes tab on first arrival.
  const hasChanges = hasWriteBacks || hasFileChanges;

  const [activeTab, setActiveTab] = useState<SessionInspectorTabId>(
    () => deriveAutoTab(selectedItem),
  );
  const [prevPhase, setPrevPhase] = useState(phase);
  const [prevSelected, setPrevSelected] = useState(selectedItem);
  const [prevHasChanges, setPrevHasChanges] = useState(hasChanges);
  const userPickedTabRef = useRef(false);

  // Selection changed → auto-switch to inspect (unless user picked)
  if (selectedItem !== prevSelected) {
    setPrevSelected(selectedItem);
    if (selectedItem && !userPickedTabRef.current) {
      setActiveTab("inspect");
    }
    if (!selectedItem && activeTab === "inspect") {
      setActiveTab(deriveAutoTab(null));
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
      setActiveTab(deriveAutoTab(selectedItem));
    }
  }

  // First change arrived (write-back or file edit) → auto-switch to changes
  if (hasChanges && !prevHasChanges) {
    setPrevHasChanges(hasChanges);
    if (!userPickedTabRef.current) {
      setActiveTab("changes");
    }
  }
  if (hasChanges !== prevHasChanges) {
    setPrevHasChanges(hasChanges);
  }

  // Ensure active tab is valid (the selected tab may have been removed)
  const effectiveTab = tabs.some((t) => t.id === activeTab)
    ? activeTab
    : deriveAutoTab(selectedItem);

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
