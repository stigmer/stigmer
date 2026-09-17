// Public surface of the CLI's ignore edge. The engine is
// `@stigmer/plugin-package/client`; re-exported here so the CLI's callers keep
// one import path and the shared engine stays the only implementation.

export {
  DEFAULT_PATTERNS,
  type MatchReason,
  MatchResult,
  Matcher,
  type Pattern,
  REASON_TEXT,
  Reason,
  SOURCE_CLI,
  SOURCE_DEFAULTS,
  SOURCE_GITIGNORE,
  SOURCE_STIGMERIGNORE,
  matchName,
  parsePattern,
} from "@stigmer/plugin-package/client";
export { createMatcher, type MatcherOptions } from "./matcher.js";
