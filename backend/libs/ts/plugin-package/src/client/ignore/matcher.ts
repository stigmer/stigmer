// Ignore matcher: composes pattern sources with gitignore precedence (defaults
// → .gitignore → .stigmerignore → caller flags), evaluating "last match wins".
// A faithful port of the Go CLI's pkg/ignore Matcher.
//
// The matcher is pure over the TEXT of the ignore files. Where that text
// comes from is the caller's edge: the CLI reads `.gitignore` and
// `.stigmerignore` from the directory it is about to package, the console
// finds them among the files a marketplace tree lists. Both build the same
// matcher from the same sources, which is what makes a plugin selected in
// the browser the same set of files the CLI would have selected.

import { DEFAULT_PATTERNS } from "./defaults.js";
import { MatchResult, type Pattern, parsePattern } from "./pattern.js";

export const SOURCE_DEFAULTS = "defaults";
export const SOURCE_GITIGNORE = ".gitignore";
export const SOURCE_STIGMERIGNORE = ".stigmerignore";
export const SOURCE_CLI = "cli";

export enum Reason {
  NoMatch = 0,
  Excluded = 1,
  Included = 2,
  DefaultDeny = 3,
}

export const REASON_TEXT: Readonly<Record<Reason, string>> = {
  [Reason.NoMatch]: "no pattern matched",
  [Reason.Excluded]: "excluded by pattern",
  [Reason.Included]: "included by negation pattern",
  [Reason.DefaultDeny]: "excluded by security default",
};

export interface MatchReason {
  readonly ignored: boolean;
  readonly reason: Reason;
  readonly source: string;
  readonly pattern: string;
}

interface PatternEntry {
  readonly pattern: Pattern;
  readonly source: string;
  readonly raw: string;
}

/** The pattern sources a matcher is built from, in precedence order (later wins). */
export interface IgnoreSources {
  /** Whether the built-in security defaults apply (every push says yes). */
  readonly includeDefaults: boolean;
  /** The text of the root `.gitignore`, or `undefined` when absent or not respected. */
  readonly gitignore?: string;
  /** The text of the root `.stigmerignore`, or `undefined` when absent. */
  readonly stigmerignore?: string;
  /** Extra exclusion patterns from the caller (`--ignore`). */
  readonly extraIgnore?: readonly string[];
  /** Extra inclusion patterns from the caller (`--include`), negated if not already. */
  readonly extraInclude?: readonly string[];
}

export class Matcher {
  private readonly entries: readonly PatternEntry[];

  constructor(entries: readonly PatternEntry[]) {
    this.entries = entries;
  }

  /** Decide whether a path (relative, forward-slash) is ignored, with reason. */
  matchWithReason(path: string, isDir: boolean): MatchReason {
    const components = pathToComponents(path);
    if (components.length === 0) {
      return { ignored: false, reason: Reason.NoMatch, source: "", pattern: "" };
    }

    let lastMatch: PatternEntry | undefined;
    let lastResult = MatchResult.NoMatch;
    for (const entry of this.entries) {
      const result = entry.pattern.match(components, isDir);
      if (result !== MatchResult.NoMatch) {
        lastMatch = entry;
        lastResult = result;
      }
    }

    if (lastMatch === undefined) {
      return { ignored: false, reason: Reason.NoMatch, source: "", pattern: "" };
    }

    if (lastResult === MatchResult.Exclude) {
      const reason = lastMatch.source === SOURCE_DEFAULTS ? Reason.DefaultDeny : Reason.Excluded;
      return { ignored: true, reason, source: lastMatch.source, pattern: lastMatch.raw };
    }
    // Include (negation): explicitly un-ignored.
    return { ignored: false, reason: Reason.Included, source: lastMatch.source, pattern: lastMatch.raw };
  }

  /** Whether the path should be excluded from the artifact. */
  match(path: string, isDir: boolean): boolean {
    return this.matchWithReason(path, isDir).ignored;
  }

  /** All loaded patterns as "[source] pattern" (for dry-run diagnostics). */
  patterns(): string[] {
    return this.entries.map((entry) => `[${entry.source}] ${entry.raw}`);
  }
}

/** Build a matcher from its sources; the pure core every reader shares. */
export function buildMatcher(sources: IgnoreSources): Matcher {
  const entries: PatternEntry[] = [];
  if (sources.includeDefaults) {
    entries.push(...parseEntries(DEFAULT_PATTERNS, SOURCE_DEFAULTS));
  }
  if (sources.gitignore !== undefined) {
    entries.push(...parseEntries(sources.gitignore.split(/\r?\n/), SOURCE_GITIGNORE));
  }
  if (sources.stigmerignore !== undefined) {
    entries.push(...parseEntries(sources.stigmerignore.split(/\r?\n/), SOURCE_STIGMERIGNORE));
  }

  const extraIgnore = sources.extraIgnore ?? [];
  const extraInclude = sources.extraInclude ?? [];
  if (extraIgnore.length > 0 || extraInclude.length > 0) {
    entries.push(...loadCliPatterns(extraIgnore, extraInclude));
  }

  return new Matcher(entries);
}

function parseEntries(patterns: readonly string[], source: string): PatternEntry[] {
  const entries: PatternEntry[] = [];
  for (const raw of patterns) {
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    entries.push({ pattern: parsePattern(trimmed, []), source, raw: trimmed });
  }
  return entries;
}

function loadCliPatterns(ignore: readonly string[], include: readonly string[]): PatternEntry[] {
  const entries = parseEntries(ignore, SOURCE_CLI);
  const negations: string[] = [];
  for (const pattern of include) {
    const trimmed = pattern.trim();
    if (trimmed === "") continue;
    negations.push(trimmed.startsWith("!") ? trimmed : `!${trimmed}`);
  }
  entries.push(...parseEntries(negations, SOURCE_CLI));
  return entries;
}

function pathToComponents(path: string): string[] {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (normalized === "" || normalized === ".") return [];
  return normalized.split("/");
}
