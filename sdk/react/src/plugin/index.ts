/**
 * Plugin: what you install; an agent is what runs.
 *
 * Data hooks over the installed kind (`usePlugin`, `usePluginList`,
 * `usePluginCount`, `usePluginMembers`, `usePluginVersions`), the
 * marketplace layer a browser reads without a zipball (`useMarketplaces`,
 * `useMarketplace`, `usePreparePluginInstall`, `useInstallPlugin`), the
 * upload path (`usePluginUpload` over `sources/local.ts`), the styled
 * surfaces (`PluginDetailView`, `MarketplaceCatalog`, `PluginUploader`,
 * `PluginInstallDialog`, `InstallPreview`, `ManagedByPluginNotice`) and the
 * label rule the member detail views apply (`useManagingPlugin`). Remove goes through
 * `useDeleteResource("plugin", id)`; visibility through
 * `useUpdateVisibility("plugin", id)`, the one home each already has.
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
export { usePluginMembers } from "./usePluginMembers.js";
export type { PluginMembersByKind, UsePluginMembersReturn } from "./usePluginMembers.js";
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
export { PluginReadRefusal, findEntry, openMarketplace, prepareEntry } from "./sources/read.js";
export type { InstallOrigin, OpenedMarketplace, PreparedInstall } from "./sources/read.js";
export { LocalPluginError, folderPick, folderPickFromInput, prepareLocalPlugin, zipPick } from "./sources/local.js";
export type { LocalFile, LocalPick } from "./sources/local.js";
export { openMarketplaceSource } from "./sources/open.js";
export type { OpenSourceOptions } from "./sources/open.js";
export { openGitHubTree, rawUrl, treesUrl } from "./sources/github.js";
export { isPublishedVersion, officialFileUrl, officialListingUrl, openOfficialTree } from "./sources/official.js";

// Components
export { PluginDetailView, kindLabel as pluginMemberKindLabel } from "./PluginDetailView.js";
export type { PluginDetailViewProps, PluginMemberRef } from "./PluginDetailView.js";
export { MarketplaceCatalog, filterEntries } from "./MarketplaceCatalog.js";
export type { MarketplaceCatalogProps } from "./MarketplaceCatalog.js";
export { PluginUploader } from "./PluginUploader.js";
export type { PluginUploaderProps } from "./PluginUploader.js";
export { usePluginUpload, looksLikeDroppedDotfiles } from "./usePluginUpload.js";
export type { PluginUploadPhase, UsePluginUploadReturn } from "./usePluginUpload.js";
export { PluginInstallDialog, summariseInstall } from "./PluginInstallDialog.js";
export type { PluginInstallDialogProps } from "./PluginInstallDialog.js";
export { InstallPreview, PrepareRefusal, describeOrigin } from "./InstallPreview.js";
export type { InstallPreviewProps } from "./InstallPreview.js";
export { ManagedByPluginNotice } from "./ManagedByPluginNotice.js";
export type { ManagedByPluginNoticeProps } from "./ManagedByPluginNotice.js";
export { PluginIcon } from "./PluginIcon.js";
