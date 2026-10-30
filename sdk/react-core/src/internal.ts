// @stigmer/react-core/internal — the plumbing the React kit
// (@stigmer/react-sdk) shares with this package: the data-fetch hook and
// cache, the error mapper, the paging walks, the masked-edit helper, the
// contexts and converters its components read. It exists because the kit's
// hooks and components are written on the same plumbing as the conversation
// hooks, and one copy keeps one fetch cache and one error mapping.
//
// It is for @stigmer/react-sdk alone. Nothing here carries a compatibility
// promise: a name may change or leave in any release. It is safe for the kit
// because every @stigmer/* package ships in lockstep and pins the others at
// the exact same version (scripts/publish-libs.mjs), so the kit and this
// package always come from one release. The terminal kit, an app and the
// docs import the public entry only; a repository test refuses any other
// importer (scripts/react-core-internal.test.mjs). This entry is left out of
// the generated reference.

export { fromProtoInteractionMode, toProtoInteractionMode } from "./composer/interaction-mode.js";
export { ApiResourceKind } from "./deployment-mode.js";
export { ExecutionTargetContext, useExecutionTarget } from "./execution-target-context.js";
export { FetchCacheContext, useFetchCache } from "./internal/FetchCacheProvider.js";
export { isPerfLoggingEnabled } from "./internal/dev/enabled.js";
export { useStreamRate } from "./internal/dev/use-stream-rate.js";
export type { StreamRateTracker } from "./internal/dev/use-stream-rate.js";
export { LIST_PAGE_MAX, readEveryPage, readWholeList } from "./internal/everyPage.js";
export { FetchCache } from "./internal/fetch-cache.js";
export { maskedEdit, saveErrorMessage } from "./internal/maskedEdit.js";
export { ConversationStore, useConversationStoreRef } from "./internal/store/conversation-store.js";
export { toError } from "./internal/toError.js";
export { useCursorPages } from "./internal/useCursorPages.js";
export type { CursorPage } from "./internal/useCursorPages.js";
export { useFetch } from "./internal/useFetch.js";
export { useKeyedSubmission } from "./internal/useKeyedSubmission.js";
export {
  HARNESS_META,
  HARNESS_OPTIONS,
  isHarnessOption,
  isNamedHarness,
} from "./models/harness.js";
export type { HarnessDisplayInfo } from "./models/harness.js";
export { resolveDefaultModelId } from "./models/registry.js";
export type { DefaultModelResolution, DefaultModelSource } from "./models/registry.js";
export { FAST_SERVICE_TIER, fromProtoServiceTier, toProtoServiceTier } from "./models/service-tier.js";
export { fromProtoThinkingMode, toProtoThinkingMode } from "./models/thinking-mode.js";
export { isTerminalPhase } from "./run/run-phases.js";
export {
  SHELL_INTENT_ARG_FIELD,
  defaultChromeForCategory,
  extractIntent,
  extractPrimaryArgFromPreview,
  extractShellIntent,
  extractWriteContentFromArgs,
  isFileCategory,
  isInternalTool,
  isRunGroupableCategory,
  parseArgsPreview,
  withAuthoritativeWriteContent,
} from "./run/tool-categories.js";
export type { ToolChrome } from "./run/tool-categories.js";
export { runIdFromStorageKey } from "./run/useFileChangeContent.js";
export { RunnerAdapterContext } from "./runner-adapter.js";
export { useResourceCount, useResourceList, useResourceSearch } from "./search/index.js";
export { fromProtoExecutionTarget, toProtoExecutionTarget } from "./session/execution-target.js";
export { mapPatchHunks } from "./version-history/diff-hunks.js";
