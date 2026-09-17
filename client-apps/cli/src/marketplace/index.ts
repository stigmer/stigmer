// Public surface of the marketplace module: the sources a CLI knows, the two
// grammars a user types, one way to get a tree on disk, one way to read it,
// one way to turn an entry into a push, and the two renderers. Commands
// lazy-import this barrel inside their actions so `--help` stays fast.

export {
  OFFICIAL_MARKETPLACE,
  OFFICIAL_MARKETPLACE_NAME,
  type KnownMarketplace,
  type MarketplaceListing,
  type MarketplaceSource,
  type UnreadableMarketplace,
  addMarketplace,
  describeSource,
  findMarketplace,
  listMarketplaces,
  removeMarketplace,
} from "./config.js";
export {
  type LocatedEntry,
  assertVersion,
  locateEntry,
  prepareEntry,
} from "./install.js";
export {
  type OpenMarketplace,
  type OpenMarketplaceOptions,
  openMarketplace,
  withMarketplace,
} from "./materialize.js";
export {
  type OfficialMarketplaceDir,
  type ResolveOfficialOptions,
  resolveOfficialMarketplace,
} from "./official.js";
export {
  type ReadMarketplaceTree,
  entryDirectory,
  findEntry,
  marketplaceRefusal,
  readMarketplaceTree,
} from "./read.js";
export {
  type InstallRef,
  formatInstallRef,
  parseAddSource,
  parseInstallRef,
} from "./ref.js";
export {
  type ShownEntry,
  inspectEntries,
  renderMarketplaceList,
  renderMarketplaceShow,
} from "./render.js";
