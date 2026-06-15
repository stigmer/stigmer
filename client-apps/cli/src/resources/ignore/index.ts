// Public surface of the gitignore-compatible ignore engine.

export { DEFAULT_PATTERNS } from "./defaults.js";
export { matchName } from "./match.js";
export {
  createMatcher,
  type MatcherOptions,
  type MatchReason,
  Matcher,
  Reason,
  REASON_TEXT,
  SOURCE_CLI,
  SOURCE_DEFAULTS,
  SOURCE_GITIGNORE,
  SOURCE_STIGMERIGNORE,
} from "./matcher.js";
export { MatchResult, type Pattern, parsePattern } from "./pattern.js";
