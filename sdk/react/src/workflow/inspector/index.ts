/**
 * Inspector module — tabbed, mode-aware configuration surface.
 *
 * @since T10 (Inspector Panel Refactor)
 */

// Shell
export { InspectorShell } from "./InspectorShell";
export type { InspectorShellProps } from "./InspectorShell";

// Header
export { InspectorHeader } from "./InspectorHeader";
export type { InspectorHeaderProps } from "./InspectorHeader";

// Tabs hook
export { useInspectorTabs } from "./useInspectorTabs";
export type { UseInspectorTabsInput, UseInspectorTabsReturn } from "./useInspectorTabs";

// Sub-inspectors
export { EdgeInspector } from "./EdgeInspector";
export type { EdgeInspectorProps } from "./EdgeInspector";
export { SentinelInspector } from "./SentinelInspector";
export type { SentinelInspectorProps } from "./SentinelInspector";

// Tab content components
export { ConfigureTab } from "./tabs/ConfigureTab";
export type { ConfigureTabProps } from "./tabs/ConfigureTab";
export { DataTab } from "./tabs/DataTab";
export type { DataTabProps } from "./tabs/DataTab";
export { RuntimeTab } from "./tabs/RuntimeTab";
export type { RuntimeTabProps } from "./tabs/RuntimeTab";
export { AdvancedTab } from "./tabs/AdvancedTab";
export type { AdvancedTabProps } from "./tabs/AdvancedTab";
export { DocsTab } from "./tabs/DocsTab";
export type { DocsTabProps } from "./tabs/DocsTab";

// Execution mode adapter
export { ExecutionInspectorAdapter } from "./ExecutionInspectorAdapter";
export type { ExecutionInspectorAdapterProps } from "./ExecutionInspectorAdapter";

// Per-kind forms
export { AgentCallForm } from "./forms/AgentCallForm";
export type { AgentCallFormProps } from "./forms/AgentCallForm";
export { HttpCallForm } from "./forms/HttpCallForm";
export type { HttpCallFormProps } from "./forms/HttpCallForm";

// Task YAML serialization
export { taskToYaml } from "./task-to-yaml";

// Workflow summary (empty state)
export { WorkflowSummaryPanel } from "./WorkflowSummaryPanel";
export type { WorkflowSummaryPanelProps } from "./WorkflowSummaryPanel";

// Types
export type {
  DesignTabId,
  ExecutionTabId,
  InspectorTabId,
  InspectorMode,
  InspectorNodeIdentity,
  InspectorTabDefinition,
  InspectorMutations,
} from "./types";
