// Provider and context
export { StigmerProvider, type StigmerProviderProps } from "./provider";
export { StigmerContext } from "./context";

// Hooks
export { useStigmer } from "./hooks";

// Models — data hook, styled component, and registry data
export {
  MODEL_REGISTRY,
  DEFAULT_MODEL_ID,
  useModelRegistry,
  ModelSelector,
} from "./models";
export type {
  ModelInfo,
  Provider,
  CostTier,
  UseModelRegistryReturn,
  ModelSelectorProps,
} from "./models";

// Workspace — behavior hooks, data hook, and styled components
export {
  useWorkspaceEntries,
  WorkspaceEditor,
  useFolderListing,
  FolderBrowser,
} from "./workspace";
export type {
  WorkspaceEntry,
  UseWorkspaceEntriesReturn,
  WorkspaceEditorProps,
  FolderEntry,
  FolderListing,
  UseFolderListingReturn,
  FolderBrowserProps,
} from "./workspace";

// Session — behavior hook (Session aggregate)
export { useCreateSession } from "./session";
export type {
  CreateSessionInput,
  CreateSessionResult,
  UseCreateSessionReturn,
} from "./session";

// Execution — behavior hook (AgentExecution aggregate)
export { useCreateAgentExecution } from "./execution";
export type {
  CreateAgentExecutionInput,
  CreateAgentExecutionResult,
  UseCreateAgentExecutionReturn,
} from "./execution";

// GitHub — OAuth connection, repo picker, and hooks
export {
  useGitHubConnection,
  useGitHubRepos,
  GitHubRepoPicker,
} from "./github";
export type {
  GitHubUser,
  UseGitHubConnectionReturn,
  GitHubRepo,
  GitHubBranch,
  UseGitHubReposReturn,
  GitHubRepoPickerProps,
} from "./github";
