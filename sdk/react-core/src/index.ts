// @stigmer/react-core — the conversation layer of Stigmer's React kits: the
// client context, the fetch cache, and the session, run and file-review
// hooks, with nothing that draws. A chat that does not render HTML (a
// terminal, a native app) builds on this package alone; the React kit
// (@stigmer/react-sdk) builds its components over it and re-exports every
// name here from its root and ./headless, so a host that already imports
// those entries changes nothing.
//
// Its peers are react, @stigmer/client, @stigmer/apis and
// @bufbuild/protobuf; it depends on no rendering package (react-dom, a
// component library, an icon set), and its value imports are closed over
// that list (sdk/react-core/src/__tests__/boundary.test.ts).
//
// Entries:
//   - "@stigmer/react-core": this file, the public surface;
//   - "@stigmer/react-core/test": sample data for tests and galleries;
//   - "@stigmer/react-core/internal": the React kit's own plumbing, with no
//     compatibility promise (./internal.ts).

export { useAgentSearch } from "./agent/useAgentSearch.js";
export type { UseAgentSearchOptions, UseAgentSearchReturn } from "./agent/useAgentSearch.js";
export type { InteractionModeOption } from "./composer/interaction-mode.js";
export { StigmerContext } from "./context.js";
export { DeploymentModeContext, useDeploymentMode, useResourceAvailable } from "./deployment-mode.js";
export { useWhoAmI } from "./grant/useWhoAmI.js";
export type { UseWhoAmIOptions, UseWhoAmIReturn } from "./grant/useWhoAmI.js";
export { useStigmer } from "./hooks.js";
export { FetchCacheProvider } from "./internal/FetchCacheProvider.js";
export type { FetchCacheOptions } from "./internal/fetch-cache.js";
export { DEFAULT_HARNESS, fromProtoHarness, toProtoHarness } from "./models/harness.js";
export type { HarnessOption } from "./models/harness.js";
export {
  DEFAULT_MODEL_ID,
  DISABLED_PROVIDERS,
  fetchModelRegistry,
  fetchModelRegistryDocument,
  modelKey,
  parseModelKey,
  parseRegistryDocument,
  parseRegistryJson,
} from "./models/registry.js";
export type {
  CostTier,
  ModelInfo,
  ModelRegistryDocument,
  ParsedModelKey,
  Provider,
  VisionLimits,
} from "./models/registry.js";
export { thinkingLocked, thinkingSelectable } from "./models/thinking-mode.js";
export type { ThreadMessage, UserMessageItem } from "./run/thread-message.js";
export { FileReviewContext, useFileReviewRowChange, useFileReviewRowState } from "./run/FileReviewContext.js";
export type { FileReviewContextValue } from "./run/FileReviewContext.js";
export {
  changeForRowPath,
  changeSetReviewability,
  fileChangeKindOf,
  fileForRowPath,
  fileReviewRowChange,
  fileReviewRowState,
  fileReviewability,
} from "./run/file-review-status.js";
export type {
  ChangeSetReviewability,
  FileBlockReason,
  FileReviewRowState,
  FileReviewability,
} from "./run/file-review-status.js";
export { runPhaseOf } from "./run/run-phases.js";
export {
  defaultDisclosureForCategory,
  extractPrimaryArg,
  extractShellIntentFromPreview,
  humanizeToolName,
  resolveToolCategory,
  resolveToolCategoryFromCall,
  resolveToolCategoryFromKind,
  subagentSubjectOf,
  toolKindToCategoryInfo,
} from "./run/tool-categories.js";
export type { ToolDisclosure } from "./run/tool-categories.js";
export { useAnswerToolUse } from "./run/useAnswerToolUse.js";
export type { ToolUseAnswer, UseAnswerToolUseReturn } from "./run/useAnswerToolUse.js";
export { useArtifactContent } from "./run/useArtifactContent.js";
export type { UseArtifactContentReturn } from "./run/useArtifactContent.js";
export { useArtifactDownloadUrl } from "./run/useArtifactDownloadUrl.js";
export type { UseArtifactDownloadUrlOptions, UseArtifactDownloadUrlReturn } from "./run/useArtifactDownloadUrl.js";
export { useCreateRun } from "./run/useCreateRun.js";
export type {
  BootstrapSessionSpec,
  CreateRunInput,
  CreateRunResult,
  SharedRunFields,
  UseCreateRunReturn,
} from "./run/useCreateRun.js";
export { useFileChangeContent } from "./run/useFileChangeContent.js";
export type { UseFileChangeContentReturn } from "./run/useFileChangeContent.js";
export { fileDecisionKey, useReviewFileChanges } from "./run/useReviewFileChanges.js";
export type { FileReviewAction, ReviewFileChangesOptions, UseReviewFileChangesReturn } from "./run/useReviewFileChanges.js";
export { useRunActions } from "./run/useRunActions.js";
export type { UseRunActionsOptions, UseRunActionsReturn } from "./run/useRunActions.js";
export { useStopBackgroundCommand } from "./run/useStopBackgroundCommand.js";
export type { UseStopBackgroundCommandReturn } from "./run/useStopBackgroundCommand.js";
export { useRunnerAdapter } from "./runner-adapter.js";
export type { RunnerAdapter } from "./runner-adapter.js";
export { createLibraryListFn } from "./search/librarySource.js";
export type { LibraryClient, LibraryKind } from "./search/librarySource.js";
export type { UseResourceSearchOptions, UseResourceSearchReturn } from "./search/useResourceSearch.js";
export type { WorkbenchListFn, WorkbenchPage, WorkbenchPageRequest } from "./resource-workbench/workbench-page.js";
export type { ExecutionTargetOption } from "./session/execution-target.js";
export { useSession } from "./session/useSession.js";
export type { UseSessionReturn } from "./session/useSession.js";
export { useSessionConversation } from "./session/useSessionConversation.js";
export type { SendFollowUpOptions, UseSessionConversationReturn } from "./session/useSessionConversation.js";
export { useSessionEvents } from "./session/useSessionEvents.js";
export type { UseSessionEventsOptions, UseSessionEventsReturn } from "./session/useSessionEvents.js";
export { useSessionList } from "./session/useSessionList.js";
export type { UseSessionListOptions, UseSessionListReturn } from "./session/useSessionList.js";
export { useSessionRuns } from "./session/useSessionRuns.js";
export type { UseSessionRunsReturn } from "./session/useSessionRuns.js";
export { useSessionUsage } from "./session/useSessionUsage.js";
export type {
  ModelUsageEntry,
  RunUsageEntry,
  ServedByEntry,
  UseSessionUsageReturn,
} from "./session/useSessionUsage.js";
export { useUpdateSession } from "./session/useUpdateSession.js";
export type { UseUpdateSessionReturn } from "./session/useUpdateSession.js";
export { computeDiff } from "./version-history/computeDiff.js";
export type { DiffHunk, DiffLine } from "./version-history/diff-types.js";

// Types the public hooks' signatures name: exported so a host can type what
// it passes and receives.
export type { BackoffOptions } from "./internal/backoff.js";
export type { ConversationStore, Listener as ConversationStoreListener, StreamState } from "./internal/store/conversation-store.js";
export type { SpeedTier } from "./models/registry.js";
export type { ServiceTierOption } from "./models/service-tier.js";
export type { ThinkingModeOption } from "./models/thinking-mode.js";
export type { MessageFileView } from "./run/message-file-view.js";
export type { ToolCategory, ToolCategoryInfo, ToolIdentity } from "./run/tool-categories.js";
export type { SendMessageInput, SendMessageResult } from "./run/useCreateRun.js";
export type { UseSessionRunsOptions } from "./session/useSessionRuns.js";
