export { toProtoExecutionTarget, fromProtoExecutionTarget } from "./execution-target.js";
export type { ExecutionTargetOption } from "./execution-target.js";

export type { RuntimeEnvProvider } from "./runtime-env.js";
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

export { useUpdateSession } from "./useUpdateSession.js";
export type { UseUpdateSessionReturn } from "./useUpdateSession.js";

export { useSession } from "./useSession.js";
export type { UseSessionReturn } from "./useSession.js";

export { useSessionList } from "./useSessionList.js";
export type {
  UseSessionListOptions,
  UseSessionListReturn,
} from "./useSessionList.js";

export { useSessionExecutions } from "./useSessionExecutions.js";
export type { UseSessionExecutionsReturn } from "./useSessionExecutions.js";

export { useSessionConversation } from "./useSessionConversation.js";
export type {
  SendFollowUpOptions,
  UseSessionConversationReturn,
} from "./useSessionConversation.js";

export { useExportTranscript } from "./useExportTranscript.js";
export type {
  UseExportTranscriptOptions,
  UseExportTranscriptReturn,
} from "./useExportTranscript.js";

export { TranscriptExportMenu } from "./TranscriptExportMenu.js";
export type { TranscriptExportMenuProps } from "./TranscriptExportMenu.js";

export { useSessionArtifacts, artifactKey } from "./useSessionArtifacts.js";
export type {
  SessionArtifactEntry,
  UseSessionArtifactsReturn,
} from "./useSessionArtifacts.js";

export { useSessionWriteBacks } from "./useSessionWriteBacks.js";
export type {
  SessionWriteBackEntry,
  UseSessionWriteBacksReturn,
} from "./useSessionWriteBacks.js";

export { useWorkspaceReadRefs } from "./useWorkspaceReadRefs.js";

export { useSessionFileChanges } from "./useSessionFileChanges.js";
export type { UseSessionFileChangesReturn } from "./useSessionFileChanges.js";

export { useSessionUsage } from "./useSessionUsage.js";
export type {
  ExecutionUsageEntry,
  ModelCostEntry,
  UseSessionUsageReturn,
} from "./useSessionUsage.js";

export { useAgentRefFromSession } from "./useAgentRefFromSession.js";
export type { UseAgentRefFromSessionReturn } from "./useAgentRefFromSession.js";

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

export { useEditSessionPrep } from "./useEditSessionPrep.js";
export type { UseEditSessionPrepReturn } from "./useEditSessionPrep.js";

export {
  CREATOR_AGENTS,
  parseDraftType,
  parseDraftParams,
} from "./draft.js";
export type {
  DraftResourceType,
  DraftParams,
} from "./draft.js";

export { groupSessionsByTime, groupSearchResultsByTime } from "./group-sessions.js";
export type { SessionGroup, SearchResultGroup } from "./group-sessions.js";

export { useSessionSearch } from "./useSessionSearch.js";
export type {
  UseSessionSearchOptions,
  UseSessionSearchReturn,
} from "./useSessionSearch.js";

// SessionViewer — full-featured session viewer organism
export { SessionViewer } from "./SessionViewer.js";
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
// Artifacts / Usage) as the panel's rail, with the console's own labels,
// icons, badges, and contextual-visibility rules. Exported so custom
// session surfaces inherit the rail by construction instead of
// re-declaring it.
export { useSessionRailViews } from "./useSessionRailViews.js";
export type { UseSessionRailViewsOptions } from "./useSessionRailViews.js";

// Plan draft — viewer-owned in-place edit of the session's current plan
// (edit-as-input; the published plan.md artifact is never mutated).
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

// Artifact document tab identity — promoted to execution/ (shared with the
// workflow panel); re-exported here so `@stigmer/react`'s public export and
// existing session-path importers are unchanged.
export { ARTIFACT_DOCUMENT_ENTRY_ID } from "../execution/artifact-document.js";

// Session facet components — the panel's rail views (Config et al.), also
// independently importable (DD-003).
export { SetupTab } from "./facets/index.js";
export type {
  SetupTabProps,
  SetupTabMutationCallbacks,
  SetupTabAutoApprove,
} from "./facets/index.js";

// Session utilities (re-exported from @stigmer/sdk)
export { PENDING_SUBJECT, resolvedSubject } from "@stigmer/sdk";
