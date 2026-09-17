/**
 * The one directory a zipped folder wraps itself in, so the archive reads
 * as the folder.
 *
 * `zip -r plugin.zip my-plugin/`, a Finder "Compress", and a browser's
 * download of a repository all produce an archive whose every path begins
 * with the folder's own name; the manifest a reader looks for at the root
 * is then one level down. This decides, from the paths alone, whether that
 * is the case: it is when every path shares exactly one leading directory
 * and nothing sits beside it. A tree with a root file, or two top-level
 * directories, is taken as it is; a reader that then finds no manifest says
 * so in its own words.
 *
 * Pure over paths; the caller strips the prefix. Kept out of `select.ts`,
 * which reasons about a tree that already has its root.
 */

/** The shared leading directory of `paths`, or `null` when the tree is already rooted. */
export function rerootSingleDirectory(paths: readonly string[]): string | null {
  let prefix: string | null = null;
  for (const path of paths) {
    const slash = path.indexOf("/");
    if (slash <= 0) return null;
    const head = path.slice(0, slash);
    if (prefix === null) prefix = head;
    else if (prefix !== head) return null;
  }
  return prefix;
}

/** `paths` with `prefix/` removed from each; the caller has established every path carries it. */
export function stripDirectoryPrefix(paths: readonly string[], prefix: string): string[] {
  const cut = prefix.length + 1;
  return paths.map((path) => path.slice(cut));
}
