export { useWorkspaceEntries } from "./useWorkspaceEntries.js";
export type {
  WorkspaceEntry,
  UseWorkspaceEntriesReturn,
} from "./useWorkspaceEntries.js";
export type {
  WorkspaceFileEntry,
  WorkspaceFileLister,
} from "./WorkspaceFileLister.js";
export { MAX_WORKSPACE_FILE_READ_BYTES } from "./WorkspaceFileReader.js";
export type {
  WorkspaceFileContent,
  WorkspaceFileReader,
} from "./WorkspaceFileReader.js";
export { useWorkspaceFiles } from "./useWorkspaceFiles.js";
export type {
  UseWorkspaceFilesOptions,
  UseWorkspaceFilesReturn,
} from "./useWorkspaceFiles.js";
export { useWorkspaceFileContent } from "./useWorkspaceFileContent.js";
export type {
  UseWorkspaceFileContentOptions,
  UseWorkspaceFileContentReturn,
} from "./useWorkspaceFileContent.js";
export { useWorkspaceFileSearch } from "./useWorkspaceFileSearch.js";
export type {
  UseWorkspaceFileSearchOptions,
  UseWorkspaceFileSearchReturn,
  WorkspaceFileSearchGroup,
} from "./useWorkspaceFileSearch.js";
// The match type is part of the public search return; the matcher itself stays @internal.
export type { WorkspaceFileMatch } from "./matchWorkspaceFiles.js";
export { WorkspaceFileSearch } from "./WorkspaceFileSearch.js";
export type { WorkspaceFileSearchProps } from "./WorkspaceFileSearch.js";
export type {
  WorkspaceContentMatch,
  WorkspaceContentSearchResult,
  WorkspaceContentSearcher,
} from "./WorkspaceContentSearcher.js";
export { useWorkspaceContentSearch } from "./useWorkspaceContentSearch.js";
export type {
  UseWorkspaceContentSearchOptions,
  UseWorkspaceContentSearchReturn,
  WorkspaceContentSearchGroup,
} from "./useWorkspaceContentSearch.js";
export { WorkspaceContentSearch } from "./WorkspaceContentSearch.js";
export type { WorkspaceContentSearchProps } from "./WorkspaceContentSearch.js";
// The highlight helper (findHighlightRanges) stays @internal, like matchWorkspaceFiles.
export { FileViewer } from "./FileViewer.js";
export type { FileViewerProps, FileViewerHandle } from "./FileViewer.js";
export { WorkspaceSurface } from "./WorkspaceSurface.js";
export type {
  WorkspaceSurfaceProps,
  SurfaceRailView,
  SurfaceVirtualDocument,
} from "./WorkspaceSurface.js";
// Virtual-document identity helpers: hosts mint collision-proof entry ids for
// SurfaceVirtualDocument tabs and detect them in file-only code paths.
export { virtualEntryId, isVirtualEntryId } from "../internal/store/index.js";
export { ExplorerTree } from "./ExplorerTree.js";
export type { ExplorerTreeProps } from "./ExplorerTree.js";
// The open-editor tab shape + open-file options are part of the public
// WorkspaceSurface API.
export type { OpenEditor, OpenFileOptions } from "../internal/store/index.js";
// The jump-to-line reveal target rides on FileViewer / WorkspaceSurface /
// ArtifactContentRenderer props; export the shape (the hook stays @internal).
export type { RevealTarget } from "../internal/useRevealLine.js";
// The viewer's selection shape is part of the public FileViewer API; re-export
// the type (not the store) so consumers can construct/inspect a selection.
export type { SelectedWorkspaceFile } from "../internal/store/workspace-file-selection-store.js";
export { WorkspaceEditor } from "./WorkspaceEditor.js";
export type { WorkspaceEditorProps } from "./WorkspaceEditor.js";
export { WorkspaceSummary } from "./WorkspaceSummary.js";
export type { WorkspaceSummaryProps } from "./WorkspaceSummary.js";
export { useRecentWorkspaces } from "./useRecentWorkspaces.js";
export type {
  RecentWorkspace,
  UseRecentWorkspacesReturn,
} from "./useRecentWorkspaces.js";
export { useWorkspaceSources } from "./useWorkspaceSources.js";
export type {
  UseWorkspaceSourcesOptions,
  UseWorkspaceSourcesReturn,
} from "./useWorkspaceSources.js";
