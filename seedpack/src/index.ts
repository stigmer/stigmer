// @stigmer/seedpack — the embedded system seedpack, delivered as an npm package.
//
// The seedpack is a standard Stigmer project (a stigmer.yaml plus vendored
// agents, skills, MCP servers, and workflows). Historically it was `go:embed`-ed
// into the Go CLI binary; the TypeScript CLI is a lean npm package that cannot
// (and per DD-002 should not) carry ~300 content files in every `npx` install,
// so the content ships here instead and is acquired on demand — the same
// pattern as @stigmer/runner-slim and the managed Temporal binary.
//
// This package intentionally contains no resource parsing, validation, or apply
// logic: a host (the CLI today, a server bootstrap tomorrow) resolves the
// content directory and feeds it through the normal declarative-apply path —
// one code path for system content and user projects alike.

import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The seedpack entries that constitute the bootstrappable project, in apply-safe
 * order. Mirrors the `//go:embed` set in `seedpack/embed.go` exactly — `tools/`
 * (build-time regeneration scripts) and `icons/` (UI assets) are deliberately
 * excluded so the content set is identical across the Go and TS delivery paths.
 */
export const SEEDPACK_ENTRIES = [
  "stigmer.yaml",
  "organizations",
  "skills",
  "agents",
  "workflows",
  "mcp-servers",
] as const;

/**
 * Absolute path to the seedpack content root — the directory that holds
 * stigmer.yaml and the resource subtrees. Resolved by walking up from this
 * module so it works whether running from `src/` (dev, via tsx), `dist/` (built,
 * content staged beside the compiled JS), or a published package root.
 */
export function contentDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, "stigmer.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("@stigmer/seedpack: could not locate seedpack content root (stigmer.yaml not found)");
}

/**
 * Deterministic SHA-256 over the seedpack content, used to detect when the
 * bootstrap is stale. Files are walked in lexical order and each contributes its
 * forward-slash relative path, a NUL separator, and its bytes — identical to the
 * Go `seedpack.ContentHash` algorithm so the two delivery paths agree.
 */
export function contentHash(root: string = contentDir()): string {
  const hash = createHash("sha256");
  for (const rel of listContentFiles(root)) {
    hash.update(rel);
    hash.update(NUL);
    hash.update(readFileSync(join(root, rel)));
  }
  return `sha256:${hash.digest("hex").slice(0, 16)}`;
}

/**
 * Extract the seedpack into `destDir`, producing a clean Stigmer project
 * directory the declarative-apply path can process directly. Only the canonical
 * {@link SEEDPACK_ENTRIES} are copied, so the result never carries build tooling
 * or assets that happen to sit beside the content in a repo checkout.
 */
export function extractToDir(destDir: string, root: string = contentDir()): void {
  mkdirSync(destDir, { recursive: true });
  for (const entry of SEEDPACK_ENTRIES) {
    const src = join(root, entry);
    if (!existsSync(src)) continue;
    cpSync(src, join(destDir, entry), { recursive: true });
  }
}

const NUL = Uint8Array.of(0);

/**
 * Lexically-sorted, forward-slash relative paths of every file under the
 * canonical entries (directories walked recursively, symlinks ignored). Shared
 * by {@link contentHash} and any host that needs a stable file manifest.
 */
export function listContentFiles(root: string = contentDir()): string[] {
  const files: string[] = [];
  const walk = (abs: string): void => {
    for (const dirent of readdirSync(abs, { withFileTypes: true })) {
      const full = join(abs, dirent.name);
      if (dirent.isDirectory()) {
        walk(full);
      } else if (dirent.isFile()) {
        files.push(toPosix(relative(root, full)));
      }
    }
  };
  for (const entry of SEEDPACK_ENTRIES) {
    const abs = join(root, entry);
    if (!existsSync(abs)) continue;
    if (statSync(abs).isDirectory()) walk(abs);
    else files.push(entry);
  }
  return files.sort();
}

function toPosix(p: string): string {
  return sep === posix.sep ? p : p.split(sep).join(posix.sep);
}
