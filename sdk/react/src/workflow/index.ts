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
  WorkflowTopologyGraph,
  type WorkflowTopologyGraphProps,
} from "./WorkflowTopologyGraph";

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
  WorkflowTopologyPreview,
  type WorkflowTopologyPreviewProps,
} from "./WorkflowTopologyPreview";

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
} from "./layout";
export {
  createDagreLayoutEngine,
  createElkLayoutEngine,
  useWorkflowLayout,
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
