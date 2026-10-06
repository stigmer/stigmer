export type {
  TaskKindDescriptor,
  TaskKindCategory,
  TaskFieldDescriptor,
  TaskFieldType,
  TaskFieldGroup,
} from "./types.js";

export {
  serializeWorkflowYaml,
  parseWorkflowYaml,
} from "./serialize-workflow-yaml.js";

export {
  useWorkflowYaml,
  type UseWorkflowYamlReturn,
} from "./useWorkflowYaml.js";

export {
  useWorkflowSave,
  type UseWorkflowSaveReturn,
  type WorkflowSaveOptions,
} from "./useWorkflowSave.js";

export {
  TaskKindRegistryContext,
  type TaskKindRegistryState,
} from "./TaskKindRegistryContext.js";

export {
  useTaskKindRegistry,
  type UseTaskKindRegistryReturn,
} from "./useTaskKindRegistry.js";

export {
  useWorkflow,
  type UseWorkflowReturn,
} from "./useWorkflow.js";

export {
  useWorkflowList,
  type UseWorkflowListOptions,
  type UseWorkflowListReturn,
} from "./useWorkflowList.js";

export {
  useWorkflowCount,
  type UseWorkflowCountOptions,
  type UseWorkflowCountReturn,
} from "./useWorkflowCount.js";

export {
  useWorkflowRunList,
  type UseWorkflowRunListOptions,
  type UseWorkflowRunListReturn,
} from "./useWorkflowRunList.js";

// Run viewer — data hooks
export {
  useWorkflowRun,
  type UseWorkflowRunReturn,
} from "./useWorkflowRun.js";

export {
  useWorkflowRunEventLog,
  type UseWorkflowRunEventLogOptions,
  type UseWorkflowRunEventLogReturn,
} from "./useWorkflowRunEventLog.js";

export {
  useWorkflowRunArtifacts,
  type UseWorkflowRunArtifactsReturn,
} from "./useWorkflowRunArtifacts.js";

// Run viewer — behavior hooks
export {
  useWorkflowRunEventStream,
  type UseWorkflowRunEventStreamOptions,
  type UseWorkflowRunEventStreamReturn,
} from "./useWorkflowRunEventStream.js";

export {
  useWorkflowRunActions,
  type UseWorkflowRunActionsOptions,
  type UseWorkflowRunActionsReturn,
} from "./useWorkflowRunActions.js";

// YAML editor — behavior hooks
export {
  useWorkflowValidation,
  type UseWorkflowValidationReturn,
} from "./useWorkflowValidation.js";

export {
  useWorkflowTopology,
  type UseWorkflowTopologyReturn,
  type TopologyNode,
  type TopologyEdge,
  type TopologyNodeCategory,
} from "./useWorkflowTopology.js";

// YAML editor — styled components
export {
  WorkflowYamlEditor,
  type WorkflowYamlEditorProps,
} from "./WorkflowYamlEditor.js";

export {
  WorkflowCodePreviewGraph,
  type WorkflowCodePreviewGraphProps,
} from "./WorkflowCodePreviewGraph.js";

export {
  useWorkflowEditor,
  type UseWorkflowEditorOptions,
  type UseWorkflowEditorReturn,
} from "./useWorkflowEditor.js";

export {
  WorkflowEditorView,
  type WorkflowEditorViewProps,
  type WorkflowEditorMode,
} from "./WorkflowEditorView.js";

// Run workflow — behavior hook
export {
  useRunWorkflowFlow,
  type UseRunWorkflowFlowOptions,
  type UseRunWorkflowFlowReturn,
  type RunWorkflowFieldErrors,
} from "./useRunWorkflowFlow.js";

// Run workflow — where each declared key's value comes from
export {
  useRunEnvKeySources,
  type RunEnvKeySource,
  type UseRunEnvKeySourcesReturn,
} from "./useRunEnvKeySources.js";

// Run workflow — trigger input detection
export { workflowUsesTriggerInput } from "./workflow-uses-trigger-input.js";

// Run workflow — styled components
export {
  WorkflowRunForm,
  type WorkflowRunFormProps,
} from "./WorkflowRunForm.js";

export {
  WorkflowRunDialog,
  type WorkflowRunDialogProps,
} from "./WorkflowRunDialog.js";

// Workflow styled components
export {
  WorkflowRunPhaseBadge,
  type WorkflowRunPhaseBadgeProps,
} from "./WorkflowRunPhaseBadge.js";

export {
  WorkflowTaskList,
  type WorkflowTaskListProps,
} from "./WorkflowTaskList.js";

export { topologyFromTasks } from "./topologyFromTasks.js";

export {
  WorkflowDetailView,
  type WorkflowDetailViewProps,
} from "./WorkflowDetailView.js";

// Run viewer — styled components
export {
  WorkflowRunViewer,
  type WorkflowRunViewerProps,
  type WorkflowRunPanelMode,
} from "./WorkflowRunViewer.js";

export {
  WorkflowRunHeader,
  type WorkflowRunHeaderProps,
} from "./WorkflowRunHeader.js";

// Run panel — the single WorkspaceSurface-based side panel
// (Artifacts/Changes/Usage facets, virtual document tabs) and its
// controller/assembler hooks.
export {
  useWorkflowRunPanel,
  workflowArtifactTabPath,
  type WorkflowRunPanelController,
  type UseWorkflowRunPanelOptions,
} from "./useWorkflowRunPanel.js";
export {
  useWorkflowRunRailViews,
  type UseWorkflowRunRailViewsOptions,
} from "./useWorkflowRunRailViews.js";
export {
  DIAGNOSIS_DOCUMENT_ENTRY_ID,
  DIAGNOSIS_DOCUMENT_PATH,
} from "./diagnosis-document.js";
export {
  WorkflowArtifactsTab,
  type WorkflowArtifactsTabProps,
} from "./facets/WorkflowArtifactsTab.js";
export {
  WorkflowChangesTab,
  type WorkflowChangesTabProps,
} from "./facets/WorkflowChangesTab.js";
export {
  WorkflowUsageTab,
  type WorkflowUsageTabProps,
} from "./facets/WorkflowUsageTab.js";
export {
  useWorkflowRunFileChanges,
  enumerateAgentCallChildren,
  agentCallChildrenSignature,
  type AgentCallChild,
  type UseWorkflowRunFileChangesOptions,
  type UseWorkflowRunFileChangesReturn,
} from "./useWorkflowRunFileChanges.js";
export {
  WorkflowArtifactDocument,
  type WorkflowArtifactDocumentProps,
} from "./WorkflowArtifactDocument.js";
export {
  WorkflowAgentCallTranscript,
  type WorkflowAgentCallTranscriptProps,
  type WorkflowAgentRunHitl,
} from "./WorkflowAgentCallTranscript.js";
export {
  useWorkflowArtifactDownload,
  type UseWorkflowArtifactDownloadReturn,
} from "./useWorkflowArtifactDownload.js";
export {
  deriveWorkflowArtifactItems,
  type WorkflowArtifactEntry,
} from "./deriveWorkflowArtifactItems.js";
export {
  deriveWorkflowUsageItems,
  type WorkflowUsageItem,
} from "./deriveWorkflowUsageItems.js";

export {
  WorkflowApprovalList,
  type WorkflowApprovalListProps,
  type WorkflowApprovalSubmit,
} from "./WorkflowApprovalList.js";
export {
  WorkflowFileReviewList,
  type WorkflowFileReviewListProps,
  type WorkflowFileDecisionSubmit,
} from "./WorkflowFileReviewList.js";

export {
  WorkflowTaskApprovalCard,
  type WorkflowTaskApprovalCardProps,
  type TaskOutcome,
} from "./WorkflowTaskApprovalCard.js";

// Review payloads (issue #234): custom renderers for human_input gates
export {
  WorkflowTaskReviewGate,
  type WorkflowTaskReviewGateProps,
} from "./WorkflowTaskReviewGate.js";
export {
  ReviewRendererContext,
  useReviewRenderer,
  type ReviewRendererProps,
  type ReviewRenderers,
} from "./ReviewRendererContext.js";
export {
  useReviewPayload,
  type UseReviewPayloadReturn,
} from "./useReviewPayload.js";

export {
  WorkflowTaskApprovalSummary,
  type WorkflowTaskApprovalSummaryProps,
} from "./WorkflowTaskApprovalSummary.js";

// Dashboard — data hooks
export {
  useWorkflowDashboardSummary,
  type UseWorkflowDashboardSummaryOptions,
  type UseWorkflowDashboardSummaryReturn,
} from "./useWorkflowDashboardSummary.js";

export {
  usePendingApprovals,
  type UsePendingApprovalsOptions,
  type UsePendingApprovalsReturn,
} from "./usePendingApprovals.js";

// Dashboard — styled components
export {
  RunSummaryWidget,
  type RunSummaryWidgetProps,
} from "./RunSummaryWidget.js";

export {
  PendingApprovalsWidget,
  type PendingApprovalsWidgetProps,
} from "./PendingApprovalsWidget.js";

export {
  FailedRunsWidget,
  type FailedRunsWidgetProps,
} from "./FailedRunsWidget.js";

export {
  WorkflowDashboard,
  type WorkflowDashboardProps,
} from "./WorkflowDashboard.js";

// Visual canvas editor — types
export type {
  WorkflowGraphModel,
  WorkflowGraphNode,
  WorkflowGraphEdge,
  WorkflowGraphDocument,
  WorkflowGraphEnvVar,
  WorkflowGraphBudget,
} from "./workflow-graph-model.js";

export { START_NODE_ID, END_NODE_ID } from "./workflow-graph-model.js";

// Visual canvas editor — conversion functions
export {
  yamlToGraph,
  graphToYaml,
  graphToWorkflowInput,
} from "./workflow-graph-conversions.js";

// Visual canvas editor — behavior hook
export {
  useWorkflowCanvas,
  type CanvasSelection,
  type UseWorkflowCanvasOptions,
  type UseWorkflowCanvasReturn,
} from "./useWorkflowCanvas.js";

// Visual canvas editor — styled components
export {
  WorkflowCanvasEditor,
  type WorkflowCanvasEditorProps,
} from "./WorkflowCanvasEditor.js";

export {
  WorkflowTaskPalette,
  TASK_KIND_DRAG_MIME,
  type WorkflowTaskPaletteProps,
} from "./WorkflowTaskPalette.js";

export {
  TaskPickerPopover,
  type TaskPickerPopoverProps,
} from "./TaskPickerPopover.js";

export {
  CanvasContextMenu,
  type CanvasContextMenuProps,
  type CanvasContextMenuTarget,
} from "./CanvasContextMenu.js";

export {
  WorkflowInspectorPanel,
  type WorkflowInspectorPanelProps,
} from "./WorkflowInspectorPanel.js";

// Inspector module — tabbed shell, forms, summary, types
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
  taskToYaml,
  type InspectorMutations,
  type InspectorNodeIdentity,
  type InspectorMode,
  type DesignTabId,
  type InspectorTabDefinition,
} from "./inspector/index.js";

export {
  TaskConfigForm,
  type TaskConfigFormProps,
} from "./TaskConfigForm.js";

export {
  BranchConditionBuilder,
  type BranchConditionBuilderProps,
} from "./BranchConditionBuilder.js";

export {
  ApprovalFormBuilder,
  type ApprovalFormBuilderProps,
} from "./ApprovalFormBuilder.js";

// Dashboard chart components
export {
  CostByWorkflowChart,
  type CostByWorkflowChartProps,
} from "./CostByWorkflowChart.js";

export {
  RunTrendChart,
  type RunTrendChartProps,
} from "./RunTrendChart.js";

// Workflow Architect — YAML extraction utility
export {
  extractWorkflowYaml,
  type ExtractedWorkflowYaml,
} from "./extract-workflow-yaml.js";

// Workflow Architect — the agent the AI-assisted actions run against, and
// the probe the entry points render on
export {
  WORKFLOW_ARCHITECT_SLUG,
  workflowArchitectRef,
  useWorkflowArchitect,
  type WorkflowArchitectAvailability,
  type UseWorkflowArchitectReturn,
} from "./workflow-architect.js";

// Workflow Architect — behavior hook (replaces generateWorkflowFromPrompt)
export {
  useWorkflowArchitectFlow,
  type ArchitectPhase,
  type UseWorkflowArchitectFlowOptions,
  type UseWorkflowArchitectFlowReturn,
} from "./useWorkflowArchitectFlow.js";

// Workflow Architect — styled component (replaces WorkflowGenerateDialog)
export {
  WorkflowArchitectDialog,
  type WorkflowArchitectDialogProps,
} from "./WorkflowArchitectDialog.js";

// Workflow Architect — refine behavior hook (replaces refineWorkflow)
export {
  useRefineWorkflowFlow,
  type RefinePhase,
  type UseRefineWorkflowFlowOptions,
  type UseRefineWorkflowFlowReturn,
} from "./useRefineWorkflowFlow.js";

// Workflow Architect — refine styled component (replaces WorkflowRefinePanel)
export {
  WorkflowRefinePanel,
  type WorkflowRefinePanelProps,
} from "./WorkflowRefinePanel.js";

// Workflow diff utility
export {
  computeUnifiedDiff,
  type DiffLine,
  type DiffLineType,
} from "./workflow-yaml-diff.js";

// Workflow Architect — diagnose behavior hook (replaces diagnoseExecution)
export {
  useDiagnoseRunFlow,
  type DiagnosePhase,
  type UseDiagnoseRunFlowOptions,
  type UseDiagnoseRunFlowReturn,
} from "./useDiagnoseRunFlow.js";

// Workflow Architect — diagnose styled component (replaces WorkflowRepairCard)
export {
  WorkflowRepairCard,
  type WorkflowRepairCardProps,
} from "./WorkflowRepairCard.js";

// Workflow update — mutation hook + input converter
export {
  useUpdateWorkflow,
  type UseUpdateWorkflowReturn,
} from "./useUpdateWorkflow.js";

// Starter YAML template for new workflow creation
export { STARTER_WORKFLOW_YAML } from "./starter-workflow-yaml.js";

// Navigation resolution hook
export {
  useResolveAgentRunSession,
  type UseResolveAgentRunSessionReturn,
} from "./useResolveAgentRunSession.js";

// Canonical kind metadata (replaces triplicated categorizeKind)
export { categorizeKind, kindToDisplayName } from "./kind-metadata.js";

// Task type visual registry
export {
  getVisualSpec,
  VISUAL_REGISTRY,
  type VisualClass,
  type PortPattern,
  type TaskTypeVisualSpec,
} from "./task-type-visual-registry.js";

// Layout pipeline
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
} from "./layout/index.js";
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
} from "./layout/index.js";

// Run graph — mode context
export {
  WorkflowGraphModeProvider,
  useWorkflowGraphMode,
  type WorkflowGraphMode,
  type WorkflowGraphModeProviderProps,
} from "./WorkflowGraphModeContext.js";

// Run graph — types
export type {
  NodeExecutionStatus,
  NodeExecutionState,
} from "./workflow-graph-conversions.js";

// Branch and parallel execution highlighting — pure derivation functions
export {
  deriveEdgeExecutionStates,
  deriveForkProgress,
  type EdgeExecutionState,
  type ForkProgress,
} from "./run/index.js";

// Run graph — behavior hook
export {
  useWorkflowRunGraph,
  type UseWorkflowRunGraphOptions,
  type UseWorkflowRunGraphReturn,
} from "./useWorkflowRunGraph.js";

// Run graph — styled component
export {
  WorkflowRunGraph,
  type WorkflowRunGraphProps,
} from "./WorkflowRunGraph.js";

// Run visibility and accessibility
export {
  useFollowRun,
  type FollowState,
  type UseFollowRunOptions,
  type UseFollowRunReturn,
} from "./useFollowRun.js";
export {
  useActiveTaskName,
  type ActiveTaskInfo,
} from "./useActiveTaskName.js";
export {
  RunActiveTaskIndicator,
  type RunActiveTaskIndicatorProps,
} from "./RunActiveTaskIndicator.js";
export { useExecutionAnnouncements } from "./useExecutionAnnouncements.js";
export {
  useApprovalBoundary,
  type ApprovalBoundaryCrossing,
} from "./useApprovalBoundary.js";
export { getAnimationDuration, prefersReducedMotion } from "../internal/motion-preference.js";

// Shared formatting utilities
export {
  formatDuration,
  formatDurationSec,
  formatMicroUsd,
  formatTokenCount,
  formatBytes,
  formatTimestamp,
  formatMetaChips,
} from "./format-utils.js";

// Shared task-detail primitives — the card bodies' I/O ladder and the
// human_input gate's review/decision projections.
export {
  buildIO,
  type TaskDetailIO,
  deriveTaskApprovalRequest,
  deriveTaskApprovalDecision,
  deriveTaskReviewer,
  type TaskApprovalRequestView,
  type TaskDetailApprovalDecision,
  type TaskReviewerActor,
  type TaskReviewerView,
  StructuredDataViewer,
  type StructuredDataViewerProps,
} from "./task-detail/index.js";

// Workflow task thread — pure projection + behavior hook + styled component
export {
  projectThreadItems,
  type WorkflowThreadItem,
  type WorkflowThreadProgress,
  type WorkflowThreadProjection,
} from "./thread/project-thread-items.js";
export {
  threadCardVariant,
  type WorkflowThreadCardVariant,
} from "./thread/thread-presentation.js";
// Session-parity task cards — headless per-kind presentation seam
// (the workflow twin of the session's registerToolPresenter).
export {
  resolveTaskPreview,
  registerTaskPresenter,
  getTaskPresenter,
  defaultDisclosureForKind,
  type WorkflowTaskPresenter,
  type WorkflowTaskPreview,
  type WorkflowTaskDisclosure,
} from "./thread/task-presentation.js";
export { useWorkflowThreadItems } from "./thread/useWorkflowThreadItems.js";
export {
  WorkflowTaskThread,
  type WorkflowTaskThreadProps,
  type WorkflowThreadHitl,
} from "./thread/WorkflowTaskThread.js";

// Shortcut registry
export {
  getAllShortcuts,
  getShortcut,
  getShortcutHint,
  isMacPlatform,
  type ShortcutDefinition,
  type ShortcutScope,
} from "./shortcut-registry.js";

// Internal clipboard
export {
  serializeSelection,
  pasteClipboard,
  type ClipboardEntry,
  type PasteResult,
} from "./clipboard.js";

// View YAML dialog
export {
  ViewYamlDialog,
  type ViewYamlDialogProps,
} from "./ViewYamlDialog.js";

// Run history — derivation, hooks, and components
export {
  deriveRunRow,
  deriveRunRows,
  sortRunRows,
  filterRunRows,
  deriveFailureAnalysis,
  useRunHistoryData,
  RunHistoryTable,
  RunFilterBar,
  HealthMetricsStrip,
  FailureAnalysisPanel,
  WorkflowRunHistory,
  type RunRow,
  type RunSortField as ExecutionHistorySortField,
  type SortDirection as ExecutionHistorySortDirection,
  type RunClientFilters,
  type FailureGroup,
  type FailureInstance,
  type UseRunHistoryDataOptions,
  type UseRunHistoryDataReturn,
  type RunHistoryTableProps,
  type RunFilterBarProps,
  type HealthMetricsStripProps,
  type FailureAnalysisPanelProps,
  type WorkflowRunHistoryProps,
} from "./run-history/index.js";

// Overview page redesign — behavior hook
export {
  useWorkflowOverviewGraph,
  type UseWorkflowOverviewGraphOptions,
  type UseWorkflowOverviewGraphReturn,
} from "./useWorkflowOverviewGraph.js";

// Overview page redesign — styled components
export {
  WorkflowOverviewGraph,
  type WorkflowOverviewGraphProps,
} from "./WorkflowOverviewGraph.js";

export {
  WorkflowGraphFullscreenDialog,
  type WorkflowGraphFullscreenDialogProps,
} from "./WorkflowGraphFullscreenDialog.js";

export {
  WorkflowNodePopover,
  type WorkflowNodePopoverProps,
} from "./WorkflowNodePopover.js";

export {
  WorkflowOverviewSummary,
  type WorkflowOverviewSummaryProps,
} from "./WorkflowOverviewSummary.js";

// Visual diff engine — types and pure functions
export type {
  NodeDiffStatus,
  EdgeDiffStatus,
  NodeDiffEntry,
  EdgeDiffEntry,
  GraphDiff,
} from "./diff/index.js";
export { computeGraphDiff, buildDiffGraph, jsonEqual } from "./diff/index.js";
export { DiffSummaryBar, type DiffSummaryBarProps } from "./diff/index.js";

// Visual diff graph — behavior hook
export {
  useWorkflowDiffGraph,
  type UseWorkflowDiffGraphOptions,
  type UseWorkflowDiffGraphReturn,
} from "./useWorkflowDiffGraph.js";

// Visual diff graph — styled component
export {
  WorkflowDiffGraph,
  type WorkflowDiffGraphProps,
} from "./WorkflowDiffGraph.js";

// Explain workflow — behavior hook
export {
  useExplainWorkflowFlow,
  type ExplainPhase,
  type UseExplainWorkflowFlowOptions,
  type UseExplainWorkflowFlowReturn,
} from "./useExplainWorkflowFlow.js";

// Explain workflow — styled component
export {
  WorkflowExplainDialog,
  type WorkflowExplainDialogProps,
} from "./WorkflowExplainDialog.js";

// Run visibility — who sees every run of a workflow
export {
  useUpdateWorkflowRunVisibility,
  type UseUpdateWorkflowRunVisibilityReturn,
} from "./useUpdateWorkflowRunVisibility.js";
export {
  RunVisibilityControl,
  type RunVisibilityControlProps,
} from "./RunVisibilityControl.js";

// Run Comparison — run-vs-run comparison
export {
  type TaskComparison,
  type RunComparison,
  deriveRunComparison,
  useRunComparison,
  type UseRunComparisonOptions,
  type UseRunComparisonReturn,
  RunComparisonPicker,
  type RunComparisonPickerProps,
  ComparisonSummaryCards,
  type ComparisonSummaryCardsProps,
  TaskComparisonTable,
  type TaskComparisonTableProps,
  RunComparisonView,
  type RunComparisonViewProps,
} from "./run-comparison/index.js";

// Workflow versioning — data hooks
export {
  useWorkflowVersions,
  type UseWorkflowVersionsReturn,
} from "./useWorkflowVersions.js";

export {
  useWorkflowVersion,
  type UseWorkflowVersionReturn,
} from "./useWorkflowVersion.js";

export {
  useWorkflowVersionDiff,
  type UseWorkflowVersionDiffReturn,
} from "./useWorkflowVersionDiff.js";

// Workflow versioning — styled components
export {
  WorkflowVersionBadge,
  type WorkflowVersionBadgeProps,
} from "./WorkflowVersionBadge.js";

export {
  WorkflowVersionTimeline,
  type WorkflowVersionTimelineProps,
} from "./WorkflowVersionTimeline.js";

export {
  WorkflowVersionDiffViewer,
  type WorkflowVersionDiffViewerProps,
} from "./WorkflowVersionDiffViewer.js";

export {
  WorkflowVersionsTab,
  type WorkflowVersionsTabProps,
} from "./WorkflowVersionsTab.js";

// Workflow Template Gallery
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
} from "./templates/index.js";
