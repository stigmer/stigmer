/**
 * `@stigmer/plugin-package`: the public surface.
 *
 * `readPluginPackage` reads one plugin; `readMarketplace` reads a catalogue
 * of them. Everything else here is what a consumer needs to supply its
 * input (`PluginFiles`, the caps), route a directory (`MANIFEST_LOCATIONS`,
 * `hasPluginManifest`, `MARKETPLACE_LOCATIONS`, `hasMarketplaceFile`), or
 * render an outcome (the finding kinds and `isErrorKind`). The dialect
 * readers and normalisers are internal: a consumer never composes a partial
 * read.
 */

export { hasPluginManifest, isValidPluginName } from "./detect.js";
export {
  comparePaths,
  inMemoryPluginFiles,
  isContainedPath,
  PLUGIN_DOCUMENT_LIMITS,
  resolveDeclaredPath,
  type DeclaredPathOutcome,
  type PluginDocumentClass,
  type PluginFileEntry,
  type PluginFiles,
} from "./files.js";
export { SKILL_NAME_PATTERN } from "./frontmatter.js";
export {
  AGENT_PLUGINS_MANIFEST_SCHEMA,
  AGENT_PLUGINS_MCP_SCHEMA,
  errorMessage,
  isErrorKind,
  MANIFEST_LOCATIONS,
  warningMessage,
} from "./messages.js";
export { SUB_AGENT_INSTRUCTIONS_MIN, classifyModel } from "./normalise/sub-agents.js";
export { PLACEHOLDER_PATTERN, VARIABLE_NAME_PATTERN } from "./placeholders.js";
export type {
  Finding,
  FindingContext,
  PluginErrorKind,
  PluginFinding,
  PluginFindingKind,
  PluginReadOutcome,
  PluginWarningKind,
} from "./outcome.js";
export { MARKETPLACE_LOCATIONS } from "./marketplace/messages.js";
export type {
  Marketplace,
  MarketplaceDialect,
  MarketplaceEntry,
  MarketplaceErrorKind,
  MarketplaceFinding,
  MarketplaceFindingKind,
  MarketplaceOwner,
  MarketplaceReadOutcome,
  MarketplaceWarningKind,
} from "./marketplace/outcome.js";
export { hasMarketplaceFile, readMarketplace } from "./marketplace/read-marketplace.js";
export { readPluginPackage } from "./read-plugin-package.js";
export type {
  IgnoredComponent,
  IgnoredComponentKind,
  ModelAlias,
  ModelHint,
  OverlayDocument,
  OverlayNamedDocument,
  OverlayServerDocument,
  PluginAuthor,
  PluginDialect,
  PluginMcpServer,
  PluginPackage,
  PluginSkill,
  PluginSubAgent,
  PluginVariable,
  StigmerOverlay,
} from "./types.js";
