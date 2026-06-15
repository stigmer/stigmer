// Faithful port of go-git's plumbing/format/gitignore Pattern (ParsePattern +
// Match). This is what gives `push` its exact gitignore semantics: domain
// scoping, directory-only patterns, single-name vs glob matching, and the
// `**` zero-to-many-directories wildcard.

import { matchName } from "./match.js";

export enum MatchResult {
  NoMatch = 0,
  Exclude = 1,
  Include = 2,
}

const INCLUSION_PREFIX = "!";
const ZERO_TO_MANY = "**";
const DIR_SEP = "/";

export interface Pattern {
  /** Whether this is a negation (`!`) pattern — needed for source ordering. */
  readonly inclusion: boolean;
  match(path: readonly string[], isDir: boolean): MatchResult;
}

class GitignorePattern implements Pattern {
  readonly inclusion: boolean;
  private readonly domain: readonly string[];
  private readonly parts: readonly string[];
  private readonly dirOnly: boolean;
  private readonly isGlob: boolean;

  constructor(domain: readonly string[], parts: readonly string[], inclusion: boolean, dirOnly: boolean, isGlob: boolean) {
    this.domain = domain;
    this.parts = parts;
    this.inclusion = inclusion;
    this.dirOnly = dirOnly;
    this.isGlob = isGlob;
  }

  match(path: readonly string[], isDir: boolean): MatchResult {
    const matchResult = this.inclusion ? MatchResult.Include : MatchResult.Exclude;

    if (path.length <= this.domain.length) return MatchResult.NoMatch;
    for (let i = 0; i < this.domain.length; i++) {
      if (path[i] !== this.domain[i]) return MatchResult.NoMatch;
    }

    const scoped = path.slice(this.domain.length);
    const matched = this.isGlob ? this.globMatch(scoped, isDir) : this.simpleNameMatch(scoped, isDir);
    return matched ? matchResult : MatchResult.NoMatch;
  }

  private simpleNameMatch(path: readonly string[], isDir: boolean): boolean {
    for (let i = 0; i < path.length; i++) {
      if (!matchName(this.parts[0], path[i])) continue;
      if (this.dirOnly && !isDir && i === path.length - 1) return false;
      return true;
    }
    return false;
  }

  private globMatch(path: readonly string[], isDir: boolean): boolean {
    let matched = false;
    let canTraverse = false;
    let remaining = path;

    for (let i = 0; i < this.parts.length; i++) {
      const part = this.parts[i];
      if (part === "") {
        canTraverse = false;
        continue;
      }
      if (part === ZERO_TO_MANY) {
        if (i === this.parts.length - 1) break;
        canTraverse = true;
        continue;
      }
      if (part.includes(ZERO_TO_MANY)) return false;
      if (remaining.length === 0) return false;

      if (canTraverse) {
        canTraverse = false;
        for (;;) {
          if (remaining.length === 0) {
            matched = false;
            break;
          }
          const e = remaining[0];
          remaining = remaining.slice(1);
          if (matchName(part, e)) {
            matched = true;
            break;
          }
        }
      } else {
        if (!matchName(part, remaining[0])) return false;
        matched = true;
        remaining = remaining.slice(1);
      }
    }

    if (matched && this.dirOnly && !isDir && remaining.length === 0) {
      matched = false;
    }
    return matched;
  }
}

/** Parse a gitignore pattern string into a matchable Pattern (go-git parity). */
export function parsePattern(raw: string, domain: readonly string[]): Pattern {
  let p = raw;
  let inclusion = false;

  if (p.startsWith(INCLUSION_PREFIX)) {
    inclusion = true;
    p = p.slice(1);
  }

  if (!p.endsWith("\\ ")) {
    p = p.replace(/ +$/, "");
  }

  let dirOnly = false;
  if (p.endsWith(DIR_SEP)) {
    dirOnly = true;
    p = p.slice(0, -1);
  }

  const isGlob = p.includes(DIR_SEP);
  const parts = p.split(DIR_SEP);
  return new GitignorePattern(domain, parts, inclusion, dirOnly, isGlob);
}
