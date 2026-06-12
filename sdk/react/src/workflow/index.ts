export type {
  TaskKindDescriptor,
  TaskKindCategory,
  TaskFieldDescriptor,
  TaskFieldType,
  TaskFieldGroup,
} from "./types";

export {
  serializeWorkflowYaml,
  parseWorkflowYaml,
} from "./serialize-workflow-yaml";

export {
  useWorkflowYaml,
  type UseWorkflowYamlReturn,
} from "./useWorkflowYaml";

export {
  useWorkflowSave,
  type UseWorkflowSaveReturn,
  type WorkflowSaveOptions,
} from "./useWorkflowSave";

export {
  TaskKindRegistryContext,
  type TaskKindRegistryState,
} from "./TaskKindRegistryContext";

export {
  useTaskKindRegistry,
  type UseTaskKindRegistryReturn,
} from "./useTaskKindRegistry";

export {
  useWorkflow,
  type UseWorkflowReturn,
} from "./useWorkflow";

export {
  useWorkflowList,
  type UseWorkflowListOptions,
  type UseWorkflowListReturn,
} from "./useWorkflowList";

export {
  useWorkflowCount,
  type UseWorkflowCountOptions,
  type UseWorkflowCountReturn,
} from "./useWorkflowCount";

export {
  useWorkflowInstances,
  type UseWorkflowInstancesReturn,
} from "./useWorkflowInstances";

export {
  useWorkflowExecutionList,
  type UseWorkflowExecutionListOptions,
  type UseWorkflowExecutionListReturn,
} from "./useWorkflowExecutionList";

// T09: Execution viewer — data hooks
export {
  useWorkflowExecution,
  type UseWorkflowExecutionReturn,
} from "./useWorkflowExecution";

export {
  useWorkflowExecutionEventLog,
  type UseWorkflowExecutionEventLogOptions,
  type UseWorkflowExecutionEventLogReturn,
} from "./useWorkflowExecutionEventLog";

export {
  useWorkflowExecutionArtifacts,
  type UseWorkflowExecutionArtifactsReturn,
} from "./useWorkflowExecutionArtifacts";

// T09: Execution viewer — behavior hooks
export {
  useWorkflowExecutionEventStream,
  type UseWorkflowExecutionEventStreamOptions,
  type UseWorkflowExecutionEventStreamReturn,
} from "./useWorkflowExecutionEventStream";

export {
  useWorkflowExecutionActions,
  type UseWorkflowExecutionActionsOptions,
  type UseWorkflowExecutionActionsReturn,
} from "./useWorkflowExecutionActions";

// T10: YAML editor — behavior hooks
export {
  useWorkflowValidation,
  type UseWorkflowValidationReturn,
} from "./useWorkflowValidation";

export {
  useWorkflowTopology,
  type UseWorkflowTopologyReturn,
  type TopologyNode,
  type TopologyEdge,
  type TopologyNodeCategory,
} from "./useWorkflowTopology";

// T10: YAML editor — styled components
export {
  WorkflowYamlEditor,
  type WorkflowYamlEditorProps,
} from "./WorkflowYamlEditor";

export {
  WorkflowCodePreviewGraph,
  type WorkflowCodePreviewGraphProps,
} from "./WorkflowCodePreviewGraph";

export {
  useWorkflowEditor,
  type UseWorkflowEditorOptions,
  type UseWorkflowEditorReturn,
} from "./useWorkflowEditor";

export {
  WorkflowEditorView,
  type WorkflowEditorViewProps,
  type WorkflowEditorMode,
} from "./WorkflowEditorView";

// T11: Run workflow — behavior hook
export {
  useRunWorkflowFlow,
  type UseRunWorkflowFlowOptions,
  type UseRunWorkflowFlowReturn,
  type RunWorkflowFieldErrors,
} from "./useRunWorkflowFlow";

// T11: Run workflow — instance env key resolution
export {
  useInstanceEnvKeys,
  type UseInstanceEnvKeysReturn,
} from "./useInstanceEnvKeys";

// T11: Run workflow — trigger input detection
export { workflowUsesTriggerInput } from "./workflow-uses-trigger-input";

// T11: Run workflow — styled components
export {
  WorkflowRunForm,
  type WorkflowRunFormProps,
} from "./WorkflowRunForm";

export {
  WorkflowRunDialog,
  type WorkflowRunDialogProps,
} from "./WorkflowRunDialog";

// T08: Workflow styled components
export {
  WorkflowExecutionPhaseBadge,
  type WorkflowExecutionPhaseBadgeProps,
} from "./WorkflowExecutionPhaseBadge";

export {
  WorkflowTaskList,
  type WorkflowTaskListProps,
} from "./WorkflowTaskList";

export { topologyFromTasks } from "./topologyFromTasks";

export {
  WorkflowDetailView,
  type WorkflowDetailViewProps,
} from "./WorkflowDetailView";

// T09: Execution viewer — styled components
export {
  WorkflowExecutionViewer,
  type WorkflowExecutionViewerProps,
} from "./WorkflowExecutionViewer";

export {
  WorkflowExecutionHeader,
  type WorkflowExecutionHeaderProps,
} from "./WorkflowExecutionHeader";

export {
  WorkflowExecutionTimeline,
  type WorkflowExecutionTimelineProps,
} from "./WorkflowExecutionTimeline";

export {
  WorkflowExecutionTaskPanel,
  type WorkflowExecutionTaskPanelProps,
} from "./WorkflowExecutionTaskPanel";

export {
  WorkflowExecutionCostPanel,
  type WorkflowExecutionCostPanelProps,
} from "./WorkflowExecutionCostPanel";

export {
  WorkflowExecutionArtifactPanel,
  type WorkflowExecutionArtifactPanelProps,
} from "./WorkflowExecutionArtifactPanel";

export {
  WorkflowExecutionApprovalCard,
  type WorkflowExecutionApprovalCardProps,
} from "./WorkflowExecutionApprovalCard";

export {
  WorkflowTaskApprovalCard,
  type WorkflowTaskApprovalCardProps,
  type TaskOutcome,
} from "./WorkflowTaskApprovalCard";

export {
  WorkflowTaskApprovalSummary,
  type WorkflowTaskApprovalSummaryProps,
} from "./WorkflowTaskApprovalSummary";

// T14: Dashboard — data hooks
export {
  useWorkflowDashboardSummary,
  type UseWorkflowDashboardSummaryOptions,
  type UseWorkflowDashboardSummaryReturn,
} from "./useWorkflowDashboardSummary";

export {
  usePendingApprovals,
  type UsePendingApprovalsOptions,
  type UsePendingApprovalsReturn,
} from "./usePendingApprovals";

// T14: Dashboard — styled components
export {
  ExecutionSummaryWidget,
  type ExecutionSummaryWidgetProps,
} from "./ExecutionSummaryWidget";

export {
  PendingApprovalsWidget,
  type PendingApprovalsWidgetProps,
} from "./PendingApprovalsWidget";

export {
  FailedRunsWidget,
  type FailedRunsWidgetProps,
} from "./FailedRunsWidget";

export {
  WorkflowDashboard,
  type WorkflowDashboardProps,
} from "./WorkflowDashboard";

// T15: Visual canvas editor — types
export type {
  WorkflowGraphModel,
  WorkflowGraphNode,
  WorkflowGraphEdge,
  WorkflowGraphDocument,
  WorkflowGraphEnvVar,
  WorkflowGraphBudget,
} from "./workflow-graph-model";

export { START_NODE_ID, END_NODE_ID } from "./workflow-graph-model";

// T15: Visual canvas editor — conversion functions
export {
  yamlToGraph,
  graphToYaml,
  graphToWorkflowInput,
} from "./workflow-graph-conversions";

// T15: Visual canvas editor — behavior hook
export {
  useWorkflowCanvas,
  type CanvasSelection,
  type UseWorkflowCanvasOptions,
  type UseWorkflowCanvasReturn,
} from "./useWorkflowCanvas";

// T15: Visual canvas editor — styled components
export {
  WorkflowCanvasEditor,
  type WorkflowCanvasEditorProps,
} from "./WorkflowCanvasEditor";

export {
  WorkflowTaskPalette,
  TASK_KIND_DRAG_MIME,
  type WorkflowTaskPaletteProps,
} from "./WorkflowTaskPalette";

export {
  TaskPickerPopover,
  type TaskPickerPopoverProps,
} from "./TaskPickerPopover";

export {
  CanvasContextMenu,
  type CanvasContextMenuProps,
  type CanvasContextMenuTarget,
} from "./CanvasContextMenu";

export {
  WorkflowInspectorPanel,
  type WorkflowInspectorPanelProps,
} from "./WorkflowInspectorPanel";

// T10: Inspector module — tabbed shell, forms, summary, types
export {
  InspectorShell,
  type InspectorShellProps,
  InspectorHeader,
  type InspectorHeaderProps,
  useInspectorTabs,
  type UseInspectorTabsInput,
  type UseInspectorTabsReturn,
  WorkflowSummaryPanel,
  type WorkflowSummaryPanelProps,
  AgentCallForm,
  type AgentCallFormProps,
  HttpCallForm,
  type HttpCallFormProps,
  ExecutionInspectorAdapter,
  type ExecutionInspectorAdapterProps,
  taskToYaml,
  type InspectorMutations,
  type InspectorNodeIdentity,
  type InspectorMode,
  type DesignTabId,
  type InspectorTabDefinition,
} from "./inspector";

export {
  TaskConfigForm,
  type TaskConfigFormProps,
} from "./TaskConfigForm";

export {
  BranchConditionBuilder,
  type BranchConditionBuilderProps,
} from "./BranchConditionBuilder";

export {
  ApprovalFormBuilder,
  type ApprovalFormBuilderProps,
} from "./ApprovalFormBuilder";

// Dashboard chart components
export {
  CostByWorkflowChart,
  type CostByWorkflowChartProps,
} from "./CostByWorkflowChart";

export {
  ExecutionTrendChart,
  type ExecutionTrendChartProps,
} from "./ExecutionTrendChart";

// Workflow Architect — YAML extraction utility
export {
  extractWorkflowYaml,
  type ExtractedWorkflowYaml,
} from "./extract-workflow-yaml";

// Workflow Architect — behavior hook (replaces T16 generateWorkflowFromPrompt)
export {
  useWorkflowArchitectFlow,
  type ArchitectPhase,
  type UseWorkflowArchitectFlowOptions,
  type UseWorkflowArchitectFlowReturn,
} from "./useWorkflowArchitectFlow";

// Workflow Architect — styled component (replaces T16 WorkflowGenerateDialog)
export {
  WorkflowArchitectDialog,
  type WorkflowArchitectDialogProps,
} from "./WorkflowArchitectDialog";

// Workflow Architect — refine behavior hook (replaces T16 refineWorkflow)
export {
  useRefineWorkflowFlow,
  type RefinePhase,
  type UseRefineWorkflowFlowOptions,
  type UseRefineWorkflowFlowReturn,
} from "./useRefineWorkflowFlow";

// Workflow Architect — refine styled component (replaces T16 WorkflowRefinePanel)
export {
  WorkflowRefinePanel,
  type WorkflowRefinePanelProps,
} from "./WorkflowRefinePanel";

// Workflow diff utility
export {
  computeUnifiedDiff,
  type DiffLine,
  type DiffLineType,
} from "./workflow-yaml-diff";

// Workflow Architect — diagnose behavior hook (replaces T16 diagnoseExecution)
export {
  useDiagnoseExecutionFlow,
  type DiagnosePhase,
  type UseDiagnoseExecutionFlowOptions,
  type UseDiagnoseExecutionFlowReturn,
} from "./useDiagnoseExecutionFlow";

// Workflow Architect — diagnose styled component (replaces T16 WorkflowRepairCard)
export {
  WorkflowRepairCard,
  type WorkflowRepairCardProps,
} from "./WorkflowRepairCard";

// Workflow update — mutation hook + input converter
export {
  useUpdateWorkflow,
  type UseUpdateWorkflowReturn,
} from "./useUpdateWorkflow";

export { workflowToInput } from "./internal/workflowToInput";

// Starter YAML template for new workflow creation
export { STARTER_WORKFLOW_YAML } from "./starter-workflow-yaml";

// Navigation resolution hook
export {
  useResolveAgentExecutionSession,
  type UseResolveAgentExecutionSessionReturn,
} from "./useResolveAgentExecutionSession";

// T01: Canonical kind metadata (replaces triplicated categorizeKind)
export { categorizeKind, kindToDisplayName } from "./kind-metadata";

// T01: Task type visual registry
export {
  getVisualSpec,
  VISUAL_REGISTRY,
  type VisualClass,
  type PortPattern,
  type TaskTypeVisualSpec,
} from "./task-type-visual-registry";

// T03: Layout pipeline
export type {
  LayoutEngine,
  LayoutInput,
  LayoutResult,
  LayoutScope,
  LayoutOptions,
  NodeDimensions,
  Position2D,
  NodePortAssignment,
  PortDefinition,
  PortSide,
  ElkLayoutEngineOptions,
  UseWorkflowLayoutOptions,
  UseWorkflowLayoutReturn,
  UseElkLayoutEngineOptions,
} from "./layout";
export {
  createDagreLayoutEngine,
  createElkLayoutEngine,
  useWorkflowLayout,
  useElkLayoutEngine,
  applyDagreLayout,
  registryNodeDimensions,
  preprocessForElk,
  ELK_WORKFLOW_DEFAULTS,
  computePortAssignments,
  computeNodePorts,
  postprocessElkResult,
} from "./layout";

// T04: Execution graph — mode context
export {
  WorkflowGraphModeProvider,
  useWorkflowGraphMode,
  type WorkflowGraphMode,
  type WorkflowGraphModeProviderProps,
} from "./WorkflowGraphModeContext";

// T04: Execution graph — types
export type {
  NodeExecutionStatus,
  NodeExecutionState,
} from "./workflow-graph-conversions";

// T06: Branch and parallel execution highlighting — pure derivation functions
export {
  deriveEdgeExecutionStates,
  deriveForkProgress,
  type EdgeExecutionState,
  type ForkProgress,
} from "./execution";

// T04: Execution graph — behavior hook
export {
  useWorkflowExecutionGraph,
  type UseWorkflowExecutionGraphOptions,
  type UseWorkflowExecutionGraphReturn,
} from "./useWorkflowExecutionGraph";

// T04: Execution graph — styled component
export {
  WorkflowExecutionGraph,
  type WorkflowExecutionGraphProps,
} from "./WorkflowExecutionGraph";

// T16: Execution visibility and accessibility
export {
  useFollowExecution,
  type FollowState,
  type UseFollowExecutionOptions,
  type UseFollowExecutionReturn,
} from "./useFollowExecution";
export {
  useActiveTaskName,
  type ActiveTaskInfo,
} from "./useActiveTaskName";
export {
  ExecutionActiveTaskIndicator,
  type ExecutionActiveTaskIndicatorProps,
} from "./ExecutionActiveTaskIndicator";
export { useExecutionAnnouncements } from "./useExecutionAnnouncements";
export { getAnimationDuration, prefersReducedMotion } from "./motion-preference";

// T05: Shared formatting utilities
export {
  formatDuration,
  formatDurationSec,
  formatMicroUsd,
  formatTokenCount,
  formatBytes,
  formatTimestamp,
  formatMetaChips,
} from "./format-utils";

// T05: Runtime inspector — behavior hook + types
export {
  useExecutionTaskDetail,
  type UseExecutionTaskDetailReturn,
  type TaskDetail,
  type TaskDetailSummary,
  type TaskDetailIO,
  type TaskDetailError,
  type TaskDetailRetryHistory,
  type TaskDetailRetryAttempt,
  type TaskDetailAgentCall,
  type TaskDetailApproval,
  type TaskDetailApprovalDecision,
} from "./execution-inspector";

// T05: Runtime inspector — styled component
export {
  ExecutionInspector,
  type ExecutionInspectorProps,
} from "./execution-inspector";

// T07: Waterfall timeline — pure derivation + behavior hook
export {
  deriveWaterfallEntries,
  deriveWaterfallScale,
  type WaterfallEntry,
  type WaterfallAttempt,
  type WaterfallSpan,
  type WaterfallScale,
  useWaterfallEntries,
  type UseWaterfallEntriesOptions,
  type UseWaterfallEntriesReturn,
} from "./execution";

// T07: Waterfall timeline — styled components
export {
  WaterfallTimeline,
  type WaterfallTimelineProps,
} from "./waterfall";

// T11: Shortcut registry
export {
  getAllShortcuts,
  getShortcut,
  getShortcutHint,
  isMacPlatform,
  type ShortcutDefinition,
  type ShortcutScope,
} from "./shortcut-registry";

// T11: Internal clipboard
export {
  serializeSelection,
  pasteClipboard,
  type ClipboardEntry,
  type PasteResult,
} from "./clipboard";

// T11: View YAML dialog
export {
  ViewYamlDialog,
  type ViewYamlDialogProps,
} from "./ViewYamlDialog";

// T13: Execution history — derivation, hooks, and components
export {
  deriveExecutionRow,
  deriveExecutionRows,
  sortExecutionRows,
  filterExecutionRows,
  deriveFailureAnalysis,
  useExecutionHistoryData,
  ExecutionHistoryTable,
  ExecutionFilterBar,
  HealthMetricsStrip,
  FailureAnalysisPanel,
  WorkflowExecutionHistory,
  type ExecutionRow,
  type ExecutionSortField as ExecutionHistorySortField,
  type SortDirection as ExecutionHistorySortDirection,
  type ExecutionClientFilters,
  type FailureGroup,
  type FailureInstance,
  type UseExecutionHistoryDataOptions,
  type UseExecutionHistoryDataReturn,
  type ExecutionHistoryTableProps,
  type ExecutionFilterBarProps,
  type HealthMetricsStripProps,
  type FailureAnalysisPanelProps,
  type WorkflowExecutionHistoryProps,
} from "./execution-history";

// T12: Overview page redesign — behavior hook
export {
  useWorkflowOverviewGraph,
  type UseWorkflowOverviewGraphOptions,
  type UseWorkflowOverviewGraphReturn,
} from "./useWorkflowOverviewGraph";

// T12: Overview page redesign — styled components
export {
  WorkflowOverviewGraph,
  type WorkflowOverviewGraphProps,
} from "./WorkflowOverviewGraph";

export {
  WorkflowGraphFullscreenDialog,
  type WorkflowGraphFullscreenDialogProps,
} from "./WorkflowGraphFullscreenDialog";

export {
  WorkflowNodePopover,
  type WorkflowNodePopoverProps,
} from "./WorkflowNodePopover";

export {
  WorkflowOverviewSummary,
  type WorkflowOverviewSummaryProps,
} from "./WorkflowOverviewSummary";

// T14: Visual diff engine — types and pure functions
export type {
  NodeDiffStatus,
  EdgeDiffStatus,
  NodeDiffEntry,
  EdgeDiffEntry,
  GraphDiff,
} from "./diff";
export { computeGraphDiff, buildDiffGraph, jsonEqual } from "./diff";
export { DiffSummaryBar, type DiffSummaryBarProps } from "./diff";

// T14: Visual diff graph — behavior hook
export {
  useWorkflowDiffGraph,
  type UseWorkflowDiffGraphOptions,
  type UseWorkflowDiffGraphReturn,
} from "./useWorkflowDiffGraph";

// T14: Visual diff graph — styled component
export {
  WorkflowDiffGraph,
  type WorkflowDiffGraphProps,
} from "./WorkflowDiffGraph";

// T14: Explain workflow — behavior hook
export {
  useExplainWorkflowFlow,
  type ExplainPhase,
  type UseExplainWorkflowFlowOptions,
  type UseExplainWorkflowFlowReturn,
} from "./useExplainWorkflowFlow";

// T14: Explain workflow — styled component
export {
  WorkflowExplainDialog,
  type WorkflowExplainDialogProps,
} from "./WorkflowExplainDialog";

// Workflow Instance management hooks
export {
  useWorkflowInstance,
  type UseWorkflowInstanceReturn,
  useCreateWorkflowInstance,
  type UseCreateWorkflowInstanceReturn,
  useUpdateWorkflowInstance,
  type UseUpdateWorkflowInstanceReturn,
  useUpdateWorkflowInstanceExecutionVisibility,
  type UseUpdateWorkflowInstanceExecutionVisibilityReturn,
  useDeleteWorkflowInstance,
  type UseDeleteWorkflowInstanceReturn,
  WorkflowInstanceEmptyState,
  type WorkflowInstanceEmptyStateProps,
  WorkflowInstanceList,
  type WorkflowInstanceListProps,
  CreateWorkflowInstanceDialog,
  type CreateWorkflowInstanceDialogProps,
  WorkflowInstanceDetailPanel,
  type WorkflowInstanceDetailPanelProps,
  RunVisibilityControl,
  type RunVisibilityControlProps,
} from "./instance";

// Execution Comparison — run-vs-run comparison
export {
  type TaskComparison,
  type ExecutionComparison,
  deriveExecutionComparison,
  useExecutionComparison,
  type UseExecutionComparisonOptions,
  type UseExecutionComparisonReturn,
  ExecutionComparisonPicker,
  type ExecutionComparisonPickerProps,
  ComparisonSummaryCards,
  type ComparisonSummaryCardsProps,
  TaskComparisonTable,
  type TaskComparisonTableProps,
  ExecutionComparisonView,
  type ExecutionComparisonViewProps,
} from "./execution-comparison";

// DD-003: Workflow versioning — data hooks
export {
  useWorkflowVersions,
  type UseWorkflowVersionsReturn,
} from "./useWorkflowVersions";

export {
  useWorkflowVersion,
  type UseWorkflowVersionReturn,
} from "./useWorkflowVersion";

export {
  useWorkflowVersionDiff,
  type UseWorkflowVersionDiffReturn,
} from "./useWorkflowVersionDiff";

// DD-003: Workflow versioning — styled components
export {
  WorkflowVersionBadge,
  type WorkflowVersionBadgeProps,
} from "./WorkflowVersionBadge";

export {
  WorkflowVersionTimeline,
  type WorkflowVersionTimelineProps,
} from "./WorkflowVersionTimeline";

export {
  WorkflowVersionDiffViewer,
  type WorkflowVersionDiffViewerProps,
} from "./WorkflowVersionDiffViewer";

export {
  WorkflowVersionsTab,
  type WorkflowVersionsTabProps,
} from "./WorkflowVersionsTab";

// T15: Workflow Template Gallery
export {
  type WorkflowTemplateData,
  type WorkflowTemplateCategory,
  type WorkflowTemplateMeta,
  type WorkflowPattern,
  type WorkflowTemplate,
  PATTERN_LABELS,
  WORKFLOW_CATEGORY_LABELS,
  deriveTemplateMeta,
  WorkflowTemplateCard,
  type WorkflowTemplateCardProps,
  WorkflowTemplatePreview,
  type WorkflowTemplatePreviewProps,
  WorkflowTemplateGallery,
  type WorkflowTemplateGalleryProps,
} from "./templates";
