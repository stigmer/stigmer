/**
 * Writing a deterministic archive, byte for byte the one the CLI writes for
 * the same files. The server writes ZIPs for one reason: an eval case built
 * from a run is added to an eval as a new version (domain/eval), and an
 * eval's version IS the SHA-256 of its archive bytes, so a folder the
 * server wrote, downloaded and pushed back unchanged must hash alike, or
 * the push would mint a version out of nothing.
 *
 * So the bytes come from the CLI's own archiver
 * (`@stigmer/plugin-package/client` `archivePlugin`: one fixed DOS-epoch
 * mtime, one deflate level), over the entries in the order the CLI's
 * directory walk lists them (`compareWalkOrder`, component by component:
 * `b/x.txt` before `b.txt`), whatever order they are given in.
 *
 * Proven by __tests__/write.test.ts: two writes of the same files are
 * byte-equal whatever their order, equal to the CLI archiver's bytes for
 * the walk order, a path listed twice is refused, and the result
 * round-trips through the server's own reader.
 */
import type { PluginFiles } from "@stigmer/plugin-package";
import { archivePlugin, compareWalkOrder } from "@stigmer/plugin-package/client";

/** One file to write: a plugin-relative POSIX path and its bytes. */
export interface ArchiveFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Writes `files` as one deflated archive whose bytes depend on the files alone. */
export function writeArchive(files: ReadonlyArray<ArchiveFile>): Uint8Array {
  const sorted = [...files].sort((a, b) => compareWalkOrder(a.path, b.path));
  const bytes = new Map<string, Uint8Array>();
  for (const file of sorted) {
    if (bytes.has(file.path)) {
      throw new Error(`archive path '${file.path}' listed twice`);
    }
    bytes.set(file.path, file.bytes);
  }
  const listed: PluginFiles = {
    entries: sorted.map((file) => ({ path: file.path, size: file.bytes.length })),
    read: (path) => bytes.get(path) ?? new Uint8Array(),
  };
  return archivePlugin(listed);
}
