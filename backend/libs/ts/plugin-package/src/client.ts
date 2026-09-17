/**
 * `@stigmer/plugin-package/client`: what every client that installs a
 * plugin does identically.
 *
 * The main entry reads a package; this entry is for the client that holds
 * a tree and must turn it into the push the server expects. Two clients do
 * that today, the CLI from a directory and the console from a marketplace
 * host's file list, and a plugin installed from either must have one
 * digest for one tree, be refused with one sentence for one mistake, and be
 * described in one vocabulary. So the pieces live here, once:
 *
 * - the gitignore-compatible ignore engine and the security defaults
 *   (`ignore/`), pure over the text of the ignore files;
 * - the selection rule (`select.ts`): which files a push carries, in the
 *   order the CLI's original walk produced them;
 * - the archive and its digest (`archive.ts`): the deterministic zip and
 *   the SHA-256 the server records;
 * - the grammars (`refs.ts`): an install ref and a GitHub marketplace
 *   source, with their refusal sentences;
 * - the vocabulary (`vocabulary.ts`): the labels both surfaces print.
 *
 * Nothing here touches the filesystem, the network or any `node:*` module.
 * A client's edge (a directory walk, a fetch) produces the candidates and
 * the bytes; this entry decides what becomes of them.
 */

export { DEFAULT_PATTERNS } from "./client/ignore/defaults.js";
export { matchName } from "./client/ignore/match.js";
export {
  type IgnoreSources,
  type MatchReason,
  Matcher,
  Reason,
  REASON_TEXT,
  SOURCE_CLI,
  SOURCE_DEFAULTS,
  SOURCE_GITIGNORE,
  SOURCE_STIGMERIGNORE,
  buildMatcher,
} from "./client/ignore/matcher.js";
export { MatchResult, type Pattern, parsePattern } from "./client/ignore/pattern.js";
export {
  type CandidateFile,
  type PluginSelection,
  type SelectPluginFilesOptions,
  type SelectionStats,
  IGNORE_FILE_NAMES,
  compareWalkOrder,
  selectPluginFiles,
} from "./client/select.js";
export { DETERMINISTIC_ZIP_MTIME, archivePlugin, digestArchive } from "./client/archive.js";
export {
  type GitHubMarketplaceSource,
  type GitHubSourceOutcome,
  type InstallRef,
  type InstallRefOutcome,
  GITHUB_SOURCE_SHAPE,
  INSTALL_REF_SHAPE,
  OFFICIAL_MARKETPLACE_NAME,
  describeGitHubSource,
  formatInstallRef,
  isOwnerRepo,
  looksLikePath,
  parseGitHubSource,
  parseInstallRef,
} from "./client/refs.js";
export { DIALECT_LABELS } from "./client/vocabulary.js";
