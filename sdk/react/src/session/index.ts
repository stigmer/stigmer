export { toProtoExecutionTarget, fromProtoExecutionTarget } from "./execution-target.js";
export type { ExecutionTargetOption } from "./execution-target.js";

export type { RuntimeEnvProvider } from "./runtime-env.js";
export type { SessionAudience } from "./audience.js";

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

export { useSessionArtifacts } from "./useSessionArtifacts.js";
export type {
  SessionArtifactEntry,
  UseSessionArtifactsReturn,
} from "./useSessionArtifacts.js";

export { useSessionWriteBacks } from "./useSessionWriteBacks.js";
export type {
  SessionWriteBackEntry,
  UseSessionWriteBacksReturn,
} from "./useSessionWriteBacks.js";

export { useSessionFileChanges } from "./useSessionFileChanges.js";
export type { UseSessionFileChangesReturn } from "./useSessionFileChanges.js";

export { useSessionUsage } from "./useSessionUsage.js";
export type {
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

// Selection types (for platform builders using SessionInspector directly)
export type { SelectedThreadItem } from "../internal/store/selection-store.js";

// SessionInspector — tabbed right-side inspector panel
export {
  SessionInspector,
  useSessionInspector,
  buildVisibleTabs,
  SetupTab,
} from "./inspector/index.js";
export type {
  SessionInspectorProps,
  SessionInspectorTabId,
  UseSessionInspectorOptions,
  UseSessionInspectorReturn,
  SetupTabProps,
  SetupTabMutationCallbacks,
} from "./inspector/index.js";

// Session utilities (re-exported from @stigmer/sdk)
export { PENDING_SUBJECT, resolvedSubject } from "@stigmer/sdk";
