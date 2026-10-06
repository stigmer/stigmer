// Real plugins, vendored whole from the Claude Code plugin directory, so a
// suite can push one exactly as its authors published it and run its hooks
// (`fixtures/claude-plugins/NOTICE`). Here: a plugin's files as the archive
// input a push takes, the manifest of upstream's git blob SHAs that proves
// them unchanged, and a rule from the plugin's own examples, so even the
// policy a proof installs is upstream's. A plugin's files are the manifest's
// list, read from disk, so a file git ignores in the fixture (Python's
// `__pycache__`, which hookify's own `.gitignore` hides) never rides a push;
// `vendoredPaths` lists the disk for the test that refuses such a file. The
// runner, which does not depend on this package, reads the same fixture and
// manifest by path (`cursor-hooks-gate.live.test.ts`).
// Domain: test support (fixtures).
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Repo root is three levels up from test/support/src/.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const FIXTURES_ROOT = join(REPO_ROOT, "test", "support", "fixtures", "claude-plugins");

/** The plugins vendored runnable, by their directory (and plugin) name. */
export const REAL_CLAUDE_PLUGINS = ["hookify"] as const;
export type RealClaudePlugin = (typeof REAL_CLAUDE_PLUGINS)[number];

/** One file as upstream's tree lists it: its git blob SHA and git mode. */
export interface UpstreamFile {
  readonly blob: string;
  readonly mode: "100644" | "100755";
}

/** `fixtures/claude-plugins/upstream.json`: the source, the commit, each plugin's files. */
export interface UpstreamManifest {
  readonly repository: string;
  readonly commit: string;
  readonly plugins: Readonly<
    Record<RealClaudePlugin, { readonly path: string; readonly files: Readonly<Record<string, UpstreamFile>> }>
  >;
}

/** The directory a plugin is vendored in; its archive is this tree, nothing added. */
export function realPluginDir(name: RealClaudePlugin): string {
  return join(FIXTURES_ROOT, name);
}

/** The manifest the vendoring wrote from upstream's tree. */
export function upstreamManifest(): UpstreamManifest {
  return JSON.parse(readFileSync(join(FIXTURES_ROOT, "upstream.json"), "utf8")) as UpstreamManifest;
}

/**
 * The plugin as a push takes it: every file upstream's tree lists, keyed by
 * its slash-separated path relative to the plugin root, in sorted order, its
 * bytes read from disk.
 */
export function realPluginFiles(name: RealClaudePlugin): Map<string, Uint8Array> {
  const root = realPluginDir(name);
  const files = new Map<string, Uint8Array>();
  for (const path of Object.keys(upstreamManifest().plugins[name].files).sort()) {
    files.set(path, readFileSync(join(root, path)));
  }
  return files;
}

/** Every file on disk under a plugin's directory, git-ignored ones included, slash-separated and sorted. */
export function vendoredPaths(name: RealClaudePlugin): string[] {
  const root = realPluginDir(name);
  const paths: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else paths.push(relative(root, full).split("\\").join("/"));
    }
  };
  walk(root);
  return paths.sort();
}

/** A file's git blob SHA, what `git hash-object` prints: SHA-1 over `blob <len>\0<bytes>`. */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

/** A rule as a person installs it: the workspace path hookify globs, and the rule's bytes. */
export interface HookifyRule {
  readonly path: string;
  readonly content: string;
}

/**
 * One of hookify's own example rules (`examples/<example>.local.md`), placed
 * where hookify reads rules: `.claude/hookify.<example>.local.md`, relative
 * to the working directory its hook runs in.
 */
export function hookifyExampleRule(example: string): HookifyRule {
  return {
    path: `.claude/hookify.${example}.local.md`,
    content: readFileSync(join(realPluginDir("hookify"), "examples", `${example}.local.md`), "utf8"),
  };
}
