/**
 * `@stigmer/plugin-package`: the public surface.
 *
 * `readPluginPackage` reads one plugin; `readMarketplace` reads a catalogue
 * of them; `readPluginPresentation` reads what a card shows for one entry
 * without opening the rest of it; `readEvalSuite` reads the plugin's own
 * eval suite, which the install summarises and the eval workflow runs. Everything else here is what a consumer needs to supply its
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
export { HOOK_CONDITION_PATTERN, RUN_EVENTS, hookVariableReferences, isValidMatcher } from "./normalise/hooks.js";
export { SUB_AGENT_INSTRUCTIONS_MIN, classifyModel } from "./normalise/sub-agents.js";
export { PLACEHOLDER_PATTERN, PLATFORM_VARIABLES, VARIABLE_NAME_PATTERN } from "./placeholders.js";
export { HOOK_WARNING_KINDS } from "./outcome.js";
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
export { hasMarketplaceFile, readMarketplace, readMarketplaceFile } from "./marketplace/read-marketplace.js";
export { readPluginPackage } from "./read-plugin-package.js";
export { toolServerSegment } from "./tool-names.js";
export {
  DEFAULT_EVAL_DIR,
  EVAL_MAX_APPEND_SYSTEM_PROMPT,
  EVAL_MAX_GRADERS,
  EVAL_UNSUPPORTED_FEATURES,
  type EvalUnsupportedFeature,
  readEvalSuite,
} from "./evals/read-eval-suite.js";
export { EVAL_ENV_KEY_PATTERN, EVAL_SCHEMA_VERSION } from "./evals/fields.js";
export {
  EVAL_SUMMARY_MAX_CASE_TAGS,
  EVAL_SUMMARY_MAX_CASES,
  EVAL_SUMMARY_MAX_FINDINGS,
  EVAL_SUMMARY_MAX_MESSAGE,
  EVAL_SUMMARY_MAX_PATH,
  EVAL_SUMMARY_MAX_SUITE_TAGS,
  EVAL_SUMMARY_MAX_TEXT,
  type EvalSuiteSummary,
  type EvalSuiteSummaryCase,
  summariseEvalSuite,
} from "./evals/summary.js";
export { GLOB_MAX_ALTERNATIVES, GLOB_MAX_BRACE_DEPTH, GLOB_MAX_CLASS_ITEMS, GLOB_MAX_LENGTH, GLOB_MAX_TOKENS, globError } from "./evals/glob.js";
export type {
  EvalCase,
  EvalCaseContext,
  EvalFocus,
  EvalGrader,
  EvalGraderArm,
  EvalGraderCheck,
  EvalGraderType,
  EvalSuite,
  EvalSuiteFinding,
  EvalToolRef,
} from "./evals/types.js";
export { type PluginPresentation, readPluginPresentation } from "./presentation.js";
export type {
  HookFormat,
  IgnoredComponent,
  IgnoredComponentKind,
  ModelAlias,
  ModelHint,
  PluginAuthor,
  PluginDialect,
  PluginHookGroup,
  PluginHookHandler,
  PluginHooks,
  PluginMcpServer,
  PluginPackage,
  PluginSkill,
  PluginSubAgent,
  PluginVariable,
} from "./types.js";
