/**
 * Generates a concise workspace file tree for system prompts.
 *
 * Produces a markdown-formatted directory listing that helps the agent
 * understand the project structure. Respects .gitignore when present
 * and caps depth to keep the system prompt manageable.
 */

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative, basename } from "node:path";

const MAX_DEPTH = 4;
const MAX_ENTRIES = 200;

const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  "__pycache__",
  ".venv",
  ".mypy_cache",
  ".ruff_cache",
  ".pytest_cache",
  "dist",
  "build",
  ".next",
  ".stigmer",
  ".cursor",
]);

export interface FileTreeOptions {
  headingLevel?: number;
  maxDepth?: number;
  maxEntries?: number;
}

export function buildWorkspaceFileTree(
  rootDir: string,
  options?: FileTreeOptions,
): string | null {
  const headingLevel = options?.headingLevel ?? 3;
  const maxDepth = options?.maxDepth ?? MAX_DEPTH;
  const maxEntries = options?.maxEntries ?? MAX_ENTRIES;

  const gitignorePatterns = loadGitignore(rootDir);
  const lines: string[] = [];
  let count = 0;

  function walk(dir: string, depth: number, prefix: string): boolean {
    if (depth > maxDepth) return false;

    let entries: string[];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return false;
    }

    for (const entry of entries) {
      if (count >= maxEntries) return true;
      if (DEFAULT_IGNORES.has(entry)) continue;
      if (entry.startsWith(".") && entry !== ".env.example") continue;

      const fullPath = join(dir, entry);
      const rel = relative(rootDir, fullPath);

      if (isGitignored(rel, gitignorePatterns)) continue;

      let isDir = false;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch {
        continue;
      }

      lines.push(`${prefix}${isDir ? `${entry}/` : entry}`);
      count++;

      if (isDir) {
        const truncated = walk(fullPath, depth + 1, prefix + "  ");
        if (truncated) return true;
      }
    }
    return false;
  }

  const truncated = walk(rootDir, 0, "");

  if (lines.length === 0) return null;

  const heading = "#".repeat(headingLevel);
  const tree = lines.join("\n");
  const suffix = truncated ? "\n  ... (truncated)" : "";

  return `${heading} Project Structure\n\n\`\`\`\n${tree}${suffix}\n\`\`\``;
}

function loadGitignore(rootDir: string): string[] {
  try {
    const content = readFileSync(join(rootDir, ".gitignore"), "utf-8");
    return content
      .split("\n")
      .map(l => l.trim())
      .filter(l => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

function isGitignored(relativePath: string, patterns: string[]): boolean {
  const name = basename(relativePath);
  for (const pattern of patterns) {
    if (pattern.endsWith("/") && name === pattern.slice(0, -1)) return true;
    if (name === pattern) return true;
  }
  return false;
}
