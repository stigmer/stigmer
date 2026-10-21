export { useCreateRun } from "./useCreateRun.js";
export type {
  BootstrapSessionSpec,
  CreateRunInput,
  CreateRunResult,
  SharedRunFields,
  UseCreateRunReturn,
} from "./useCreateRun.js";

export { isTerminalPhase, runPhaseOf } from "./run-phases.js";

export { useLiveRun } from "./useLiveRun.js";
export type {
  UseLiveRunOptions,
  UseLiveRunReturn,
} from "./useLiveRun.js";

export { useRunActions } from "./useRunActions.js";
export type {
  UseRunActionsOptions,
  UseRunActionsReturn,
} from "./useRunActions.js";

export { useResolveRunSession } from "./useResolveRunSession.js";
export type { UseResolveRunSessionReturn } from "./useResolveRunSession.js";

export { UsageWidget, formatTokenCount } from "./UsageWidget.js";
export type { UsageWidgetProps } from "./UsageWidget.js";

export { SummarizationCard } from "./SummarizationCard.js";
export type { SummarizationCardProps } from "./SummarizationCard.js";
export { RecalledMemoriesCard, resolveInjectedFacts } from "./RecalledMemoriesCard.js";
export type { RecalledMemoriesCardProps } from "./RecalledMemoriesCard.js";

export { PlanCompletionCard } from "./PlanCompletionCard.js";
export type { PlanCompletionCardProps } from "./PlanCompletionCard.js";

export { PlanFileCard } from "./PlanFileCard.js";
export type { PlanFileCardProps } from "./PlanFileCard.js";

export { PlanStreamingCard } from "./PlanStreamingCard.js";
export type { PlanStreamingCardProps } from "./PlanStreamingCard.js";

export { PlanDocumentMessage } from "./PlanDocumentMessage.js";
export type { PlanDocumentMessageProps } from "./PlanDocumentMessage.js";


export { useArtifactContent } from "./useArtifactContent.js";
export type { UseArtifactContentReturn } from "./useArtifactContent.js";


export { useArtifactDownloadUrl } from "./useArtifactDownloadUrl.js";
export type {
  UseArtifactDownloadUrlReturn,
  UseArtifactDownloadUrlOptions,
} from "./useArtifactDownloadUrl.js";

export { useArtifactDownload } from "./useArtifactDownload.js";
export type { UseArtifactDownloadReturn } from "./useArtifactDownload.js";

export { useArtifactCopy } from "./useArtifactCopy.js";
export type { UseArtifactCopyReturn } from "./useArtifactCopy.js";

export { useToolOutputContent } from "./useToolOutputContent.js";
export type {
  UseToolOutputContentReturn,
  ToolOutputRefLike,
} from "./useToolOutputContent.js";

export { useFileChangeContent, runIdFromStorageKey } from "./useFileChangeContent.js";
export type { UseFileChangeContentReturn } from "./useFileChangeContent.js";

export { useWorkspaceWriteBacks } from "./useWorkspaceWriteBacks.js";
export type { UseWorkspaceWriteBacksReturn } from "./useWorkspaceWriteBacks.js";

export { WriteBackCard } from "./WriteBackCard.js";
export type { WriteBackCardProps } from "./WriteBackCard.js";

export {
  parseDiffStatSummary,
  trailingDiffStatLine,
  writeBackDisplayName,
} from "./write-back-utils.js";
export type { DiffStatSummary } from "./write-back-utils.js";

export { FileChangesView, FileChangeDiff } from "./FileChangesView.js";
export type { FileChangesViewProps, FileChangeDiffProps } from "./FileChangesView.js";

export {
  deriveRunFileChanges,
  toFileDiffEntry,
} from "./deriveRunFileChanges.js";

export { EmptyChangeNotice } from "./EmptyChangeNotice.js";
export type { EmptyChangeNoticeProps, EmptyChangeKind } from "./EmptyChangeNotice.js";

export {
  isTextFile,
  getFileExtension,
  getTextRenderMode,
} from "./text-content.js";
export type { TextRenderMode } from "./text-content.js";

export { RunPhaseBadge } from "./RunPhaseBadge.js";
export type { RunPhaseBadgeProps } from "./RunPhaseBadge.js";

export { InteractionModeBadge } from "./InteractionModeBadge.js";
export type { InteractionModeBadgeProps } from "./InteractionModeBadge.js";

export { SetupProgress } from "./SetupProgress.js";
export type { SetupProgressProps } from "./SetupProgress.js";

export { LivenessStatusLine } from "./LivenessStatusLine.js";
export type { LivenessStatusLineProps } from "./LivenessStatusLine.js";

export { ToolCallGroup } from "./ToolCallGroup.js";
export type { ToolCallGroupProps } from "./ToolCallGroup.js";

export { ToolRunGroup } from "./ToolRunGroup.js";
export type { ToolRunGroupProps } from "./ToolRunGroup.js";

export { segmentToolCalls } from "./segment-tool-calls.js";
export type { ToolSegment } from "./segment-tool-calls.js";

export { ToolCallDetail, formatDuration } from "./ToolCallDetail.js";
export type { ToolCallDetailProps } from "./ToolCallDetail.js";

export { describeApprovalPolicySource } from "./approval-provenance.js";

export { McpToolDetail, McpArgsView, McpMetadataRow, parseMcpResult } from "./McpToolDetail.js";
export type {
  McpToolDetailProps,
  McpArgsViewProps,
  McpMetadataRowProps,
} from "./McpToolDetail.js";

export { ToolArgsView } from "./ToolArgsView.js";
export type { ToolArgsViewProps } from "./ToolArgsView.js";

export { ResultView, summarizeResultView } from "./ResultView.js";
export type { ResultViewProps } from "./ResultView.js";

export { TerminalSession, TerminalTail } from "./TerminalSession.js";
export type { TerminalSessionProps, TerminalTailProps } from "./TerminalSession.js";

export {
  useToolPresentation,
  registerToolPresenter,
  getToolPresenter,
} from "./tool-presenter.js";
export type { ToolPresentation, ToolPresenter } from "./tool-presenter.js";

export {
  CollapsibleCode,
  CollapsiblePre,
  CollapsibleJsonBlock,
  FilePathIcon,
  McpServerIcon,
  TRUNCATION_LINE_LIMIT,
  formatJson,
  formatResult,
  isScalar,
  humanizeArgKey,
} from "./tool-rendering-primitives.js";
export type {
  CollapsibleCodeProps,
  CollapsiblePreProps,
  CollapsibleJsonBlockProps,
} from "./tool-rendering-primitives.js";

export { ToolCallItem } from "./ToolCallItem.js";
export type { ToolCallItemProps } from "./ToolCallItem.js";

export { SubagentSection, subagentSubjectOf } from "./SubagentSection.js";
export type { SubagentSectionProps } from "./SubagentSection.js";

export { MessageEntry } from "./MessageEntry.js";
export type { MessageEntryProps, ThreadMessage, UserMessageItem } from "./MessageEntry.js";

export { MessageFiles, messageFileViews } from "./MessageFiles.js";
export type {
  MessageFilesProps,
  MessageFileView,
} from "./MessageFiles.js";

export { MessageThread } from "./MessageThread.js";
export type {
  MessageThreadProps,
  MessageThreadSlots,
  ThreadContentColumn,
} from "./MessageThread.js";

export { RunErrorNotice } from "./RunErrorNotice.js";
export type { RunErrorNoticeProps } from "./RunErrorNotice.js";

export { ThreadSkeleton } from "./ThreadSkeleton.js";
export type { ThreadSkeletonProps } from "./ThreadSkeleton.js";

export { FollowUpInput } from "./FollowUpInput.js";
export type { FollowUpInputProps } from "./FollowUpInput.js";

export { RunProgress } from "./RunProgress.js";
export type { RunProgressProps } from "./RunProgress.js";

export {
  TodoList,
  TodoRow,
  TodoInProgressIcon,
  findActiveTodo,
  todoCompletionSummary,
} from "./TodoList.js";
export type { TodoListProps, TodoRowProps } from "./TodoList.js";

export { TodoCard } from "./TodoCard.js";
export type { TodoCardProps } from "./TodoCard.js";


export { useAnswerToolUse } from "./useAnswerToolUse.js";
export type { UseAnswerToolUseReturn, ToolUseAnswer } from "./useAnswerToolUse.js";

export { useReviewFileChanges, fileDecisionKey } from "./useReviewFileChanges.js";
export type {
  UseReviewFileChangesReturn,
  ReviewFileChangesOptions,
  FileReviewAction,
} from "./useReviewFileChanges.js";

export { useChangeSetCapture } from "./useChangeSetCapture.js";
export type { UseChangeSetCaptureReturn } from "./useChangeSetCapture.js";

export {
  fileReviewability,
  changeSetReviewability,
  fileForRowPath,
  changeForRowPath,
  fileReviewRowState,
  fileReviewRowChange,
  fileChangeKindOf,
} from "./file-review-status.js";
export type {
  FileReviewability,
  FileBlockReason,
  ChangeSetReviewability,
  FileReviewRowState,
} from "./file-review-status.js";

// The run's file record (its captured change sets) and the display
// projection of one captured file, re-exported from @stigmer/client (pure,
// shared). What was decided about the files is the session's events.
export {
  displayFileChangeSets,
  fileChangeSetOf,
  toDisplayFileChange,
  type DisplayFileChange,
  type DisplayFileChangeType,
} from "@stigmer/client";

export { ApprovalCard, ApprovalCardHeader, ApprovalCardBody } from "./ApprovalCard.js";
export type {
  ApprovalCardProps,
  ApprovalCardHeaderProps,
  ApprovalCardBodyProps,
} from "./ApprovalCard.js";

export { FileReviewCard } from "./FileReviewCard.js";
export type { FileReviewCardProps } from "./FileReviewCard.js";

export { FileReviewDock } from "./FileReviewDock.js";
export type { FileReviewDockProps } from "./FileReviewDock.js";

export { FileChangeProgressBar } from "./FileChangeProgressBar.js";
export type { FileChangeProgressBarProps } from "./FileChangeProgressBar.js";

export { ApprovalContext, useApproval } from "./ApprovalContext.js";
export type { ApprovalContextValue, UseApprovalResult } from "./ApprovalContext.js";

export {
  FileReviewContext,
  useFileReviewRowState,
  useFileReviewRowChange,
} from "./FileReviewContext.js";
export type { FileReviewContextValue } from "./FileReviewContext.js";

export { FileRow } from "./FileRow.js";
export type { FileRowProps } from "./FileRow.js";

export { FileRowView } from "./FileRowView.js";
export type { FileRowViewProps } from "./FileRowView.js";

export { fromFile } from "./file-row-item.js";
export type { FileRowItem } from "./file-row-item.js";

export { FILE_DOCUMENT_ENTRY_ID } from "./file-document.js";

export { TextContentRenderer } from "./TextContentRenderer.js";
export type { TextContentRendererProps } from "./TextContentRenderer.js";

export { TextContentView } from "./TextContentView.js";
export type { TextContentViewProps } from "./TextContentView.js";

export { FileBody, isImageFile } from "./FileBody.js";
export { FileDeleteAction, FileAddAsSkillAction, isZipFile } from "./FileActions.js";
export type { FileDeleteActionProps, FileAddAsSkillActionProps } from "./FileActions.js";
export type { FileBodyProps } from "./FileBody.js";

export { FileDocument } from "./FileDocument.js";
export type { FileDocumentProps } from "./FileDocument.js";

export { useFileInspection } from "./useFileInspection.js";
export type {
  FileInspection,
  UseFileInspectionOptions,
} from "./useFileInspection.js";

export { FilePreviewContent, FilePreviewModal } from "./FilePreviewModal.js";
export type { FilePreviewContentProps, FilePreviewModalProps } from "./FilePreviewModal.js";


export { WriteBacksWidget } from "./WriteBacksWidget.js";
export type { WriteBacksWidgetProps } from "./WriteBacksWidget.js";

export {
  resolveToolCategory,
  resolveToolCategoryFromCall,
  resolveToolCategoryFromKind,
  toolKindToCategoryInfo,
  extractPrimaryArg,
  extractPrimaryArgFromPreview,
  extractShellIntent,
  extractShellIntentFromPreview,
  SHELL_INTENT_ARG_FIELD,
  humanizeToolName,
  defaultDisclosureForCategory,
  isRunGroupableCategory,
} from "./tool-categories.js";
export type { ToolCategory, ToolCategoryInfo, ToolDisclosure } from "./tool-categories.js";

export { FilePathLink } from "./FilePathLink.js";
export type { FilePathLinkProps } from "./FilePathLink.js";

export { FilePathContext } from "./FilePathContext.js";
export type { FilePathContextValue } from "./FilePathContext.js";

export { normalizeSandboxPaths } from "./sandbox-path-normalizer.js";
export { SandboxContext, useSandboxNormalize } from "./SandboxContext.js";
export type { SandboxContextValue } from "./SandboxContext.js";

export { classifyPath, resolveGitBrowseUrl, resolvePathAction } from "./file-path-resolver.js";
export type { PathClassification, ResolvedPathAction } from "./file-path-resolver.js";
