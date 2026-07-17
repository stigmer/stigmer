/**
 * Inspector module — tabbed, mode-aware configuration surface.
 *
 * @since T10 (Inspector Panel Refactor)
 */

// Shell
export { InspectorShell } from "./InspectorShell.js";
export type { InspectorShellProps } from "./InspectorShell.js";

// Header
export { InspectorHeader } from "./InspectorHeader.js";
export type { InspectorHeaderProps } from "./InspectorHeader.js";

// Tabs hook
export { useInspectorTabs } from "./useInspectorTabs.js";
export type { UseInspectorTabsInput, UseInspectorTabsReturn } from "./useInspectorTabs.js";

// Sub-inspectors
export { EdgeInspector } from "./EdgeInspector.js";
export type { EdgeInspectorProps } from "./EdgeInspector.js";
export { SentinelInspector } from "./SentinelInspector.js";
export type { SentinelInspectorProps } from "./SentinelInspector.js";

// Tab content components
export { ConfigureTab } from "./tabs/ConfigureTab.js";
export type { ConfigureTabProps } from "./tabs/ConfigureTab.js";
export { DataTab } from "./tabs/DataTab.js";
export type { DataTabProps } from "./tabs/DataTab.js";
export { RuntimeTab } from "./tabs/RuntimeTab.js";
export type { RuntimeTabProps } from "./tabs/RuntimeTab.js";
export { AdvancedTab } from "./tabs/AdvancedTab.js";
export type { AdvancedTabProps } from "./tabs/AdvancedTab.js";
export { DocsTab } from "./tabs/DocsTab.js";
export type { DocsTabProps } from "./tabs/DocsTab.js";

// Per-kind forms
export { AgentCallForm } from "./forms/AgentCallForm.js";
export type { AgentCallFormProps } from "./forms/AgentCallForm.js";
export { HttpCallForm } from "./forms/HttpCallForm.js";
export type { HttpCallFormProps } from "./forms/HttpCallForm.js";

// Task YAML serialization
export { taskToYaml } from "./task-to-yaml.js";

// Workflow summary (empty state)
export { WorkflowSummaryPanel } from "./WorkflowSummaryPanel.js";
export type { WorkflowSummaryPanelProps } from "./WorkflowSummaryPanel.js";

// Types
export type {
  DesignTabId,
  ExecutionTabId,
  InspectorTabId,
  InspectorMode,
  InspectorNodeIdentity,
  InspectorTabDefinition,
  InspectorMutations,
} from "./types.js";
