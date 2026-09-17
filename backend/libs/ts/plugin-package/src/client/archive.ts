/**
 * The archive a plugin push sends, and its digest.
 *
 * The server's identity for a plugin version is the SHA-256 of the bytes it
 * receives, so a client that can compute those bytes knows "already
 * installed" and "upgrade available" without pushing. That is only true if
 * every client builds the archive the same way: the selected files in
 * selection order, one DOS-epoch mtime on every entry, one compression
 * level. These are the CLI's original options (the skill packager's
 * discipline, kept byte for byte); changing any of them would make every
 * installed plugin look like an upgrade.
 *
 * The digest is WebCrypto's, which Node 22 and every browser provide, so
 * there is one hash implementation and it is asynchronous everywhere.
 */

import { zipSync } from "fflate";

import type { PluginFiles } from "../files.js";

/**
 * The one mtime every entry carries: the DOS epoch, at local midnight so
 * the DOS time field reads 00:00 in every zone. Construct it locally rather
 * than from UTC: fflate converts through the Date's local getters.
 */
export const DETERMINISTIC_ZIP_MTIME = new Date(1980, 0, 1);

/** The deflate level the skill packager chose; part of the identity. */
const ARCHIVE_LEVEL = 6;

/** Zip the selected files in their listed order. */
export function archivePlugin(files: PluginFiles): Uint8Array {
  const tree: Record<string, Uint8Array> = {};
  for (const entry of files.entries) {
    tree[entry.path] = files.read(entry.path);
  }
  return zipSync(tree, { level: ARCHIVE_LEVEL, mtime: DETERMINISTIC_ZIP_MTIME });
}

/** Lowercase hex SHA-256 of `bytes`: the server's `status.digest` for these bytes. */
export async function digestArchive(bytes: Uint8Array): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
