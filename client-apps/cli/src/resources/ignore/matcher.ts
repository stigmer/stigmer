// The CLI's edge for the shared ignore engine: read the ignore files from the
// directory about to be packaged and build the matcher from their text.
//
// The engine itself (patterns, precedence, last-match-wins, the security
// defaults) lives in `@stigmer/plugin-package/client`, where the console
// builds the same matcher from a marketplace tree's file list. What is left
// here is what only a filesystem client needs: which files to read and that
// an absent or unreadable ignore file is normal and contributes nothing.

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  type IgnoreSources,
  type Matcher,
  SOURCE_GITIGNORE,
  SOURCE_STIGMERIGNORE,
  buildMatcher,
} from "@stigmer/plugin-package/client";

export interface MatcherOptions {
  readonly rootDir: string;
  readonly respectGitignore: boolean;
  readonly includeDefaults: boolean;
  readonly extraIgnore?: readonly string[];
  readonly extraInclude?: readonly string[];
}

/** Build a Matcher for `rootDir`, loading the configured pattern sources from disk. */
export function createMatcher(options: MatcherOptions): Matcher {
  if (options.rootDir === "") throw new Error("rootDir is required");
  const stat = statSync(options.rootDir);
  if (!stat.isDirectory()) throw new Error(`rootDir is not a directory: ${options.rootDir}`);

  const gitignore = options.respectGitignore
    ? readIgnoreFile(join(options.rootDir, SOURCE_GITIGNORE))
    : undefined;
  const stigmerignore = readIgnoreFile(join(options.rootDir, SOURCE_STIGMERIGNORE));
  const sources: IgnoreSources = {
    includeDefaults: options.includeDefaults,
    ...(gitignore !== undefined && { gitignore }),
    ...(stigmerignore !== undefined && { stigmerignore }),
    ...(options.extraIgnore !== undefined && { extraIgnore: options.extraIgnore }),
    ...(options.extraInclude !== undefined && { extraInclude: options.extraInclude }),
  };
  return buildMatcher(sources);
}

function readIgnoreFile(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    // Absent or unreadable ignore files are normal — no patterns.
    return undefined;
  }
}
