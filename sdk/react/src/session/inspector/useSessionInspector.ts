"use client";

import { useCallback, useRef, useState } from "react";
import { ExecutionPhase } from "@stigmer/protos/ai/stigmer/agentic/agentexecution/v1/enum_pb";
import type { TabItem } from "../../tabs/Tabs.js";
import { isTerminalPhase } from "../../execution/execution-phases.js";
import type { SelectedThreadItem } from "../../internal/store/selection-store.js";
import type { SelectedWorkspaceFile } from "../../internal/store/workspace-file-selection-store.js";

export type SessionInspectorTabId =
  | "workspace"
  | "viewer"
  | "configure"
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
  /**
   * The workspace file currently open in the viewer, or `null`. When set, a
   * contextual "Viewer" tab surfaces (right after Workspace) and is
   * auto-selected — mirroring how `selectedItem` surfaces the "Inspect" tab.
   * Optional so existing call sites that predate the viewer stay unchanged.
   */
  readonly selectedFile?: SelectedWorkspaceFile | null;
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
 * 2. Workspace file open -> "viewer"
 * 3. Otherwise -> "workspace"
 *
 * Live execution progress (the agent's plan and todos) now renders inline in
 * the message thread as a {@link TodoCard}, not in a sidebar tab — so a running
 * execution no longer steers the inspector to a dedicated facet.
 */
function deriveAutoTab(
  selectedItem: SelectedThreadItem | null,
  selectedFile: SelectedWorkspaceFile | null,
): SessionInspectorTabId {
  if (selectedItem) return "inspect";
  if (selectedFile) return "viewer";
  return "workspace";
}

/**
 * Build the contextual tab list with badges.
 *
 * Tab order follows the user's mental model — context before output:
 * Workspace → Config → Usage. Changes and Artifacts appear after Config
 * when data exists; Inspect appears last when a thread item is selected.
 *
 * The Changes tab surfaces only when git write-backs (PRs) exist, badged
 * with their count. Local-workspace file edits never surface a tab: they
 * render in the transcript (stamped edit rows + the per-turn decision bar),
 * which is their single review surface.
 */
export function buildVisibleTabs(opts: {
  hasWriteBacks: boolean;
  writeBackCount: number;
  hasArtifacts: boolean;
  artifactCount: number;
  hasUsage: boolean;
  selectedItem: SelectedThreadItem | null;
  selectedFile?: SelectedWorkspaceFile | null;
}): TabItem[] {
  const tabs: TabItem[] = [{ id: "workspace", label: "Workspace" }];

  // The Viewer sits next to its source (the Workspace file tree), surfacing
  // only while a file is open — the file-content peer of the "Inspect" tab.
  if (opts.selectedFile) {
    tabs.push({ id: "viewer", label: "Viewer" });
  }

  tabs.push({ id: "configure", label: "Config" });

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
  const selectedFile = opts.selectedFile ?? null;

  const tabs = buildVisibleTabs({ hasWriteBacks, writeBackCount, hasArtifacts, artifactCount, hasUsage, selectedItem, selectedFile });

  // A write-back (the session's only tab-worthy change source) surfaces and
  // auto-selects the Changes tab on first arrival.
  const hasChanges = hasWriteBacks;

  const [activeTab, setActiveTab] = useState<SessionInspectorTabId>(
    () => deriveAutoTab(selectedItem, selectedFile),
  );
  const [prevPhase, setPrevPhase] = useState(phase);
  const [prevSelected, setPrevSelected] = useState(selectedItem);
  const [prevSelectedFile, setPrevSelectedFile] = useState(selectedFile);
  const [prevHasChanges, setPrevHasChanges] = useState(hasChanges);
  const userPickedTabRef = useRef(false);

  // Selection changed → auto-switch to inspect (unless user picked)
  if (selectedItem !== prevSelected) {
    setPrevSelected(selectedItem);
    if (selectedItem && !userPickedTabRef.current) {
      setActiveTab("inspect");
    }
    if (!selectedItem && activeTab === "inspect") {
      setActiveTab(deriveAutoTab(null, selectedFile));
      userPickedTabRef.current = false;
    }
  }

  // A file opened/closed → auto-switch to/from the viewer (unless user picked).
  // Mirrors the selectedItem → inspect block above; the two selection domains
  // are independent, so opening a file steers to the viewer just as selecting a
  // thread item steers to inspect.
  if (selectedFile !== prevSelectedFile) {
    setPrevSelectedFile(selectedFile);
    if (selectedFile && !userPickedTabRef.current) {
      setActiveTab("viewer");
    }
    if (!selectedFile && activeTab === "viewer") {
      setActiveTab(deriveAutoTab(selectedItem, null));
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
      setActiveTab(deriveAutoTab(selectedItem, selectedFile));
    }
  }

  // First write-back arrived → auto-switch to changes
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
    : deriveAutoTab(selectedItem, selectedFile);

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
