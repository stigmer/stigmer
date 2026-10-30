export { toProtoExecutionTarget, fromProtoExecutionTarget } from "@stigmer/react-core/internal";
export type { ExecutionTargetOption } from "@stigmer/react-core";

export type { SessionAudience, SessionPanelMode } from "./audience.js";
export type { SessionRunConfig } from "./run-config.js";
export {
  CHANNEL_SESSION_LABELS,
  isChannelOriginSession,
  channelSessionExternalUserKey,
} from "./channelOrigin.js";

export { useCreateSession } from "./useCreateSession.js";
export type {
  SharedSessionFields,
  CreateSessionInput,
  CreateSessionResult,
  UseCreateSessionReturn,
} from "./useCreateSession.js";

export { useUpdateSession } from "@stigmer/react-core";
export type { UseUpdateSessionReturn } from "@stigmer/react-core";

export { useSession } from "@stigmer/react-core";
export type { UseSessionReturn } from "@stigmer/react-core";

export { useSessionList } from "@stigmer/react-core";
export type { UseSessionListOptions, UseSessionListReturn } from "@stigmer/react-core";

export { useSessionRuns } from "@stigmer/react-core";
export type { UseSessionRunsReturn } from "@stigmer/react-core";

export { useAttentionNotifications, noticeOf } from "./useAttentionNotifications.js";
export type {
  AttentionNotice,
  AttentionReason,
  UseAttentionNotificationsOptions,
} from "./useAttentionNotifications.js";
export {
  useAttentionNotificationsSetting,
  ATTENTION_NOTIFICATIONS_KEY,
} from "./attentionNotificationsSetting.js";
export type { AttentionNotificationsSetting } from "./attentionNotificationsSetting.js";

export { useSessionEvents } from "@stigmer/react-core";
export type { UseSessionEventsOptions, UseSessionEventsReturn } from "@stigmer/react-core";

export { useSessionConversation } from "@stigmer/react-core";
export type { SendFollowUpOptions, UseSessionConversationReturn } from "@stigmer/react-core";

export { useSessionAccess } from "./useSessionAccess.js";
export type { UseSessionAccessReturn } from "./useSessionAccess.js";

export { useExportTranscript } from "./useExportTranscript.js";
export type {
  UseExportTranscriptOptions,
  UseExportTranscriptReturn,
} from "./useExportTranscript.js";

export { TranscriptExportMenu } from "./TranscriptExportMenu.js";
export type { TranscriptExportMenuProps } from "./TranscriptExportMenu.js";

export { useSessionOutputs, outputKey } from "./useSessionOutputs.js";
export type {
  SessionOutputEntry,
  UseSessionOutputsReturn,
} from "./useSessionOutputs.js";

export { useSessionGivenFiles, givenKey, UPLOADS_FOLDER } from "./useSessionGivenFiles.js";
export type {
  SessionGivenEntry,
  UseSessionGivenFilesReturn,
} from "./useSessionGivenFiles.js";

export { useSessionWriteBacks } from "./useSessionWriteBacks.js";
export type {
  SessionWriteBackEntry,
  UseSessionWriteBacksReturn,
} from "./useSessionWriteBacks.js";

export { useWorkspaceReadRefs } from "./useWorkspaceReadRefs.js";

export { useSessionFileChanges } from "./useSessionFileChanges.js";
export type { UseSessionFileChangesReturn } from "./useSessionFileChanges.js";

export { useSessionUsage } from "@stigmer/react-core";
export type {
  RunUsageEntry,
  ModelUsageEntry,
  ServedByEntry,
  UseSessionUsageReturn,
} from "@stigmer/react-core";

export { agentRefOfSession, isSameAgent } from "./agentRefOfSession.js";

export { useSessionAgentVersion } from "./useSessionAgentVersion.js";
export type {
  UseSessionAgentVersionOptions,
  UseSessionAgentVersionReturn,
} from "./useSessionAgentVersion.js";

export { AgentVersionNotice } from "./AgentVersionNotice.js";
export type { AgentVersionNoticeProps } from "./AgentVersionNotice.js";

export { useNewSessionFlow } from "./useNewSessionFlow.js";
export type {
  UseNewSessionFlowOptions,
  UseNewSessionFlowReturn,
} from "./useNewSessionFlow.js";

export { useSessionPageFlow } from "./useSessionPageFlow.js";
export type {
  UseSessionPageFlowOptions,
  UseSessionPageFlowReturn,
} from "./useSessionPageFlow.js";

export { usePersistedModel } from "./usePersistedModel.js";
export type { UsePersistedModelReturn, UsePersistedModelOptions } from "./usePersistedModel.js";

export { groupSessionsByTime, groupSearchResultsByTime } from "./group-sessions.js";
export type { SessionGroup, SearchResultGroup } from "./group-sessions.js";

export { useSessionSearch } from "./useSessionSearch.js";
export type {
  UseSessionSearchOptions,
  UseSessionSearchReturn,
} from "./useSessionSearch.js";

// SessionViewer — full-featured session viewer organism
export { SessionViewer } from "./SessionViewer.js";
export { SessionInspector } from "./inspector/SessionInspector.js";
export type { SessionInspectorProps } from "./inspector/SessionInspector.js";
export type { SessionViewerProps } from "./SessionViewer.js";

// NewSessionViewer — launcher organism with progressive Setup panel
export { NewSessionViewer } from "./NewSessionViewer.js";
export type { NewSessionViewerProps } from "./NewSessionViewer.js";

// SessionViewerLayout — the conversation-plus-panel frame both viewers
// share, exported for platform builders composing a custom session surface
// at the shipped console's geometry.
export { SessionViewerLayout } from "./SessionViewerLayout.js";
export type { SessionViewerLayoutProps } from "./SessionViewerLayout.js";

// Unified session-panel controller — drives the WorkspaceSurface open-editor
// group, the collapsed/open state, and the rail-view FSM (for platform
// builders embedding the surface directly).
export { useSessionPanel } from "./useSessionPanel.js";
export type {
  SessionPanelController,
  UseSessionPanelOptions,
} from "./useSessionPanel.js";

// Session rail views — composes the session facets (Config / Changes /
// Files / Usage) as the panel's rail, with the console's own labels,
// icons, badges, and contextual-visibility rules. Exported so custom
// session surfaces inherit the rail by construction instead of
// re-declaring it.
export { useSessionRailViews, CONVERSATION_FILES_VIEW_ID } from "./useSessionRailViews.js";
export type { UseSessionRailViewsOptions } from "./useSessionRailViews.js";

// Plan draft — viewer-owned in-place edit of the session's current plan
// (edit-as-input; the plan File the turn returned is never mutated).
export { usePlanDraft, planDraftKey } from "./usePlanDraft.js";
export type { PlanDraftController } from "./usePlanDraft.js";

// Plan document — the editor-area plan surface (mounted as a virtual document
// in the workspace surface) and the identity of its tab.
export { PlanEditor } from "./PlanEditor.js";
export type { PlanEditorProps } from "./PlanEditor.js";
export { PlanStreamingDocument } from "./PlanStreamingDocument.js";
export type { PlanStreamingDocumentProps } from "./PlanStreamingDocument.js";
export {
  PLAN_DOCUMENT_ENTRY_ID,
  PLAN_DOCUMENT_PATH,
} from "./plan-document.js";

// File document tab identity — lives in run/; re-exported here so
// session-path importers reach it beside the plan document identity.
export { FILE_DOCUMENT_ENTRY_ID } from "../run/file-document.js";

// Session facet components — the panel's rail views (Config et al.), also
// independently importable.
export { SetupTab } from "./facets/index.js";
export type {
  SetupTabProps,
  SetupTabMutationCallbacks,
  SetupTabAutoApprove,
} from "./facets/index.js";

// Session utilities (re-exported from @stigmer/client)
export {
  BUILT_IN_ASSISTANT_NAME,
  PENDING_SUBJECT,
  isBuiltInAssistant,
  resolvedSubject,
} from "@stigmer/client";
