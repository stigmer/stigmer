/**
 * Directories as the sync sees them: regular files with their bytes and
 * their executable bit, nothing else.
 *
 * Byte-identity with a vendor's folder is the catalogue's promise
 * (`plugins/NOTICE`), and it has three parts: the same files, the same
 * bytes, the same modes, because an executable script that arrives
 * non-executable is a different plugin to the shell that runs it. Symlinks
 * are skipped on both sides, as the plugin walker skips them; a symlink in
 * a vendor's tree is therefore neither copied nor compared, and the
 * install never sees it either way.
 *
 * `copyTree` replaces the destination whole: a stale file from an earlier
 * commit must not survive a re-sync, and a replace is what makes "copy
 * what is already there" a no-op rather than a merge.
 */

import { chmodSync, copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

export interface TreeFile {
  /** Root-relative POSIX path. */
  readonly path: string;
  readonly executable: boolean;
  readonly bytes: () => Buffer;
}

/** Every regular file under `root`, sorted by path; symlinks skipped; `.git` never descended. */
export function listTree(root: string): readonly TreeFile[] {
  const files: TreeFile[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === ".git") continue;
      const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute, path);
      else if (entry.isFile()) {
        const mode = statSync(absolute).mode;
        files.push({ path, executable: (mode & 0o111) !== 0, bytes: () => readFileSync(absolute) });
      }
    }
  };
  walk(root, "");
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/** Whether two directories differ in any file's presence, bytes or executable bit. */
export function treesDiffer(a: string, b: string): boolean {
  const left = listTree(a);
  const right = listTree(b);
  if (left.length !== right.length) return true;
  for (let index = 0; index < left.length; index++) {
    const x = left[index];
    const y = right[index];
    if (x === undefined || y === undefined) return true;
    if (x.path !== y.path || x.executable !== y.executable) return true;
    if (!x.bytes().equals(y.bytes())) return true;
  }
  return false;
}

/** Replace `destination` with a copy of `source`: files, bytes and executable bits. */
export function copyTree(source: string, destination: string): void {
  rmSync(destination, { recursive: true, force: true });
  for (const file of listTree(source)) {
    const target = join(destination, ...file.path.split("/"));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(source, ...file.path.split("/")), target);
    chmodSync(target, file.executable ? 0o755 : 0o644);
  }
}
