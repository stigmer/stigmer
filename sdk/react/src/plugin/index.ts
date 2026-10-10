/**
 * Plugin: what you install, used whole. A chat or an agent lists a plugin
 * and gets its skills, its agents, its hooks and its MCP servers; a plugin
 * is the only home of an MCP server.
 *
 * Data hooks over the installed kind (`usePlugin`, `usePluginList`,
 * `usePluginCount`, `usePluginSearch`, `usePluginVersions`), the
 * marketplace layer a browser reads without a zipball (`useMarketplaces`,
 * `useMarketplace`, `usePreparePluginInstall`, `useInstallPlugin`), the
 * upload path (`usePluginUpload` over `sources/local.ts`), "Add MCP
 * server" (`AddMcpServerDialog` over `useAddMcpServer`, a plugin of one
 * server built in the browser), the styled surfaces (`PluginDetailView`,
 * `MarketplaceCatalog`, `PluginUploader`, `PluginInstallDialog`,
 * `InstallPreview`, `ManagedByPluginNotice`, `PluginPicker`), a server's
 * sign-in over the person's My vault (`PluginServerSignIn` over
 * `usePluginServerSignIn`, `PluginServerSignIns` for a conversation's
 * plugins) and its tools on demand (`usePluginTools`), the way onto an
 * agent (`AddPluginToAgentDialog` over `useAddPluginToAgent`, the spec
 * edit in `plugin-on-agent.ts`), a hook set as both the plugin and the
 * agent page show it (`HookConfigList`), the label rule an agent a plugin
 * once installed still carries (`useManagingPlugin`), and the picks a
 * browser remembers for the next conversation (`rememberedPluginPicks.ts`).
 * Remove goes through `useDeleteResource("plugin", id)`; visibility
 * through `useUpdateVisibility("plugin", id)`, the one home each already
 * has.
 */

// Data hooks
export { usePlugin } from "./usePlugin.js";
export type { UsePluginReturn } from "./usePlugin.js";
export { usePluginList, usePluginCount } from "./usePluginList.js";
export type {
  UsePluginListOptions,
  UsePluginListReturn,
  UsePluginCountOptions,
  UsePluginCountReturn,
} from "./usePluginList.js";
export { usePluginSearch } from "./usePluginSearch.js";
export type { UsePluginSearchOptions, UsePluginSearchReturn } from "./usePluginSearch.js";
export { usePluginVersions } from "./usePluginVersions.js";
export type { UsePluginVersionsReturn } from "./usePluginVersions.js";
export { PLUGIN_LABEL, useManagingPlugin } from "./useManagingPlugin.js";
export type { UseManagingPluginReturn } from "./useManagingPlugin.js";

// Marketplaces
export {
  BUILT_IN_SOURCES,
  MARKETPLACES_STORAGE_KEY,
  OFFICIAL_MARKETPLACE,
  OFFICIAL_MARKETPLACE_NAME,
  narrowStoredEntry,
  useMarketplaces,
} from "./useMarketplaces.js";
export type {
  AddSourceOutcome,
  UnreadableMarketplace,
  UseMarketplacesOptions,
  UseMarketplacesReturn,
} from "./useMarketplaces.js";
export { useMarketplace } from "./useMarketplace.js";
export type { UseMarketplaceOptions, UseMarketplaceReturn } from "./useMarketplace.js";
export { catalogEntries, useMarketplaceCatalog } from "./useMarketplaceCatalog.js";
export type {
  CatalogEntry,
  SourceRead,
  SourceReadState,
  UseMarketplaceCatalogOptions,
  UseMarketplaceCatalogReturn,
} from "./useMarketplaceCatalog.js";
export { MarketplaceCatalogStore, sourceKeyOf } from "./catalog-store.js";
export type { OpenSource } from "./catalog-store.js";
export { usePluginPresentation } from "./usePluginPresentation.js";
export type { UsePluginPresentationReturn } from "./usePluginPresentation.js";
export { usePreparePluginInstall } from "./usePreparePluginInstall.js";
export type { UsePreparePluginInstallReturn } from "./usePreparePluginInstall.js";
export { useInstallRelation } from "./useInstallRelation.js";
export type { InstallRelation, UseInstallRelationReturn } from "./useInstallRelation.js";
export { useInstallPlugin } from "./useInstallPlugin.js";
export type { InstallPluginOptions, InstallPluginOutcome, UseInstallPluginReturn } from "./useInstallPlugin.js";
export { MARKETPLACE_TREE_LIMITS, MarketplaceSourceError, formatMib } from "./sources/types.js";
export type {
  FetchImpl,
  GitHubMarketplaceSource,
  KnownMarketplace,
  MarketplaceSource,
  MarketplaceTree,
} from "./sources/types.js";
export { PluginReadRefusal, entryCandidates, findEntry, openMarketplace, prepareEntry } from "./sources/read.js";
export type { InstallOrigin, OpenedMarketplace, PreparedInstall } from "./sources/read.js";
export { LocalPluginError, folderPick, folderPickFromInput, prepareLocalPlugin, zipPick } from "./sources/local.js";
export type { LocalFile, LocalPick } from "./sources/local.js";
export { openMarketplaceSource } from "./sources/open.js";
export type { OpenSourceOptions } from "./sources/open.js";
export { githubAvatarUrl, githubOwner, openGitHubTree, rawUrl, treesUrl } from "./sources/github.js";
export { OFFICIAL_PUBLISHER, isPublishedVersion, officialFileUrl, officialListingUrl, openOfficialTree } from "./sources/official.js";

// Components
export { PluginDetailView } from "./PluginDetailView.js";
export type { PluginDetailViewProps } from "./PluginDetailView.js";
export { PluginServerRow, reachedBy } from "./PluginServerRow.js";
export type { PluginServerRowProps } from "./PluginServerRow.js";
export { PluginPicker } from "./PluginPicker.js";
export type { PluginPickerProps } from "./PluginPicker.js";
export { CATALOG_PAGE_SIZE, MarketplaceCatalog, filterEntries, matchesQuery } from "./MarketplaceCatalog.js";
export type { MarketplaceCatalogProps } from "./MarketplaceCatalog.js";
export { PluginCard, UploadTile } from "./PluginCard.js";
export type { PluginCardProps, UploadTileProps } from "./PluginCard.js";
export { PluginFace, monogramRing } from "./PluginFace.js";
export type { PluginFaceProps } from "./PluginFace.js";
export { SourceMark, publisherOf } from "./SourceMark.js";
export type { SourceMarkProps } from "./SourceMark.js";
export { SourceChips } from "./SourceChips.js";
export type { SourceChipsProps } from "./SourceChips.js";
export { ManageSourcesDialog, describeSource } from "./ManageSourcesDialog.js";
export type { ManageSourcesDialogProps } from "./ManageSourcesDialog.js";
export { PluginUploader } from "./PluginUploader.js";
export type { PluginUploaderProps } from "./PluginUploader.js";
export { usePluginUpload, looksLikeDroppedDotfiles } from "./usePluginUpload.js";
export type { PluginUploadPhase, UsePluginUploadReturn } from "./usePluginUpload.js";
export { PluginInstallDialog, summariseInstall } from "./PluginInstallDialog.js";
export type { PluginInstallDialogProps } from "./PluginInstallDialog.js";
export { InstallPreview, PrepareRefusal, describeOrigin } from "./InstallPreview.js";
export type { InstallPreviewProps } from "./InstallPreview.js";
export { PluginServerSignIn } from "./PluginServerSignIn.js";
export type { PluginServerSignInProps } from "./PluginServerSignIn.js";
export { PluginServerSignIns } from "./PluginServerSignIns.js";
export type { PluginServerSignInsProps } from "./PluginServerSignIns.js";
export { usePluginServerSignIn } from "./usePluginServerSignIn.js";
export type { PluginServerSignInKind, UsePluginServerSignInReturn } from "./usePluginServerSignIn.js";
export { usePluginTools } from "./usePluginTools.js";
export type { UsePluginToolsReturn } from "./usePluginTools.js";
export { AddMcpServerDialog } from "./AddMcpServerDialog.js";
export type { AddMcpServerDialogProps } from "./AddMcpServerDialog.js";
export { mcpServerPluginFiles, prepareMcpServerPlugin, useAddMcpServer } from "./useAddMcpServer.js";
export type { AddMcpServerOptions, McpServerFormInput, UseAddMcpServerReturn } from "./useAddMcpServer.js";
export { AddPluginToAgentDialog } from "./AddPluginToAgentDialog.js";
export type { AddPluginToAgentDialogProps } from "./AddPluginToAgentDialog.js";
export { toolsLeaveOut, useAddPluginToAgent } from "./useAddPluginToAgent.js";
export type { AddPluginOutcome, AddPluginPhase, PluginOffer, UseAddPluginToAgentReturn } from "./useAddPluginToAgent.js";
export { listsPlugin, withPlugin } from "./plugin-on-agent.js";
export { PLUGIN_PICKS_STORAGE_KEY, readRememberedPluginPicks, rememberPluginPicks } from "./rememberedPluginPicks.js";
export { HookConfigList } from "./HookConfigList.js";
export type { HookConfigListProps } from "./HookConfigList.js";
export { ManagedByPluginNotice } from "./ManagedByPluginNotice.js";
export type { ManagedByPluginNoticeProps } from "./ManagedByPluginNotice.js";
export { PluginIcon } from "./PluginIcon.js";
